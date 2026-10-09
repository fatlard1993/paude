import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { statusOf } from './activity';

// Sessions stopped by a usage limit: when it resets, as Claude said, and whether paude is to carry on then. Claude Code
// carries on by itself at the reset unless that's turned off ("Continue automatically at usage limit"), or the reset
// passed while the machine slept, when it waits for Enter; whatever it does, the next sign of Claude working clears
// the session here. { [sessionId]: { at, resetAt, armed, stale } }
const CHECK_MS = 60 * 1000;
// Past the reset, a moment for Claude Code to carry on by itself first
const AFTER_RESET_MS = 2 * 60 * 1000;
// A reset Claude didn't say: tried again this often, a try that's still limited costing nothing
const RETRY_UNKNOWN_MS = 30 * 60 * 1000;
const CONTINUE = 'continue';
// Claude Code takes a paste and its Enter as one keystroke if they arrive together
const ENTER_AFTER_MS = 300;
// Each month's short name, in order, as Claude writes it
const MONTHS = Array.from({ length: 12 }, (_, month) =>
	new Date(Date.UTC(2000, month, 15)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toLowerCase(),
);

let file;
let limited = {};
const listeners = new Set();

const save = () => file && writeJsonFile(file, () => limited);

const changed = id => listeners.forEach(listener => listener(id));

export const onLimitChange = listener => listeners.add(listener);

export const limitOf = id => limited[id] ?? null;

// The wall-clock parts of `time` in a time zone (the server's own without one)
const partsIn = (time, zone) => {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		hourCycle: 'h23',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
	}).formatToParts(time);
	const part = type => Number(parts.find(found => found.type === type)?.value);

	return { month: part('month') - 1, day: part('day'), hour: part('hour'), minute: part('minute') };
};

// The next minute on or after `now` that reads as the given wall-clock time in `zone`, within eight days
const nextWallClock = ({ month, day, hour, minute }, zone, now) => {
	const start = Math.ceil(now / 60_000) * 60_000;

	for (let time = start; time < start + 8 * 24 * 60 * 60_000; time += 60_000) {
		const at = partsIn(time, zone);

		if (at.hour === hour && at.minute === minute && (month === undefined || (at.month === month && at.day === day)))
			return time;
	}

	return null;
};

const validZone = zone => {
	try {
		return zone && new Intl.DateTimeFormat('en-US', { timeZone: zone }) && zone;
	} catch {
		return undefined;
	}
};

// When the limit resets, from what Claude said: "resets 3pm (America/Denver)", "resets at 3:30pm", "resets Oct 12,
// 9am", "resets in 2h 15m". null when it doesn't say.
export const resetTimeOf = (text, now = Date.now()) => {
	const said = String(text ?? '');
	const within = /resets?\s+in\s+(?:(\d+)\s*h\w*)?\s*(?:(\d+)\s*m\w*)?/i.exec(said);

	if (within && (within[1] || within[2])) return now + (Number(within[1] ?? 0) * 60 + Number(within[2] ?? 0)) * 60_000;

	const at =
		/resets?\s+(?:at\s+)?(?:([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i.exec(
			said,
		);

	if (!at) return null;

	const [, monthName, day, hourText, minuteText, halfOfDay, zone] = at;
	const month = monthName ? MONTHS.indexOf(monthName.slice(0, 3).toLowerCase()) : -1;
	const hour = (Number(hourText) % 12) + (halfOfDay.toLowerCase() === 'pm' ? 12 : 0);

	return nextWallClock(
		{
			hour,
			minute: Number(minuteText ?? 0),
			...(month >= 0 && { month, day: Number(day) }),
		},
		validZone(zone),
		now,
	);
};

// A hook from the session: a turn that ended on the limit, Claude Code's own carrying on, or anything that shows
// Claude working again. Returns whether the session's limit changed.
export const limitHook = async (id, payload, now = Date.now()) => {
	const event = payload?.hook_event_name;
	const type = payload?.notification_type;

	if (event === 'StopFailure' && payload.error === 'rate_limit') {
		limited[id] = {
			at: now,
			resetAt: resetTimeOf(`${payload.last_assistant_message ?? ''} ${payload.error_details ?? ''}`, now),
			armed: limited[id]?.armed ?? false,
			stale: false,
		};
	} else if (event === 'Notification' && type === 'quota_auto_resume_stale' && limited[id]) {
		limited[id] = { ...limited[id], stale: true };
	} else if (
		limited[id] &&
		(['UserPromptSubmit', 'PostToolUse', 'Stop'].includes(event) ||
			(event === 'Notification' && type === 'quota_auto_resume_fired'))
	) {
		delete limited[id];
	} else return false;

	await save();
	changed(id);

	return true;
};

// Carries on now: Enter when Claude Code is waiting for one, otherwise "continue" typed into an empty prompt box.
// false when Claude is busy or something is typed there.
const carryOn = (id, session) => {
	const limit = limited[id];

	if (!session || session.busy || statusOf(id) === 'waiting') return false;
	if (limit?.stale) {
		session.typeIn('\r');

		return true;
	}
	if (session.promptDraft() !== '') return false;

	session.typeIn(`\x1b[200~${CONTINUE}\x1b[201~`);
	setTimeout(() => session.typeIn('\r'), ENTER_AFTER_MS);

	return true;
};

// 'now', or 'reset' to carry on once the limit resets (false to stop waiting for it)
export const continueSession = async (id, session, when) => {
	if (when === 'now') return carryOn(id, session);
	if (!limited[id]) return false;

	limited[id] = { ...limited[id], armed: when === 'reset', triedAt: null };
	await save();
	changed(id);

	return true;
};

// Carries on the armed sessions whose reset has come; one whose reset Claude didn't say is tried every half hour
export const checkLimits = (sessionOf, now = Date.now()) => {
	const carried = [];
	let tried = false;

	for (const [id, limit] of Object.entries(limited)) {
		const due = limit.resetAt
			? now >= limit.resetAt + AFTER_RESET_MS
			: now - (limit.triedAt ?? limit.at) >= RETRY_UNKNOWN_MS;

		if (!limit.armed || !due) continue;
		tried = true;
		if (limit.resetAt) limit.armed = false;
		else limit.triedAt = now;
		if (carryOn(id, sessionOf(id))) carried.push(id);
		changed(id);
	}
	if (tried) save();

	return carried;
};

export const forgetLimit = async id => {
	if (!limited[id]) return;
	delete limited[id];
	await save();
};

export const initUsageLimits = async (dataDir, sessionOf) => {
	file = path.join(dataDir, 'usage-limits.json');
	limited = await readJsonFile(file, {});
	setInterval(() => checkLimits(sessionOf), CHECK_MS).unref();
};
