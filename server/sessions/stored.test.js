import { expect, test } from 'bun:test';

import { STORED_MS, foldContinuations, forgetStoredSessions, storedSessions } from './stored';

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

test('a session Claude carried on under new ids is listed once, as its first id, as recent as where it went', () => {
	const firstOf = id => ({ moved: 'first', 'moved again': 'first', orphan: 'gone', loop: 'pool', pool: 'loop' })[id];
	const listed = foldContinuations(
		[
			{ sessionId: 'moved again', lastModified: 30 },
			{ sessionId: 'other', lastModified: 20 },
			{ sessionId: 'moved', lastModified: 15 },
			{ sessionId: 'first', lastModified: 10 },
			{ sessionId: 'orphan', lastModified: 5 },
			{ sessionId: 'loop', lastModified: 4 },
			{ sessionId: 'pool', lastModified: 3 },
		],
		firstOf,
	);

	expect(listed).toEqual([
		{ sessionId: 'first', lastModified: 30 },
		{ sessionId: 'other', lastModified: 20 },
		{ sessionId: 'orphan', lastModified: 5 },
		{ sessionId: 'loop', lastModified: 4 },
		{ sessionId: 'pool', lastModified: 3 },
	]);
});
