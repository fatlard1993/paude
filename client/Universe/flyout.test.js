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
