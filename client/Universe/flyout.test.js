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
	expect(cacheOf({ left: 24 * 60_000, life: HOUR, ago: 0 }, { cacheAt: 40 })).toBe('warm: 23m of 1h left');
	expect(cacheOf({ left: 30_000, life: HOUR, ago: 0 }, { cacheAt: 100 })).toBe('warm: under 1m of 1h left');
	expect(cacheOf({ left: 0, life: 5 * 60_000, ago: 9 * 60_000 }, { cacheAt: 40 })).toBe(
		'cold 10m: next turn re-caches 150k',
	);
	expect(cacheOf({})).toBe('gone cold: its next turn costs more');
});

test("a project's rack lists what each of its sessions runs under its name, or just the one's when it's alone", () => {
	const ship = { checkoutOf: () => null, walkers: new Map(), projectHues: new Map() };
	const worker = (title, processes) => ({ session: { title, project: 'paude', processes, services: [] } });
	const one = flyoutOf({ kind: 'processes', worker: worker('Build', [{ command: 'vite', cpuSeconds: 3 }]) }, ship);
	const many = flyoutOf(
		{
			kind: 'processes',
			workers: [worker('Build', [{ command: 'vite', cpuSeconds: 3 }]), worker('Tests', [{ command: 'bun test' }])],
		},
		ship,
	);

	expect(one.title).toBe('What Build runs');
	expect(one.rows.filter(Boolean).map(([key]) => key)).toEqual(['vite']);
	expect(many.title).toBe("What paude's sessions run");
	expect(many.rows.filter(Boolean).map(([key, value]) => (key === 'session' ? value : key))).toEqual([
		'Build',
		'vite',
		'Tests',
		'bun test',
	]);
	expect(many.hint).toContain('pick a session');
});
