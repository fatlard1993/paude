import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import { basename, isAbsolute, join, relative, sep } from 'path';

import { importsIn, resolveImport } from '../shared/reviewOrder';
import { diffOf, listChanges } from './changes';
import { GitError, gitCommit, gitCompare, gitSince, keepText, pathsFromFolder, pathsFromTop, repoRoot } from './git';
import { isSecret, readProjectFile } from './files';
import { promptText } from './sessions/history';
import { languageKnown, symbolsIn } from './symbols';
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

		const child = Bun.spawn(['git', 'diff', '--no-index', '--no-color', '--full-index', '--', 'a', 'b'], {
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

// Each text a diff of texts git doesn't have (a turn's, a proposal's) is between goes to `seen`, if given, so one a
// comment's lines are picked in can be kept then (keepShownText)
const fileDiff = async (cwd, path, before, after, seen) => {
	const diff = await diffTexts(before, after);

	if (diff === null) return null;
	seen?.push({ path, texts: [before, after] });

	return { path, status: statusOf(before, after), diff };
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
const turnDiff = async (id, cwd, turnId, seen) => {
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
			const diff = await fileDiff(cwd, shown, usable(original), usable(after), seen);

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
const proposalDiff = async (id, cwd, seen) => {
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

		const diff = await fileDiff(cwd, shown, usable(current), usable(proposed), seen);

		if (diff) files.push(diff);
	}

	return { title: 'Proposed by Claude', files };
};

const filesDiff = async (cwd, first, second, seen) => {
	const [a, b] = await Promise.all([readProjectFile(cwd, first), readProjectFile(cwd, second)]);

	if (a.status !== 200 || b.status !== 200) throw new DiffError('Both have to be text files in the project');

	const diff = await diffTexts(a.text, b.text);

	if (diff) seen?.push({ path: second, texts: [a.text, b.text] });

	return {
		title: `${first} and ${second}`,
		files: diff ? [{ path: second, from: first, status: 'modified', diff }] : [],
	};
};

// One commit's changes, titled with its subject
const commitDiff = async (cwd, ref) => {
	const root = await repoRoot(cwd);

	if (!root) throw new DiffError('Not a git repository');

	try {
		const { short, title, files } = await gitCommit(root, ref);

		return { title: `${short} ${title}`, files };
	} catch (error) {
		if (error instanceof GitError) throw new DiffError(error.message);
		throw error;
	}
};

// What this branch changes since it parted from the base (origin's default branch, unless named), with the work not
// committed yet unless only what's `committed` is asked for (what a pull request would hold now)
const compareDiff = async (cwd, base, committed) => {
	const root = await repoRoot(cwd);

	if (!root) throw new DiffError('Not a git repository');

	try {
		const {
			base: against,
			commits,
			uncommitted,
			leftOut,
			files,
		} = await gitCompare(root, {
			base,
			working: !committed,
		});
		const beyond = `${commits.length} commit${commits.length === 1 ? '' : 's'} beyond ${against}`;
		const work = uncommitted
			? `${beyond}, and ${uncommitted} file${uncommitted === 1 ? '' : 's'} changed and not committed`
			: beyond;

		return {
			title: leftOut ? `${work} (${leftOut} more file${leftOut === 1 ? '' : 's'} left out, past what fits here)` : work,
			files,
		};
	} catch (error) {
		if (error instanceof GitError) throw new DiffError(error.message);
		throw error;
	}
};

// What changed since a commit someone reviewed: the commits after it, or, where the branch was rewritten, how its
// files differ from it now
const sinceDiff = async (cwd, commit) => {
	const root = await repoRoot(cwd);

	if (!root) throw new DiffError('Not a git repository');

	try {
		const { rewritten, commits, files } = await gitSince(root, commit);
		const plural = commits.length === 1 ? '' : 's';

		return {
			title: rewritten
				? `Rewritten since you reviewed ${commit.slice(0, 7)}: how its files differ now`
				: `${commits.length} commit${plural} since you reviewed ${commit.slice(0, 7)}`,
			files,
		};
	} catch (error) {
		if (error instanceof GitError) throw new DiffError(error.message);
		throw error;
	}
};

// What reading the changed files in order needs, from each as it is now: which changed files each imports ({ [path]: [paths] }), and each one's declarations
// ({ [path]: [{ name, kind, line }] })
const readingHints = async (cwd, files) => {
	const paths = files.map(file => file.path);
	const imports = {};
	const outlines = {};

	for (const { path, status } of files) {
		if (status === 'deleted') continue;

		const text = await readDisk(join(cwd, path));

		if (typeof text !== 'string') continue;

		const used = importsIn(path, text).map(name => resolveImport(path, name, paths));

		if (used.some(Boolean)) imports[path] = [...new Set(used.filter(Boolean))];
		if (languageKnown(path)) outlines[path] = symbolsIn(text, path);
	}

	return { imports, outlines };
};

const DIFF_BLOBS = /^index ([0-9a-f]{40})\.\.([0-9a-f]{40})/m;
const NO_BLOB = /^0+$/;

// The two texts a file's diff is between, as git names them (blob ids): { old, new }, either left out where there's
// none (an added or deleted file). Git needn't have them: a comment on lines picked in the diff keeps its text then.
const blobsOf = file => {
	const [, before, after] = DIFF_BLOBS.exec(file.diff ?? '') ?? [];

	const sides = {
		...(!['added', 'untracked'].includes(file.status) && { old: before }),
		...(file.status !== 'deleted' && { new: after }),
	};

	return Object.fromEntries(Object.entries(sides).filter(([, hash]) => hash && !NO_BLOB.test(hash)));
};

// A text a comment's lines were picked in, from a diff of texts git doesn't have (a turn's, a proposal's, two files'):
// kept now, read again from the diff, if one of its texts is the one `wanted` (a blob id). Its id, or undefined.
export const keepShownText = async (id, cwd, diff, path, wanted) => {
	if (!['turn', 'proposal', 'files'].includes(diff?.source) || !wanted) return undefined;

	const seen = [];

	try {
		await diffSetOf(id, cwd, diff, seen);
	} catch (error) {
		if (!(error instanceof DiffError)) throw error;

		return undefined;
	}

	for (const text of seen.filter(found => found.path === path).flatMap(found => found.texts)) {
		const kept = await keepText(cwd, text, wanted);

		if (kept) return kept;
	}

	return undefined;
};

// Every kind of diff paude shows, in one shape: { title, files: [{ path, status, diff, from, note, blobs }], imports,
// outlines }
// Git names a commit's files, or a branch's, from the top of the repository; the files panel and comments name every
// file from the session's folder
const ROOT_NAMED = new Set(['commit', 'compare', 'since']);

const namedFromFolder = async (cwd, files) => {
	const local = await pathsFromFolder(cwd);

	return files.map(file => ({ ...file, path: local(file.path), ...(file.from && { from: local(file.from) }) }));
};

export const diffSet = async (id, cwd, which) => {
	const found = await diffSetOf(id, cwd, which);
	const set = ROOT_NAMED.has(which.source) ? { ...found, files: await namedFromFolder(cwd, found.files) } : found;

	if (!set.files.length) return set;

	const files = set.files.map(file => ({ ...file, blobs: blobsOf(file) }));

	return { ...set, files, ...(await readingHints(cwd, files)) };
};

// A changed file and its diff, named from the session's folder: among the folder's changes, or for one outside it
// (the Git panel lists the whole repository's), among the repository's
const changedFile = async (cwd, path) => {
	const change = (await listChanges(cwd))?.find(found => found.path === path);

	if (change) return { ...change, diff: await diffOf(cwd, path) };
	if (typeof path !== 'string' || !path.startsWith('../')) return null;

	const root = await repoRoot(cwd);
	const top = root && (await pathsFromTop(cwd))(path);

	if (!top || top.startsWith('../')) return null;

	const outside = (await listChanges(root))?.find(found => found.path === top);
	const local = await pathsFromFolder(cwd);

	return outside
		? { ...outside, path, ...(outside.from && { from: local(outside.from) }), diff: await diffOf(root, top) }
		: null;
};

const diffSetOf = async (id, cwd, { source, path, turn, a, b, ref, base, committed }, seen) => {
	if (source === 'changes') {
		const change = await changedFile(cwd, path);

		if (!change) throw new DiffError('That file has no changes');

		return { title: path, files: [change] };
	}

	if (source === 'turn') return turnDiff(id, cwd, turn, seen);
	if (source === 'proposal') return proposalDiff(id, cwd, seen);
	if (source === 'files') return filesDiff(cwd, a, b, seen);
	if (source === 'commit') return commitDiff(cwd, ref);
	if (source === 'compare') return compareDiff(cwd, base, committed);
	if (source === 'since') return sinceDiff(cwd, ref);

	throw new DiffError('Unknown kind of diff');
};
