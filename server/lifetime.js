import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { isBrief, keepSession, markBrief } from './briefSessions';
import { DEFAULT_HOURS, keepWarm, warmUntil } from './keepWarm';

// How long a session lasts: 'ordinary' (until it's deleted), 'warm' (kept warm while you're away), or 'brief'
// (deleted once its cache lets go with nobody in it). Set when it starts, and changed whenever.
export const LIFETIMES = ['ordinary', 'warm', 'brief'];
// A switch made by hand stays on show this long, to be put back: the hour Claude's cache holds a conversation, inside
// which putting it back finds things as they were. { [sessionId]: { was, at } }
export const UNDO_MS = 60 * 60 * 1000;

let file;
let switched = {};

const save = () => file && writeJsonFile(file, () => switched);

export const initLifetime = async dataDir => {
	file = path.join(dataDir, 'lifetime-switches.json');
	switched = await readJsonFile(file, {});
};

export const lifetimeOf = id => {
	if (warmUntil(id)) return 'warm';

	return isBrief(id) ? 'brief' : 'ordinary';
};

// The lifetime it had before the last switch by hand, while that can still be walked back: { was, until }
export const lastSwitch = (id, now = Date.now()) => {
	const { was, at } = switched[id] ?? {};

	return at > now - UNDO_MS ? { was, until: at + UNDO_MS } : null;
};

export const setLifetime = async (id, lifetime) => {
	await keepWarm(id, lifetime === 'warm' ? DEFAULT_HOURS : 0);
	if (lifetime === 'brief') await markBrief(id);
	else await keepSession(id);

	return lifetimeOf(id);
};

// A switch by hand: what it was is kept to put back, and putting it back leaves nothing to undo
export const switchLifetime = async (id, lifetime, now = Date.now()) => {
	const was = lifetimeOf(id);

	if (was !== lifetime) {
		if (lastSwitch(id, now)?.was === lifetime) delete switched[id];
		else switched[id] = { was, at: now };
		for (const [other, { at }] of Object.entries(switched)) if (at <= now - UNDO_MS) delete switched[other];
		await save();
	}

	return setLifetime(id, lifetime);
};
