import { expect, test } from 'bun:test';

import { flyoutOf } from './flyout';

test("a session's card says how much of its context is used and how much is left, as Claude's status line counts it", () => {
	const session = {
		key: 'here/a',
		id: 'a',
		status: 'ready',
		project: 'paude',
		engine: { name: 'dellbook' },
		context: { tokens: 385_176, window: 1_000_000, fill: 0.385176 },
	};
	const ship = { checkoutOf: () => null, walkers: new Map(), projectHues: new Map() };
	const { rows } = flyoutOf({ kind: 'worker', worker: { session } }, ship);
	const [, words] = rows.find(row => row && row[0] === 'context');

	expect(words).toBe('39% used, 61% left of 1M');
});

test("a session's card counts down how long its context stays cached, as its grey dozes, and says when it went cold", () => {
	const ship = { checkoutOf: () => null, walkers: new Map(), projectHues: new Map(), time: 100 };
	const cacheOf = (cache, worker = {}) => {
		const session = {
			key: 'here/a',
			id: 'a',
			status: 'ready',
			project: 'paude',
			engine: { name: 'dellbook' },
			context: { tokens: 150_000, window: 1_000_000, fill: 0.15, warm: cache.left > 0, cache },
		};
		const { rows } = flyoutOf({ kind: 'worker', worker: { session, ...worker } }, ship);

		return rows.find(row => row && row[0] === 'cache')?.[1];
	};
	const HOUR = 3_600_000;

	// Read 60 seconds ago with 24 minutes left: 23 now
	expect(cacheOf({ left: 24 * 60_000, life: HOUR, ago: 0 }, { cacheAt: 40 })).toBe(
		'fresh for 23 minutes more, of its 60-minute cache',
	);
	expect(cacheOf({ left: 30_000, life: HOUR, ago: 0 }, { cacheAt: 100 })).toBe(
		'fresh for under a minute, of its 60-minute cache',
	);
	expect(cacheOf({ left: 0, life: 5 * 60_000, ago: 9 * 60_000 }, { cacheAt: 40 })).toBe(
		'gone cold 10 minutes ago: its next turn writes its 150k context to the cache again',
	);
	expect(cacheOf({})).toBe('gone cold: its next turn costs more');
});
