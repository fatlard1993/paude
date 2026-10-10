import { expect, test } from 'bun:test';

import { checkBrief, dueToGo, isBrief, keepSession, markBrief } from './briefSessions';

const HOUR = 60 * 60 * 1000;
const idle = { clients: new Set(), busy: false };

test('due once the cache has let go with nobody in it and Claude idle', () => {
	const base = { startedAt: 0, warmUntil: 2 * HOUR, session: idle, status: 'ready', limited: false };

	expect(dueToGo(base, 2 * HOUR - 1)).toBe(false);
	expect(dueToGo(base, 2 * HOUR)).toBe(true);
	expect(dueToGo({ ...base, session: { ...idle, clients: new Set(['someone']) } }, 3 * HOUR)).toBe(false);
	expect(dueToGo({ ...base, session: { ...idle, busy: true } }, 3 * HOUR)).toBe(false);
	expect(dueToGo({ ...base, status: 'waiting' }, 3 * HOUR)).toBe(false);
	expect(dueToGo({ ...base, limited: true }, 3 * HOUR)).toBe(false);
	// Ended already, nobody can be in it
	expect(dueToGo({ ...base, session: undefined }, 3 * HOUR)).toBe(true);
	// Never prompted: an hour after it started
	expect(dueToGo({ ...base, warmUntil: null }, HOUR - 1)).toBe(false);
	expect(dueToGo({ ...base, warmUntil: null }, HOUR)).toBe(true);
});

test('the sweep deletes what is due, once, and a kept session is never deleted', async () => {
	const removed = [];
	const sweep = {
		sessionOf: () => idle,
		meterOf: async () => ({ warmUntil: HOUR }),
		remove: async id => removed.push(id),
	};

	await markBrief('quick', 0);
	await markBrief('kept', 0);
	await keepSession('kept');

	expect(await checkBrief(sweep, HOUR - 1)).toEqual([]);
	expect(await checkBrief(sweep, HOUR)).toEqual(['quick']);
	expect(await checkBrief(sweep, 2 * HOUR)).toEqual([]);
	expect(removed).toEqual(['quick']);
	expect(isBrief('quick')).toBe(false);
	expect(isBrief('kept')).toBe(false);
});
