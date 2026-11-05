import { expect, test } from 'bun:test';

import { afterReply, arrivalOf } from './sidePanel';

test("a reply opens a stopped session's side panel only once it's gone, and never a running one's", () => {
	expect(afterReply({ status: 'stopped' }, true)).toEqual({ close: true, wake: true });
	expect(afterReply({ status: 'stopped' }, false)).toEqual({ close: false, wake: false });
	expect(afterReply({ status: 'ready' }, true)).toEqual({ close: true, wake: false });
});

test('a session just placed is waited for, opened once aboard, and given up on cleanly if it never comes', () => {
	const arriving = { key: 'here/new', until: 60_000 };
	const worker = { session: { key: 'here/new' } };

	// Not aboard yet: still waited for, nothing opened
	expect(arrivalOf(arriving, new Map(), 1000)).toEqual({ worker: null, arriving });
	// Aboard: opened, and no longer waited for
	expect(arrivalOf(arriving, new Map([['here/new', worker]]), 2000)).toEqual({ worker, arriving: null });
	// Past its minute: let go, even if it turns up after
	expect(arrivalOf(arriving, new Map([['here/new', worker]]), 60_001)).toEqual({ worker: null, arriving: null });
	// Nothing waited for
	expect(arrivalOf(null, new Map(), 0)).toEqual({ worker: null, arriving: null });
});
