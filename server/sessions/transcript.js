import { readdir } from 'fs/promises';
import os from 'os';
import { join } from 'path';

import { promptText } from './history';

const PROMPT_SCAN_BYTES = 256 * 1024;
const FOLDER_SCAN_BYTES = 1024 * 1024;
const FOLDER_SCAN_LIMIT = 64 * 1024 * 1024;
const FOLDER = /"cwd":"((?:[^"\\]|\\.)*)"/;

const NEWLINE = 0x0a;
const decoder = new TextDecoder();
export const GROWN_SLICE_BYTES = 1024 * 1024;

// Transcript work takes turns across the whole server, one piece at a time with a pass of the event loop between: after
// a restart every running session's transcripts are caught up on at once by several readers each, and taken as they
// came they kept the sessions' terminals and every request waiting behind them for seconds at a time. A turn covers
// reading its piece too, so nothing read is held while it waits.
let turns = Promise.resolve();

export const inTurn = work => {
	const mine = turns.then(() => new Promise(resolve => setTimeout(resolve, 0))).then(work);

	turns = mine.catch(() => {});

	return mine;
};

// What a transcript grew by since `read.offset`, up to its last whole line, handed to `fold(lines)` a slice at a time,
// so the server answers between slices of one that runs to hundreds of megabytes. One read of `read` at a time: two would
// fold the same lines in twice.
export const readGrown = (file, read, fold) => {
	const reading = (read.reading ?? Promise.resolve()).then(async () => {
		// The rest is still being written, or cut at the slice's end, perhaps mid-character
		for (let size = GROWN_SLICE_BYTES, done = false; !done && read.offset < file.size;)
			[size, done] = await inTurn(async () => {
				const bytes = new Uint8Array(await file.slice(read.offset, read.offset + size).arrayBuffer());
				const through = bytes.lastIndexOf(NEWLINE) + 1;

				if (!through && read.offset + size >= file.size) return [size, true];
				// One line longer than the slice
				if (!through) return [size * 2, false];
				read.offset += through;
				fold(decoder.decode(bytes.subarray(0, through)).split('\n'));

				return [GROWN_SLICE_BYTES, false];
			});
	});

	read.reading = reading.catch(() => {});

	return reading;
};

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
// { [id]: { offset, carry, next } }: where each transcript said its session went on, as of how far it was read, and
// the line it was cut partway through
const continuations = new Map();
// { [id carried on in]: the id it was carried on from, the one before it in the chain }
const continuedFrom = new Map();
// The lines that say where a session went: a move, or the conversation going on. Inside another line's text a quote is
// escaped, so a transcript quoting one isn't taken for one.
const SAYS_WHERE = /"type":"(?:continued-in|user|assistant)"/;

// Where the session went, after these lines: a move sends it on, and only where it ended counts, since a conversation
// taken up again under its old id afterwards went on here, not there
const foldWhere = (id, next, lines) => {
	for (const text of lines) {
		if (!SAYS_WHERE.test(text)) continue;

		const [line] = parsed(text);

		if (line?.type === 'continued-in' && line.sessionId === id) next = line.continuedInSessionId;
		else if (['user', 'assistant'].includes(line?.type)) next = null;
	}

	return next;
};

// The session Claude carried this one on in, as when it moves a session to the background: a resume that forks it, so
// the new transcript holds the whole conversation, and the old one ends saying where it went. Its end is read once,
// then only what it has grown by.
// One read of each at a time, shared by whoever asks meanwhile: every look at a transcript asks, and while one waits its
// turn, each would read the same end again
const continuing = new Map();

const continuedIn = (id, file) => {
	const known = continuations.get(id);

	if (known?.next || known?.offset === file.size) return known.next;
	if (continuing.has(id)) return continuing.get(id);

	const reading = (async () => {
		const from =
			!known || file.size < known.offset
				? { offset: Math.max(0, file.size - CONTINUED_TAIL_BYTES), carry: '', next: null }
				: known;
		return inTurn(async () => {
			const lines = (from.carry + (await file.slice(from.offset, file.size).text())).split('\n');
			const carry = lines.pop();
			const found = foldWhere(id, from.next, lines);

			continuations.set(id, { offset: file.size, carry, next: found });

			return found;
		});
	})().finally(() => continuing.delete(id));

	continuing.set(id, reading);

	return reading;
};

// Where a session is now: the id Claude has carried it on under and that transcript, following each move on from the
// id paude started it as. { id, file }, file null when there's no transcript yet.
const latest = async (id, cwd) => {
	const seen = new Set([id]);
	let file = await ownFile(id, cwd);
	let at = id;

	while (file) {
		const next = await continuedIn(at, file);
		const onward = next && !seen.has(next) && (await ownFile(next, cwd));

		if (!onward) break;
		seen.add(next);
		continuedFrom.set(next, at);
		[at, file] = [next, onward];
	}

	return { id: at, file };
};

// A session's transcript, wherever Claude has carried it on to since: paude keeps the id it started the session as
export const transcriptFile = async (id, cwd) => (await latest(id, cwd)).file;

// The id to take a session back up under: the one Claude last carried it on in, so a resume has every turn since
export const resumeId = async (id, cwd) => (await latest(id, cwd)).id;

// The session a transcript carries on, the id paude started it as however many moves back, of those whose transcripts
// have been read; undefined for none
export const carriesOn = id => {
	const seen = new Set([id]);
	let from = continuedFrom.get(id);

	while (continuedFrom.has(from) && !seen.has(continuedFrom.get(from))) {
		seen.add(from);
		from = continuedFrom.get(from);
	}

	return from;
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
export const firstPromptOf = (id, cwd) => {
	if (!firstPrompts.has(id))
		firstPrompts.set(
			id,
			readFirstPrompt(id, cwd).catch(error => {
				firstPrompts.delete(id);
				throw error;
			}),
		);

	return firstPrompts.get(id);
};

// Kept as the read on its way, so a listing while it waits its turn doesn't read it again
const readFirstPrompt = async (id, cwd) => {
	const file = await transcriptFile(id, cwd);

	return file
		? inTurn(
				async () =>
					parsed(await file.slice(0, PROMPT_SCAN_BYTES).text())
						.map(promptText)
						.find(text => text && !/^\[Request interrupted/.test(text)) ?? null,
			)
		: null;
};
