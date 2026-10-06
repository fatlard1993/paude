import path from 'path';

import writeJsonFile from '../shared/writeJsonFile';

// What happens in each session, counted, and who watches which: { [sessionId]: { seq, status, at } } and
// { [identity]: { [sessionId]: { watching, seen } } }. A watcher's unseen count is the session's count past the
// one they last saw.
let activityFile;
let watchesFile;
let activity = {};
let watches = {};
const listeners = new Set();

const load = async file => ((await Bun.file(file).exists()) ? Bun.file(file).json() : {});

export const initActivity = async dataDir => {
	activityFile = path.join(dataDir, 'activity.json');
	watchesFile = path.join(dataDir, 'watches.json');
	activity = await load(activityFile);
	watches = await load(watchesFile);
};

const saveActivity = () => writeJsonFile(activityFile, () => activity);
const saveWatches = () => writeJsonFile(watchesFile, () => watches);

// The owner on every device is one person; each invite is its own guest
export const identityKey = identity => {
	if (identity?.owner) return 'owner';

	return identity?.inviteId ? `invite:${identity.inviteId}` : null;
};

const record = sessionId => {
	activity[sessionId] ??= { seq: 0, status: 'ready', at: Date.now() };

	return activity[sessionId];
};

export const onActivity = listener => listeners.add(listener);

const announce = sessionId => listeners.forEach(listener => listener(sessionId));

export const statusOf = sessionId => record(sessionId).status;

// A turn finished, or someone chatted, commented or replied
export const recordChange = async sessionId => {
	const entry = record(sessionId);

	entry.seq += 1;
	entry.at = Date.now();
	announce(sessionId);
	await saveActivity();
};

// 'working', 'waiting' (Claude asked something: a permission, a question) or 'ready' (for the next prompt)
export const setStatus = async (sessionId, status) => {
	const entry = record(sessionId);

	if (entry.status === status) return;

	entry.status = status;
	announce(sessionId);
	await saveActivity();
};

const entryFor = (identity, sessionId) => watches[identityKey(identity)]?.[sessionId];

export const setWatching = async (identity, sessionId, watching) => {
	const key = identityKey(identity);

	if (!key) return;

	const entry = (watches[key] ??= {})[sessionId] ?? { seen: record(sessionId).seq };

	watches[key][sessionId] = { ...entry, watching };
	await saveWatches();
};

// Watching starts on its own the first time someone joins, posts or prompts; turning it off by hand sticks
export const watchIfNew = async (identity, sessionId) => {
	if (identityKey(identity) && !entryFor(identity, sessionId)) await setWatching(identity, sessionId, true);
};

export const markSeen = async (identity, sessionId) => {
	const entry = entryFor(identity, sessionId);
	const { seq } = record(sessionId);

	if (!entry || entry.seen === seq) return;

	entry.seen = seq;
	await saveWatches();
};

export const watchedBy = identity =>
	Object.entries(watches[identityKey(identity)] ?? {})
		.filter(([, entry]) => entry.watching)
		.map(([sessionId]) => sessionId);

// A session that isn't running is 'stopped'; reopening it resumes it
export const activitySummary = (identity, sessionId, { running, busy }) => {
	const { seq, status, at } = record(sessionId);
	const entry = entryFor(identity, sessionId);
	let shown = 'stopped';

	if (running) shown = busy ? 'working' : 'ready';
	// A question outranks the spinner: Claude can't go on until someone answers
	if (running && status === 'waiting') shown = 'waiting';

	return {
		status: shown,
		watching: Boolean(entry?.watching),
		unseen: entry?.watching ? Math.max(seq - entry.seen, 0) : 0,
		activeAt: at,
	};
};

export const forgetActivity = async sessionId => {
	delete activity[sessionId];
	for (const entries of Object.values(watches)) delete entries[sessionId];
	await Promise.all([saveActivity(), saveWatches()]);
};
