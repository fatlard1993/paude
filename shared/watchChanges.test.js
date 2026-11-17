import { expect, test } from 'bun:test';

import watchChanges, { lookedAt } from './watchChanges';

const keyOf = session => session.id;

test('a new question or new activity is worth telling; the same state twice, or the one on screen, is not', () => {
	const previous = new Map([
		['a', { id: 'a', status: 'working', unseen: 0 }],
		['b', { id: 'b', status: 'ready', unseen: 1 }],
		['c', { id: 'c', status: 'waiting', unseen: 0 }],
		['d', { id: 'd', status: 'ready', unseen: 0 }],
	]);
	const sessions = [
		{ id: 'a', status: 'waiting', unseen: 0 },
		{ id: 'b', status: 'ready', unseen: 3 },
		{ id: 'c', status: 'waiting', unseen: 0 },
		{ id: 'd', status: 'waiting', unseen: 0 },
		{ id: 'e', status: 'waiting', unseen: 0 },
	];

	expect(watchChanges({ previous, sessions, keyOf, onScreen: session => session.id === 'd' })).toEqual([
		{ session: sessions[0], what: 'needs you' },
		{ session: sessions[1], what: '3 new since you looked' },
	]);
	expect(watchChanges({ previous: null, sessions, keyOf })).toEqual([]);
});

test("news from a session waiting on its background work is told once that work is back, not while it's out", () => {
	const ready = { id: 'a', status: 'ready', unseen: 1 };
	const out = { ...ready, unseen: 4, background: 2 };
	let previous = lookedAt(null, [ready], keyOf);

	expect(watchChanges({ previous, sessions: [out], keyOf })).toEqual([]);
	previous = lookedAt(previous, [out], keyOf);
	expect(previous.get('a').unseen).toBe(1);

	const back = { ...ready, unseen: 4 };

	expect(watchChanges({ previous, sessions: [back], keyOf })).toEqual([
		{ session: back, what: '4 new since you looked' },
	]);
	expect(lookedAt(previous, [back], keyOf).get('a').unseen).toBe(4);
});
