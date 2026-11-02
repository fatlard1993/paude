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
// next is Haiku's, from only the end of Claude's reply: a suggestion for Claude to weigh against all it knows
export const nudgeWith = next =>
	[
		NUDGE_MARK,
		'carry on toward what the person asked for.',
		next?.trim() &&
			`A suggestion from a reader who saw only the end of your last reply, so check it against what you know before following it: ${next.trim()}`,
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
// { [sessionId]: { hours, until, going } }: going, it also keeps going on its own (keepGoing)
let warm = {};
// When Claude last did anything (any hook), per session; a ping is due PING_AFTER_MS after
const lastTurnAt = new Map();
// Sessions whose turn now is a ping, so it isn't news to anyone watching
const pinged = new Set();

const save = () => writeJsonFile(file, () => warm);

const HOUR_MS = 60 * 60 * 1000;

export const warmUntil = (id, now = Date.now()) => (warm[id]?.until > now ? warm[id].until : null);

export const goingOn = (id, now = Date.now()) => Boolean(warmUntil(id, now) && warm[id].going);

export const keepWarm = async (id, hours, now = Date.now(), { going = false } = {}) => {
	if (hours > 0) {
		const kept = Math.min(hours, MAX_HOURS);

		warm[id] = { hours: kept, until: now + kept * HOUR_MS, ...(going && { going }) };
		if (!lastTurnAt.has(id)) lastTurnAt.set(id, now);
	} else delete warm[id];
	console.log(
		`Keep ${going ? 'going' : 'warm'} ${id}: ${hours > 0 ? `on until ${new Date(warm[id].until).toISOString()}` : 'off'}`,
	);
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

// Typed in only when Claude is idle with an empty prompt box: paude's own prompt must neither answer a question Claude
// asked nor run into what someone is halfway through typing. Whether it was.
export const typeWhenIdle = (id, session, text) => {
	if (session.busy || statusOf(id) !== 'ready' || session.promptDraft() !== '') return false;

	session.typeIn(`\x1b[200~${text}\x1b[201~`);
	setTimeout(() => session.typeIn('\r'), ENTER_AFTER_MS);

	return true;
};

// Not typed now: tried again next check
const ping = (id, session, now) => {
	if (!typeWhenIdle(id, session, PING)) return false;

	noteCrew('keeping a session warm');
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
	const checking = setInterval(
		() => checkWarm(sessionOf).catch(error => console.error('Keeping sessions warm failed:', error)),
		CHECK_MS,
	).unref();

	return () => clearInterval(checking);
};
