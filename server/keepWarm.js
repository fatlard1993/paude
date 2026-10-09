import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { statusOf } from './activity';

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
// Claude Code takes a paste and its Enter as one keystroke if they arrive together
const ENTER_AFTER_MS = 300;

let file;
// { [sessionId]: { hours, until } }
let warm = {};
// When Claude last did anything (any hook), per session; a ping is due PING_AFTER_MS after
const lastTurnAt = new Map();
// Sessions whose turn now is a ping, so it isn't news to anyone watching
const pinged = new Set();

const save = () => writeJsonFile(file, () => warm);

const HOUR_MS = 60 * 60 * 1000;

export const warmUntil = (id, now = Date.now()) => (warm[id]?.until > now ? warm[id].until : null);

export const keepWarm = async (id, hours, now = Date.now()) => {
	if (hours > 0) {
		const kept = Math.min(hours, MAX_HOURS);

		warm[id] = { hours: kept, until: now + kept * HOUR_MS };
		if (!lastTurnAt.has(id)) lastTurnAt.set(id, now);
	} else delete warm[id];
	console.log(`Keep warm ${id}: ${hours > 0 ? `on until ${new Date(warm[id].until).toISOString()}` : 'off'}`);
	if (file) await save();

	return warmUntil(id, now);
};

export const stopKeepingWarm = async id => {
	lastTurnAt.delete(id);
	pinged.delete(id);
	if (!(id in warm)) return;
	console.log(`Keep warm ${id}: off, the session ended`);
	delete warm[id];
	if (file) await save();
};

// A hook from the session: Claude is doing something, which reads the cache anyway. A real prompt (not a ping) starts
// the hours it's kept warm over. Returns whether the turn this ends was a ping, for the Stop that ends it.
export const claudeActive = (id, { hook_event_name: event, prompt } = {}, now = Date.now()) => {
	lastTurnAt.set(id, now);
	if (event === 'UserPromptSubmit') {
		if (String(prompt ?? '').includes(PING)) pinged.add(id);
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

// Typed in only when Claude is idle with an empty prompt box: a ping must neither answer a question Claude asked nor
// run into what someone is halfway through typing. Otherwise it's tried again next check.
const ping = (id, session, now) => {
	if (session.busy || statusOf(id) !== 'ready' || session.promptDraft() !== '') return false;

	session.typeIn(`\x1b[200~${PING}\x1b[201~`);
	setTimeout(() => session.typeIn('\r'), ENTER_AFTER_MS);
	lastTurnAt.set(id, now);

	return true;
};

// Pings each warm session gone quiet, and lets go of those past their cutoff or no longer running
export const checkWarm = async (sessionOf, now = Date.now()) => {
	const pings = [];
	let changed = false;

	for (const [id, { until }] of Object.entries(warm)) {
		const session = sessionOf(id);

		// Not heard from since this server started: counted from now
		if (!lastTurnAt.has(id)) lastTurnAt.set(id, now);
		if (until <= now || !session) {
			console.log(`Keep warm ${id}: off, ${session ? 'past its cutoff' : 'not running'}`);
			delete warm[id];
			changed = true;
		} else if (now - lastTurnAt.get(id) >= PING_AFTER_MS && ping(id, session, now)) pings.push(id);
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
	setInterval(
		() => checkWarm(sessionOf).catch(error => console.error('Keeping sessions warm failed:', error)),
		CHECK_MS,
	).unref();
};
