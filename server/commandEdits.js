import { stat } from 'fs/promises';
import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { blobOf, gitStatus, headCommit, keepFiles, repoRoot } from './git';

// The files a command changed. Claude edits through its shell as often as through its edit tools (a sed, a heredoc, a
// script), and only the tools say which file they touched. So the checkout is looked at just before and just after
// each command (its PreToolUse and PostToolUse hooks): a file whose state changed between the two was changed by it.
// State is each file git sees as changed or new, kept as a blob (so a turn's diff has what the command started from
// and left), or by size and modification time past the size a blob is kept at; files git ignores aren't the work.
// Only the session's own checkout is looked at.
//
// Sessions share checkouts, and their commands overlap: a test run in one spans another's quick edit, and both see the
// file change. A file another session's edit tool changed during the command isn't the command's. One another
// session's command saw go from the same state to the same state is the change both saw, and goes to the one that ran
// the shorter while: the edit, not the test run it fell inside. A command that ended first is weighed again when an
// overlapping one ends. A change paude can't see the source of (an editor, a person) is counted as the command's.
//
// What's under way and what ended lately are kept on disk too: the server restarts while commands run (a session
// editing paude's own server restarts it with each edit), and forgetting a command's start loses its edits to any
// longer command of another session that ran across it.

// Commands kept per session, newest last
const KEPT = 2000;

let file;
let runsFile;
// { [sessionId]: { [toolUseId]: { files: [path from the session's folder], before, after } }: before and after map
// each file to its blob, or null where it didn't exist; a file with neither (too big to keep) is left out
let edits = {};
// Per command under way: { sessionId, cwd, before, at }
const starting = new Map();
// The files each session's edit tools changed lately, as full paths: [{ sessionId, file, at }]
let known = [];
const RECENT_MS = 60 * 60 * 1000;
// Commands ended lately, to weigh overlapping ones against: [{ sessionId, toolUseId, cwd, root, at, endedAt,
// states: Map(full path → 'before→after'), sides: { [path from the session's folder]: { before, after } } }]
let ended = [];

// A file a session changed by its own edit tool
export const noteChanged = (sessionId, files, now = Date.now()) => {
	known = known.filter(entry => now - entry.at < RECENT_MS);
	for (const file of files) known.push({ sessionId, file, at: now });

	return saveRuns();
};

const othersChanged = (sessionId, since, now) =>
	new Set(
		known
			.filter(entry => entry.sessionId !== sessionId && entry.at >= since && entry.at <= now)
			.map(entry => entry.file),
	);

const save = () => file && writeJsonFile(file, () => edits);

const saveRuns = () =>
	runsFile &&
	writeJsonFile(runsFile, () => ({
		starting: [...starting].map(([id, run]) => [
			id,
			{ ...run, before: { ...run.before, files: [...run.before.files] } },
		]),
		ended: ended.map(command => ({ ...command, states: [...command.states] })),
		known,
	})).catch(error => console.error('Saving the commands under way failed:', error));

export const initCommandEdits = async (dataDir, now = Date.now()) => {
	file = path.join(dataDir, 'command-edits.json');
	runsFile = path.join(dataDir, 'commands-under-way.json');

	const runs = await readJsonFile(runsFile, {});

	edits = await readJsonFile(file, {});
	starting.clear();
	for (const [id, run] of runs.starting ?? [])
		if (now - run.at < RECENT_MS)
			starting.set(id, { ...run, before: { ...run.before, files: new Map(run.before.files) } });
	ended = (runs.ended ?? [])
		.filter(command => now - command.endedAt < RECENT_MS)
		.map(command => ({ ...command, states: new Map(command.states) }));
	known = (runs.known ?? []).filter(entry => now - entry.at < RECENT_MS);
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

	if (!before) return;
	starting.set(toolUseId, { sessionId, cwd, before, at: now });
	await saveRuns();
};

const overlap = (one, other) =>
	one.sessionId !== other.sessionId && one.root === other.root && other.at < one.endedAt && other.endedAt > one.at;

// The files a command is credited with, as full paths: those it saw change, less those an overlapping command of
// another session ran the shorter while and saw change the same way, or another session's edit tool changed meanwhile
const credited = command => {
	const theirs = othersChanged(command.sessionId, command.at, command.endedAt);
	const took = command.endedAt - command.at;
	const tighter = ended.filter(other => overlap(command, other) && other.endedAt - other.at < took);

	return [...command.states.keys()].filter(
		file => !theirs.has(file) && !tighter.some(other => other.states.get(file) === command.states.get(file)),
	);
};

// What the session's timeline keeps for a command; false when it's credited with nothing now
const keep = command => {
	const files = credited(command).map(file => path.relative(command.cwd, file));
	const side = which =>
		Object.fromEntries(
			files.filter(file => which in (command.sides[file] ?? {})).map(file => [file, command.sides[file][which]]),
		);
	const kept = { ...edits[command.sessionId] };

	if (files.length) kept[command.toolUseId] = { files, before: side('before'), after: side('after') };
	else delete kept[command.toolUseId];
	edits[command.sessionId] = Object.fromEntries(
		Object.keys(kept)
			.slice(-KEPT)
			.map(id => [id, kept[id]]),
	);

	return files;
};

// The files it changed, from the session's folder, kept for the session's timeline; [] for none
export const commandEnded = async (sessionId, toolUseId, now = Date.now()) => {
	const begun = starting.get(toolUseId);

	if (!begun) return [];
	starting.delete(toolUseId);

	const after = await snapshot(begun.cwd);
	const fromTop = after ? changedBetween(begun.before, after) : [];
	const beforeState = file => begun.before.files.get(file) ?? `clean at ${begun.before.head}`;
	const afterState = file => after.files.get(file) ?? `clean at ${after.head}`;
	// Clean before the command: as HEAD had it then, or nothing for a file it made. Put back: as HEAD has it.
	const blobBefore = async file =>
		begun.before.files.has(file)
			? begun.before.files.get(file)
			: ((await blobOf(after.root, file, begun.before.head)) ?? GONE);
	const blobAfter = async file => after.files.get(file) ?? (await blobOf(after.root, file, after.head)) ?? GONE;
	// A side the diff can show: { value } for a blob or nothing, null past the size a blob is kept at
	const shown = state => {
		if (state === GONE) return { value: null };

		return BLOB.test(state) ? { value: state } : null;
	};
	const sides = Object.fromEntries(
		await Promise.all(
			fromTop.map(async file => {
				const [was, left] = [shown(await blobBefore(file)), shown(await blobAfter(file))];

				return [
					path.relative(begun.cwd, path.join(after.root, file)),
					{ ...(was && { before: was.value }), ...(left && { after: left.value }) },
				];
			}),
		),
	);
	const command = {
		sessionId,
		toolUseId,
		cwd: begun.cwd,
		root: after?.root,
		at: begun.at,
		endedAt: now,
		states: new Map(fromTop.map(file => [path.join(after.root, file), `${beforeState(file)}→${afterState(file)}`])),
		sides,
	};

	ended = [...ended.filter(other => now - other.endedAt < RECENT_MS), command];

	const changed = fromTop.length ? keep(command) : [];

	// Those that ended first and ran alongside it, weighed again now it can be weighed against
	for (const other of ended) if (other !== command && overlap(command, other) && other.states.size) keep(other);
	if (fromTop.length || ended.some(other => other !== command && overlap(command, other))) await save();
	await saveRuns();

	return changed;
};

// A turn's end: a command of its that the hooks never said ended (turned back, or Claude was stopped) won't now
export const commandsSettled = sessionId => {
	const before = starting.size;

	for (const [id, begun] of starting) if (begun.sessionId === sessionId) starting.delete(id);

	return starting.size === before ? undefined : saveRuns();
};

export const commandEditsOf = sessionId => edits[sessionId] ?? null;

export const forgetCommandEdits = async sessionId => {
	if (!(sessionId in edits)) return;
	delete edits[sessionId];
	await save();
};
