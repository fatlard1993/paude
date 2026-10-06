import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import { basename, isAbsolute, join, relative, sep } from 'path';

import { diffOf, listChanges } from './changes';
import { isSecret, readProjectFile } from './files';
import { promptText } from './sessions/history';
import { claudeHome, transcriptLines } from './sessions/transcript';
import { proposalsOf } from './sessions/proposals';
import gitEnvironment from './utils/gitEnvironment';

const MAX_TEXT_BYTES = 1024 * 1024;
const BACKUP_NAME = /^[0-9a-f]+@v\d+$/;
const PROMPT_PREVIEW = 160;

export class DiffError extends Error {}

// Only what's inside the session's project, and never a secret, whatever Claude touched elsewhere
const projectPath = (cwd, path) => {
	const within = relative(cwd, path);

	return within && !within.startsWith('..') && !isAbsolute(within) && !within.startsWith(sep) && !isSecret(within)
		? within
		: null;
};

// Text worth diffing, or null for a missing file; a binary one is refused
const usable = text => {
	if (text === null || text === undefined) return null;
	if (text.length > MAX_TEXT_BYTES) throw new DiffError('Too big to show here');
	if (text.includes('\0')) throw new DiffError('A binary file changed');

	return text;
};

const readDisk = async path => {
	const file = Bun.file(path);

	return (await file.exists()) ? file.text() : null;
};

const readBackup = async (id, name) => {
	if (!name) return null;
	if (!BACKUP_NAME.test(name)) return undefined;

	const file = Bun.file(join(claudeHome(), 'file-history', id, name));

	return (await file.exists()) ? file.text() : undefined;
};

// A unified diff of two texts, by git, so every source reads the same; null for no difference
export const diffTexts = async (before, after) => {
	if (before === after) return null;

	const folder = await mkdtemp(join(os.tmpdir(), 'paude-diff-'));

	try {
		await Promise.all([writeFile(join(folder, 'a'), before ?? ''), writeFile(join(folder, 'b'), after ?? '')]);

		const child = Bun.spawn(['git', 'diff', '--no-index', '--no-color', '--', 'a', 'b'], {
			cwd: folder,
			env: gitEnvironment(),
			stdout: 'pipe',
			stderr: 'ignore',
		});

		return await new Response(child.stdout).text();
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
};

const statusOf = (before, after) => {
	if (before === null) return 'added';
	if (after === null) return 'deleted';

	return 'modified';
};

const fileDiff = async (path, before, after) => {
	const diff = await diffTexts(before, after);

	return diff === null ? null : { path, status: statusOf(before, after), diff };
};

// A snapshot keys some files by a path relative to where they were (realParentDir); edits name them absolutely
const backupsByPath = snapshot =>
	Object.fromEntries(
		Object.entries(snapshot?.trackedFileBackups ?? {}).map(([key, backup]) => [
			isAbsolute(key) ? key : join(backup.realParentDir ?? '', basename(key)),
			backup,
		]),
	);

// Each prompt's turn and what its edits started from: [{ id, prompt, at, edited: Map(path → original text or null) }].
// Claude Code records every edit's file as it was before the edit, so the first of a turn is the turn's start.
const turnsOf = lines => {
	const turns = [];
	const snapshots = new Map();

	for (const line of lines) {
		if (line.type === 'file-history-snapshot')
			snapshots.set(line.messageId, { ...snapshots.get(line.messageId), ...backupsByPath(line.snapshot) });

		const prompt = promptText(line);

		if (prompt !== null && !/^\[Request interrupted/.test(prompt)) {
			turns.push({ id: line.uuid, prompt: prompt.slice(0, PROMPT_PREVIEW), at: line.timestamp, edited: new Map() });
			continue;
		}

		const result = line.toolUseResult;
		const turn = turns.at(-1);

		if (turn && result && typeof result === 'object' && typeof result.filePath === 'string') {
			if (!turn.edited.has(result.filePath)) turn.edited.set(result.filePath, result.originalFile ?? null);
		}
	}

	return turns.map((turn, index) => ({ ...turn, after: snapshots.get(turns[index + 1]?.id) ?? null }));
};

// The turns that edited files in the project, newest first
export const turnsWithChanges = async (id, cwd) =>
	turnsOf(await transcriptLines(id, cwd))
		.map(({ id: turn, prompt, at, edited }) => ({
			id: turn,
			prompt,
			at,
			files: [...edited.keys()].filter(path => projectPath(cwd, path)).length,
		}))
		.filter(({ files }) => files)
		.reverse();

// What a turn changed: each edited file from before its first edit to the end of the turn (the next prompt's
// snapshot, or the file as it is now for the latest turn)
const turnDiff = async (id, cwd, turnId) => {
	const turns = turnsOf(await transcriptLines(id, cwd));
	const turn = turns.find(found => found.id === turnId);

	if (!turn) throw new DiffError('That turn is not in this session');

	const files = [];

	for (const [path, original] of turn.edited) {
		const shown = projectPath(cwd, path);

		if (!shown) continue;

		const backup = turn.after?.[path];
		let after = backup ? await readBackup(id, backup.backupFileName) : undefined;

		if (after === undefined) after = await readDisk(path);

		try {
			const diff = await fileDiff(shown, usable(original), usable(after));

			if (diff) files.push(diff);
		} catch (error) {
			if (!(error instanceof DiffError)) throw error;
			files.push({ path: shown, status: 'modified', diff: '', note: error.message });
		}
	}

	return { title: turn.prompt, files };
};

// An edit's input applied to the file's text; null when it no longer applies (the text it replaces is gone)
const applyEdit = (text, { old_string: from, new_string: to, replace_all: all }) => {
	if (typeof from !== 'string' || typeof to !== 'string' || !text.includes(from)) return null;

	return all ? text.replaceAll(from, to) : text.replace(from, () => to);
};

const proposedText = (tool, input, current) => {
	if (tool === 'Write') return typeof input.content === 'string' ? input.content : null;
	if (tool === 'Edit') return applyEdit(current ?? '', input);

	return (input.edits ?? []).reduce((text, edit) => (text === null ? null : applyEdit(text, edit)), current ?? '');
};

// The edits Claude has asked to make and hasn't made yet (its PreToolUse hook reported them), each applied to the
// file as it is now
const proposalDiff = async (id, cwd) => {
	const files = [];

	for (const { tool: name, input } of proposalsOf(id)) {
		const shown = typeof input?.file_path === 'string' && projectPath(cwd, input.file_path);

		if (!shown) continue;

		const current = await readDisk(input.file_path);
		const proposed = proposedText(name, input, current);

		if (proposed === null) {
			files.push({ path: shown, status: 'modified', diff: '', note: 'This edit no longer applies to the file.' });
			continue;
		}

		const diff = await fileDiff(shown, usable(current), usable(proposed));

		if (diff) files.push(diff);
	}

	return { title: 'Proposed by Claude', files };
};

const filesDiff = async (cwd, first, second) => {
	const [a, b] = await Promise.all([readProjectFile(cwd, first), readProjectFile(cwd, second)]);

	if (a.status !== 200 || b.status !== 200) throw new DiffError('Both have to be text files in the project');

	const diff = await diffTexts(a.text, b.text);

	return {
		title: `${first} and ${second}`,
		files: diff ? [{ path: second, from: first, status: 'modified', diff }] : [],
	};
};

// Every kind of diff paude shows, in one shape: { title, files: [{ path, status, diff, from, note }] }
export const diffSet = async (id, cwd, { source, path, turn, a, b }) => {
	if (source === 'changes') {
		const change = (await listChanges(cwd))?.find(found => found.path === path);

		if (!change) throw new DiffError('That file has no changes');

		return { title: path, files: [{ ...change, diff: await diffOf(cwd, path) }] };
	}

	if (source === 'turn') return turnDiff(id, cwd, turn);
	if (source === 'proposal') return proposalDiff(id, cwd);
	if (source === 'files') return filesDiff(cwd, a, b);

	throw new DiffError('Unknown kind of diff');
};
