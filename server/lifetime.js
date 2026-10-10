import { isBrief, keepSession, markBrief } from './briefSessions';
import { DEFAULT_HOURS, keepWarm, warmUntil } from './keepWarm';

// How long a session lasts: 'ordinary' (until it's deleted), 'warm' (kept warm while you're away), or 'brief'
// (deleted once its cache lets go with nobody in it). Set when it starts, and changed whenever.
export const LIFETIMES = ['ordinary', 'warm', 'brief'];

export const lifetimeOf = id => {
	if (warmUntil(id)) return 'warm';

	return isBrief(id) ? 'brief' : 'ordinary';
};

export const setLifetime = async (id, lifetime) => {
	await keepWarm(id, lifetime === 'warm' ? DEFAULT_HOURS : 0);
	if (lifetime === 'brief') await markBrief(id);
	else await keepSession(id);

	return lifetimeOf(id);
};
