import { stat } from 'fs/promises';
import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { blobOf, gitStatus, headCommit, keepFiles, repoRoot } from './git';

// The files a command changed. Claude edits through its shell as often as through its edit tools (a sed, a heredoc, a
// script), and only the tools say which file they touched. So the checkout is looked at just before and just after
// each command (its PreToolUse and PostToolUse hooks): a file whose state changed between the two was changed by it.
// State is each file git sees as changed or new, kept as a blob (so a turn's diff has what the command started from
// and left), or by size and modification time past the size a blob is kept at; files git ignores aren't the work. Only the session's own checkout is looked at. Sessions share checkouts, so a file another session
// is known to have changed meanwhile (by an edit tool, or a command of its own) isn't this command's; a change paude
// can't see the source of (an editor, a person) is counted as the command's.

// Commands kept per session, newest last
const KEPT = 2000;

let file;
// { [sessionId]: { [toolUseId]: { files: [path from the session's folder], before, after } }: before and after map
// each file to its blob, or null where it didn't exist; a file with neither (too big to keep) is left out
let edits = {};
// Per command under way: { sessionId, cwd, before, at }
const starting = new Map();
// The files each session is known to have changed lately, as full paths: [{ sessionId, file, at }]
let known = [];
const KNOWN_MS = 60 * 60 * 1000;

// A file a session changed by its own edit tool, or by a command
export const noteChanged = (sessionId, files, now = Date.now()) => {
	known = known.filter(entry => now - entry.at < KNOWN_MS);
	for (const file of files) known.push({ sessionId, file, at: now });
};

const othersChanged = (sessionId, since, now) =>
	new Set(
		known
			.filter(entry => entry.sessionId !== sessionId && entry.at >= since && entry.at <= now)
			.map(entry => entry.file),
	);

const save = () => file && writeJsonFile(file, () => edits);

export const initCommandEdits = async dataDir => {
	file = path.join(dataDir, 'command-edits.json');
	edits = await readJsonFile(file, {});
};

const BLOB = /^[0-9a-f]{40}$/;
const GONE = 'gone';

const stateOf = async full => {
	const found = await stat(full).catch(() => null);

	return found ? `${found.size}:${found.mtimeMs}` : GONE;
};

// { head, files: Map(path from the top → state) }, or null outside git
export const snapshot = async cwd => {
	const root = await repoRoot(cwd);

	if (!root) return null;

	const [status, head] = await Promise.all([gitStatus(root).catch(() => null), headCommit(root)]);

	if (!status) return null;

	const paths = [
		...new Set(
			[...status.staged, ...status.unstaged, ...status.untracked, ...status.conflicted].map(entry => entry.path),
		),
	];
	const blobs = await keepFiles(root, paths);
	const states = await Promise.all(paths.map(file => blobs[file] ?? stateOf(path.join(root, file))));

	return { root, head, files: new Map(paths.map((file, index) => [file, states[index]])) };
};

// Paths from the top that changed between two snapshots. One that stopped showing as changed was put back, unless HEAD
// moved: then it was committed, which changes nothing in the checkout.
export const changedBetween = (before, after) => {
	const changed = [];

	for (const [file, state] of after.files) if (before.files.get(file) !== state) changed.push(file);
	if (before.head === after.head)
		for (const file of before.files.keys()) if (!after.files.has(file)) changed.push(file);

	return changed.sort();
};

export const commandStarting = async (sessionId, toolUseId, cwd, now = Date.now()) => {
	if (!toolUseId) return;

	const before = await snapshot(cwd);

	if (before) starting.set(toolUseId, { sessionId, cwd, before, at: now });
};

// The files it changed, from the session's folder, kept for the session's timeline; [] for none
export const commandEnded = async (sessionId, toolUseId, now = Date.now()) => {
	const begun = starting.get(toolUseId);

	if (!begun) return [];
	starting.delete(toolUseId);

	const after = await snapshot(begun.cwd);
	const theirs = othersChanged(sessionId, begun.at, now);
	const full = after
		? changedBetween(begun.before, after)
				.map(file => path.join(after.root, file))
				.filter(file => !theirs.has(file))
		: [];

	if (!full.length) return [];
	noteChanged(sessionId, full, now);

	const changed = full.map(file => path.relative(begun.cwd, file));
	const fromTop = full.map(file => path.relative(after.root, file));
	// Clean before the command: as HEAD had it then, or nothing for a file it made
	const was = async file =>
		begun.before.files.has(file)
			? begun.before.files.get(file)
			: ((await blobOf(after.root, file, begun.before.head)) ?? GONE);
	const sides = async states =>
		Object.fromEntries(
			(await states)
				.map((state, index) => [changed[index], state === GONE ? null : state])
				.filter(([, state]) => state === null || BLOB.test(state)),
		);
	const record = {
		files: changed,
		before: await sides(Promise.all(fromTop.map(was))),
		// Put back to as HEAD has it
		after: await sides(
			Promise.all(
				fromTop.map(async file => after.files.get(file) ?? (await blobOf(after.root, file, after.head)) ?? GONE),
			),
		),
	};

	const kept = { ...edits[sessionId], [toolUseId]: record };
	const ids = Object.keys(kept);

	edits[sessionId] = Object.fromEntries(ids.slice(-KEPT).map(id => [id, kept[id]]));
	await save();

	return changed;
};

// A turn's end: a command of its that the hooks never said ended (turned back, or Claude was stopped) won't now
export const commandsSettled = sessionId => {
	for (const [id, begun] of starting) if (begun.sessionId === sessionId) starting.delete(id);
};

export const commandEditsOf = sessionId => edits[sessionId] ?? null;

export const forgetCommandEdits = async sessionId => {
	if (!(sessionId in edits)) return;
	delete edits[sessionId];
	await save();
};
