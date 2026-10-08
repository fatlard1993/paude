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
export const transcriptFile = async (id, cwd) => {
	const projects = join(claudeHome(), 'projects');
	const named = Bun.file(join(projects, (cwd ?? '').replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`));

	if (await named.exists()) return named;

	const folders = await readdir(projects).catch(() => []);
	const found = await Promise.all(folders.map(folder => Bun.file(join(projects, folder, `${id}.jsonl`)).exists()));
	const index = found.indexOf(true);

	return index === -1 ? null : Bun.file(join(projects, folders[index], `${id}.jsonl`));
};

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
