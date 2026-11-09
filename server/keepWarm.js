import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { statusOf } from './activity';
import { noteCrew } from './crew';

// Sessions kept warm while nobody's in them: once Claude has been quiet this long, paude types a ping it answers in a
// word. That reads the conversation from Claude's prompt cache, which keeps it there another hour. Claude Code compacts
// an idle conversation of 200k tokens or more 54 minutes after its last request (unless "idleCompaction": false), and
// that request began before the hook that says the turn ended: 50 minutes, with the minute between checks, comes
// before either. Each ping costs a cached read of the whole conversation, so it stops once nobody has sent the session
// anything for a while: the hours it's kept warm count from the last real prompt, not from when it was turned on.
export const PING_AFTER_MS = 50 * 60 * 1000;
export const DEFAULT_HOURS = 12;
export const MAX_HOURS = 48;
const CHECK_MS = 60 * 1000;
export const PING = 'keep-warm ping from paude: reply with only "·" and no tool calls';
// What a session that keeps going is sent after each turn that doesn't need the person: what to do next toward their
// goal, or failing that, something useful toward it. Said to be paude's, not the person's, so neither Claude nor what
// reads the transcript later takes it as the person agreeing to what was proposed.
const NUDGE_MARK = 'keep-going nudge from paude, not the person:';
// next is a suggestion for Claude to weigh against all it knows: Haiku's, from only the end of Claude's reply, or a
// fabled session's monitor's, which has followed the run and read the repository
// A suggestion is a sentence or two; one that runs on is cut, since it's typed into Claude's prompt
const NEXT_CHARACTERS = 800;

export const nudgeWith = (next, { fabled = false } = {}) =>
	[
		NUDGE_MARK,
		'carry on toward what the person asked for.',
		next?.trim() &&
			(fabled
				? `A suggestion from a monitor that has followed this run and read the repository; weigh it against what you know before following it: ${next.trim().slice(0, NEXT_CHARACTERS)}`
				: `A suggestion from a reader who saw only the end of your last reply, so check it against what you know before following it: ${next.trim().slice(0, NEXT_CHARACTERS)}`),
		"If the goal's next step is done or waits on them, do the most useful thing toward it that doesn't: check the work end to end, cover the edge cases, fix rough edges you noticed, look for the same fault elsewhere. Leave any question for them standing in your reply, not answered for them, and never push, deploy, release, post, delete, or run anything against other machines, services or people without them.",
	]
		.filter(Boolean)
		.join(' ');
// Claude Code keeps a long paste inside <pasted_content> tags, in the transcript and in what its hooks are sent
export const isNudge = prompt =>
	String(prompt ?? '')
		.replace(/^\s*<pasted_content[^>]*>\s*/, '')
		.startsWith(NUDGE_MARK);
// Claude Code takes a paste and its Enter as one keystroke if they arrive together
const ENTER_AFTER_MS = 300;

let file;
// { [sessionId]: { hours, until, going, fabled, monitor, seen, missed, read, asking } }: going, it also keeps going on its
// own (keepGoing), `asking` the turn whose end it's still answering, for a server that restarts meanwhile to answer it;
// fabled, with a Fable monitor of its own (fabled), `monitor` its conversation's id, `seen` the last turn it was told
// of, `missed` how many asks in a row brought no verdict and `read` when it last read its conversation (asked, or
// pinged), kept here so its keep-warm clock survives a restart. The monitor is kept through a switch to warm or going,
// to be put back, and goes with the record.
let warm = {};
// When Claude last did anything (any hook), per session; a ping is due PING_AFTER_MS after
const lastTurnAt = new Map();
// Sessions whose turn now is a ping, so it isn't news to anyone watching
const pinged = new Set();
// The last ping or nudge typed into each: { [sessionId]: { kind: 'warm' | 'going' | 'fabled', at } }
const boosts = new Map();

const save = () => writeJsonFile(file, () => warm);

const HOUR_MS = 60 * 60 * 1000;

export const warmUntil = (id, now = Date.now()) => (warm[id]?.until > now ? warm[id].until : null);

export const goingOn = (id, now = Date.now()) => Boolean(warmUntil(id, now) && warm[id].going);

export const fabledOn = (id, now = Date.now()) => Boolean(goingOn(id, now) && warm[id].fabled);

// A fabled session's monitor conversation, the last turn it was told of, and how many asks in a row brought no
// verdict: { monitor, seen, missed }
export const monitorOf = id =>
	warm[id]?.monitor ? { monitor: warm[id].monitor, seen: warm[id].seen ?? null, missed: warm[id].missed ?? 0 } : null;

// What's done with a monitor's conversation once its record lets go of it: fabled deletes it. Registered rather than
// imported, since it runs Claude and that pulls this module in
let forgetMonitor = async () => {};

export const forgetMonitorsWith = forget => {
	forgetMonitor = forget;
};

// And what keeps a fabled session's monitor warm once it has been quiet long enough: its conversation read from the
// cache, so a verdict after an idle hour isn't a fresh read of all of it. Registered for the same reason.
let warmMonitor = async () => {};

export const warmMonitorsWith = warmer => {
	warmMonitor = warmer;
};

// The monitor was told up to this turn, or missed another ask; `monitor` null forgets it (its conversation gone), for a
// new one to be briefed
export const noteMonitor = async (id, { monitor, seen = null, missed = 0 }, now = Date.now()) => {
	if (!warm[id]) return;
	if (monitor) {
		const { missed: _, ...rest } = warm[id];

		warm[id] = { ...rest, monitor, seen, read: now, ...(missed ? { missed } : {}) };
	} else {
		const { monitor: gone, seen: _, missed: __, read: ___, ...rest } = warm[id];

		warm[id] = rest;
		await forgetMonitor(gone);
	}
	if (file) await save();
};

// A session that keeps going is answering the end of turn `turnId` (null once answered), from `now`: saved, so a
// server that restarts meanwhile knows to answer it
export const noteAsking = async (id, turnId, now = Date.now()) => {
	if (!warm[id] || (warm[id].asking ?? null) === (turnId ?? null)) return;
	if (turnId) warm[id] = { ...warm[id], asking: turnId, askingAt: now };
	else {
		const { asking: _, askingAt: __, ...rest } = warm[id];

		warm[id] = rest;
	}
	if (file) await save();
};

// Its keeper reading its latest reply to decide what next, for the universe to show the reply with it rather than
// waiting on anyone: { kind: 'going' | 'fabled', ago }, or null
export const readingOf = (id, now = Date.now()) => {
	const kept = keptOf(id, now);

	if (!warm[id]?.asking || !kept || kept === 'warm') return null;

	return { kind: kept, ago: now - (warm[id].askingAt ?? now) };
};

// The sessions whose turn end was being answered when the server last stopped
export const askingSessions = () => Object.keys(warm).filter(id => warm[id].asking && goingOn(id));

const letGo = id => {
	const { monitor } = warm[id] ?? {};

	delete warm[id];
	if (monitor) forgetMonitor(monitor).catch(() => {});
};

export const keepWarm = async (id, hours, now = Date.now(), { going = false, fabled = false } = {}) => {
	if (hours > 0) {
		const kept = Math.min(hours, MAX_HOURS);
		const { monitor, seen, missed, read } = warm[id] ?? {};

		warm[id] = {
			hours: kept,
			until: now + kept * HOUR_MS,
			...((going || fabled) && { going: true }),
			...(fabled && { fabled: true, monitor: monitor ?? crypto.randomUUID() }),
			...(!fabled && monitor && { monitor }),
			...(monitor && seen && { seen }),
			...(monitor && missed && { missed }),
			...(monitor && read && { read }),
		};
		if (!lastTurnAt.has(id)) lastTurnAt.set(id, now);
	} else letGo(id);
	console.log(
		`Keep ${(fabled && 'fabled') || (going && 'going') || 'warm'} ${id}: ${hours > 0 ? `on until ${new Date(warm[id].until).toISOString()}` : 'off'}`,
	);
	if (file) await save();

	return warmUntil(id, now);
};

export const stopKeepingWarm = async id => {
	lastTurnAt.delete(id);
	pinged.delete(id);
	if (!(id in warm)) return;
	console.log(`Keep warm ${id}: off, the session ended`);
	letGo(id);
	if (file) await save();
};

// A hook from the session: Claude is doing something, which reads the cache anyway. A real prompt (not a ping) starts
// the hours it's kept warm over; a nudge to keep going is paude's, and doesn't. Returns whether the turn this ends was a ping, for the Stop that ends it.
export const claudeActive = (id, { hook_event_name: event, prompt } = {}, now = Date.now()) => {
	lastTurnAt.set(id, now);
	if (event === 'UserPromptSubmit') {
		if (String(prompt ?? '').includes(PING)) pinged.add(id);
		else if (isNudge(prompt)) pinged.delete(id);
		else {
			pinged.delete(id);
			if (warm[id]) {
				warm[id] = { ...warm[id], until: now + warm[id].hours * HOUR_MS };
				if (file) save();
			}
		}
	}

	return pinged.has(id);
};

// Control characters have no place in a prompt: an escape could end the paste early and hand the rest to the terminal.
// Tabs and newlines stay; a paste keeps them as text.
const isControl = code => (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159);
const withoutControls = text => [...String(text)].filter(character => !isControl(character.charCodeAt(0))).join('');

const isIdle = (id, session) => !session.busy && statusOf(id) === 'ready';

// Typed in only when Claude is idle with an empty prompt box: paude's own prompt must neither answer a question Claude
// asked nor run into what someone is halfway through typing. Whether it was.
export const typeWhenIdle = (id, session, text, now = Date.now()) => {
	if (!isIdle(id, session) || session.promptDraft() !== '') return false;

	session.typeIn(`\x1b[200~${withoutControls(text)}\x1b[201~`);
	setTimeout(() => session.typeIn('\r'), ENTER_AFTER_MS);
	if (text === PING) boosts.set(id, { kind: 'warm', at: now });
	else if (isNudge(text)) boosts.set(id, { kind: fabledOn(id, now) ? 'fabled' : 'going', at: now });

	return true;
};

// The last keep-warm ping or keep-going nudge typed into a session, for the universe to show it taken: { kind, ago }
export const boostOf = (id, now = Date.now()) => {
	const boost = boosts.get(id);

	return boost ? { kind: boost.kind, ago: now - boost.at } : null;
};

// How it's kept: 'fabled' (going, with a Fable monitor of its own), 'going' (warm, and nudged on), 'warm', or null
export const keptOf = (id, now = Date.now()) =>
	(fabledOn(id, now) && 'fabled') || (goingOn(id, now) && 'going') || (warmUntil(id, now) && 'warm') || null;

// A draft nobody has touched this long is left, not being written: the ping won't wait on it, since the cache it keeps
// would be gone before they're back
export const DRAFT_LEFT_MS = 2 * 60 * 1000;
// Claude Code's stash (ctrl+s): it keeps the draft with its cursor and pastes, and puts it back once a prompt is sent
const STASH = '\x13';
const STASH_CHECKS = 20;

// The box emptied by the stash, and the ping typed in. Whether it was; a draft still there is left as it stands.
const stashThenPing = async (id, session, now, pause) => {
	const draft = session.promptDraft();

	if (!draft || !isIdle(id, session) || now - (session.typedAt ?? 0) < DRAFT_LEFT_MS) return false;
	session.typeIn(STASH);
	for (let check = 0; check < STASH_CHECKS && session.promptDraft() !== ''; check += 1) await pause();
	if (session.promptDraft() !== '') {
		console.log(`Keep warm ${id}: not pinged, the stash didn't empty the prompt box`);

		return false;
	}
	console.log(`Keep warm ${id}: a draft left in the prompt box is stashed for the ping, and comes back with it`);

	return typeWhenIdle(id, session, PING, now);
};

// Not typed now: tried again next check
const ping = async (id, session, now, pause) => {
	if (!typeWhenIdle(id, session, PING, now) && !(await stashThenPing(id, session, now, pause))) return false;

	noteCrew('keeping a session warm');
	lastTurnAt.set(id, now);

	return true;
};

// Pings each warm session gone quiet, and lets go of those past their cutoff or no longer running
export const checkWarm = async (sessionOf, now = Date.now(), { pause = () => Bun.sleep(100) } = {}) => {
	const pings = [];
	let changed = false;

	for (const [id, { until }] of Object.entries(warm)) {
		const session = sessionOf(id);

		// Not heard from since this server started: counted from now
		if (!lastTurnAt.has(id)) lastTurnAt.set(id, now);
		if (until <= now || !session) {
			console.log(`Keep warm ${id}: off, ${session ? 'past its cutoff' : 'not running'}`);
			letGo(id);
			changed = true;
		} else {
			if (now - lastTurnAt.get(id) >= PING_AFTER_MS && (await ping(id, session, now, pause))) pings.push(id);
			// Its monitor on its own clock: pinged once it has been quiet this long, whether or not the session could be, since
			// a session busy, asking or being typed into isn't pinged and its monitor's cache runs out regardless
			if (fabledOn(id, now) && warm[id].monitor) {
				// Never read that it knows of (kept before `read` was): counted from now
				if (!warm[id].read) {
					warm[id] = { ...warm[id], read: now };
					changed = true;
				}
				if (now - warm[id].read >= PING_AFTER_MS) {
					warm[id] = { ...warm[id], read: now };
					changed = true;
					pings.push(`${id}'s monitor`);
					warmMonitor(id, warm[id].monitor, session.cwd).catch(error =>
						console.error(`Keeping ${id}'s monitor warm failed:`, error),
					);
				}
			}
		}
	}
	if (changed && file) await save();

	return pings;
};

export const initKeepWarm = async (dataDir, sessionOf) => {
	file = path.join(dataDir, 'keep-warm.json');
	// Kept before as a bare cutoff
	warm = Object.fromEntries(
		Object.entries(await readJsonFile(file, {})).map(([id, kept]) => [
			id,
			typeof kept === 'number' ? { hours: DEFAULT_HOURS, until: kept } : kept,
		]),
	);
	const checking = setInterval(
		() => checkWarm(sessionOf).catch(error => console.error('Keeping sessions warm failed:', error)),
		CHECK_MS,
	).unref();

	return () => clearInterval(checking);
};
