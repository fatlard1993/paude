import { readdir } from 'fs/promises';
import os from 'os';
import { join } from 'path';

import { promptText } from './history';

const PROMPT_SCAN_BYTES = 256 * 1024;
const FOLDER_SCAN_BYTES = 1024 * 1024;
const FOLDER_SCAN_LIMIT = 64 * 1024 * 1024;
const FOLDER = /"cwd":"((?:[^"\\]|\\.)*)"/;

export const claudeHome = () => process.env.CLAUDE_CONFIG_DIR ?? join(os.homedir(), '.claude');

// Claude Code keeps a session's transcript in a folder named after the directory it started in
const ownFile = async (id, cwd) => {
	const projects = join(claudeHome(), 'projects');
	const named = Bun.file(join(projects, (cwd ?? '').replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`));

	if (await named.exists()) return named;

	const folders = await readdir(projects).catch(() => []);
	const found = await Promise.all(folders.map(folder => Bun.file(join(projects, folder, `${id}.jsonl`)).exists()));
	const index = found.indexOf(true);

	return index === -1 ? null : Bun.file(join(projects, folders[index], `${id}.jsonl`));
};

const CONTINUED_TAIL_BYTES = 256 * 1024;
// { [id]: { size, next } }: where each transcript said its session went on, as of the size it was read at
const continuations = new Map();
// { [id carried on in]: the id it was carried on from }
const continuedFrom = new Map();

// The session Claude carried this one on in, as when it moves a session to the background: a resume that forks it, so
// the new transcript holds the whole conversation, and the old one ends saying where it went
const continuedIn = async (id, file) => {
	const known = continuations.get(id);

	if (known?.next || known?.size === file.size) return known.next;

	const tail = await file.slice(Math.max(0, file.size - CONTINUED_TAIL_BYTES)).text();
	const next =
		parsed(tail).findLast(line => line.type === 'continued-in' && line.sessionId === id)?.continuedInSessionId ?? null;

	continuations.set(id, { size: file.size, next });

	return next;
};

// A session's transcript, wherever Claude has carried it on to since: paude keeps the id it started the session as
export const transcriptFile = async (id, cwd) => {
	const seen = new Set([id]);
	let file = await ownFile(id, cwd);

	for (let at = id; file;) {
		const next = await continuedIn(at, file);
		const onward = next && !seen.has(next) && (await ownFile(next, cwd));

		if (!onward) break;
		seen.add(next);
		continuedFrom.set(next, id);
		[at, file] = [next, onward];
	}

	return file;
};

// The session a transcript carries on, of those whose transcripts have been read; undefined for none
export const carriesOn = id => continuedFrom.get(id);

const parsed = text =>
	text
		.split('\n')
		.filter(Boolean)
		.flatMap(line => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});

export const transcriptLines = async (id, cwd) => {
	const file = await transcriptFile(id, cwd);

	return file ? parsed(await file.text()) : [];
};

const folders = new Map();

// The folder a session ran in, from its transcript, for one the SDK can't place: its head can be all bookkeeping
// (a title, the mode, a long run of file snapshots), megabytes before the first line that names it
export const folderOf = async id => {
	if (folders.has(id)) return folders.get(id);

	const file = await transcriptFile(id);
	let found = null;

	// Each read overlaps the next a little, so a line cut at the boundary is still found whole in one of them
	for (let at = 0; file && !found && at < Math.min(file.size, FOLDER_SCAN_LIMIT); at += FOLDER_SCAN_BYTES)
		found = FOLDER.exec(await file.slice(at, at + FOLDER_SCAN_BYTES + 4096).text())?.[1];

	const folder = found ? JSON.parse(`"${found}"`) : null;

	if (folder) folders.set(id, folder);

	return folder;
};

const births = new Map();

// When the session was born: the time on the first line of its transcript, which never changes, in ms; null while it
// has no transcript, or none with a time, so it's looked for again
export const bornOf = async (id, cwd) => {
	if (births.has(id)) return births.get(id);

	const file = await transcriptFile(id, cwd);
	const stamp = file ? /"timestamp":\s*"([^"]+)"/.exec(await file.slice(0, PROMPT_SCAN_BYTES).text())?.[1] : null;
	const born = stamp ? Date.parse(stamp) : NaN;

	if (Number.isNaN(born)) return null;
	births.set(id, born);

	return born;
};

const firstPrompts = new Map();

// What the session began with, from the head of its transcript; read once, since it never changes
export const firstPromptOf = async (id, cwd) => {
	if (firstPrompts.has(id)) return firstPrompts.get(id);

	const file = await transcriptFile(id, cwd);
	const prompt = file
		? (parsed(await file.slice(0, PROMPT_SCAN_BYTES).text())
				.map(promptText)
				.find(text => text && !/^\[Request interrupted/.test(text)) ?? null)
		: null;

	firstPrompts.set(id, prompt);

	return prompt;
};
