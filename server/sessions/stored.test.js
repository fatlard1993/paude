import { expect, test } from 'bun:test';

import { STORED_MS, forgetStoredSessions, storedSessions } from './stored';

test('one listing of the saved sessions serves every ask for a while, and is listed again once forgotten', async () => {
	let listed = 0;
	const list = async () => [{ sessionId: `listing ${++listed}`, cwd: '/repo' }];

	forgetStoredSessions();

	const [first, second] = await Promise.all([storedSessions({ now: 0, list }), storedSessions({ now: 1, list })]);

	expect(first).toEqual([{ sessionId: 'listing 1', cwd: '/repo' }]);
	expect(second).toBe(first);
	expect(await storedSessions({ now: STORED_MS - 1, list })).toBe(first);
	expect((await storedSessions({ now: STORED_MS, list }))[0].sessionId).toBe('listing 2');

	forgetStoredSessions();
	expect((await storedSessions({ now: STORED_MS + 1, list }))[0].sessionId).toBe('listing 3');
});

test('a listing that failed is not kept', async () => {
	forgetStoredSessions();

	const failing = async () => {
		throw new Error('unreadable');
	};

	expect(storedSessions({ now: 0, list: failing })).rejects.toThrow('unreadable');
	await Bun.sleep(0);
	expect(await storedSessions({ now: 1, list: async () => [] })).toEqual([]);
	forgetStoredSessions();
});
