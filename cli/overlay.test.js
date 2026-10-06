import { describe, expect, test } from 'bun:test';

import { overlayKey, renderOverlay } from './overlay';
import { printable } from './screen';

describe('printable', () => {
	test('strips escape sequences and other control characters', () => {
		expect(printable('hi\x1b]52;c;cGF3bmVk\x07 there\x9b2J')).toBe('hi]52;c;cGF3bmVk there2J');
		expect(printable('a\nb\tc\rd')).toBe('a b cd');
		expect(printable(undefined)).toBe('');
	});
});

describe('overlayKey', () => {
	const fresh = () => ({ draft: null });

	test('maps the menu keys', () => {
		expect(overlayKey(fresh(), 'd')).toEqual({ type: 'detach' });
		expect(overlayKey(fresh(), 's')).toEqual({ type: 'switch' });
		expect(overlayKey(fresh(), '\x1b')).toEqual({ type: 'close' });
	});

	test('c writes a chat line that enter sends', () => {
		const state = fresh();

		overlayKey(state, 'c');
		for (const key of ['h', 'e', 'y', 'y', '\x7f', '\x1b[A']) overlayKey(state, key);

		expect(state.draft).toBe('hey[A');
		expect(overlayKey(state, '\r')).toEqual({ type: 'chat', text: 'hey[A' });
		expect(state.draft).toBeNull();
	});

	test('a guest without switching or chat rights gets neither key', () => {
		const watcher = { draft: null, canSwitch: false, role: 'watch' };

		expect(overlayKey(watcher, 's')).toEqual({ type: 'close' });
		expect(overlayKey(watcher, 'c')).toEqual({ type: 'close' });
		expect(watcher.draft).toBeNull();
	});

	test('escape abandons the draft, and an empty one sends nothing', () => {
		const state = fresh();

		overlayKey(state, 'c');
		overlayKey(state, 'x');
		overlayKey(state, '\x1b');
		expect(state.draft).toBeNull();

		overlayKey(state, 'c');
		expect(overlayKey(state, '\r')).toEqual({ type: 'redraw' });
	});
});

test('the overlay never prints escape sequences a collaborator sends', () => {
	const hostile = '\x1b[2J\x1b]0;owned\x07';
	const screen = renderOverlay({
		id: 'abc',
		draft: null,
		presence: { busy: false, title: hostile, you: 0, clients: [{ kind: hostile, name: hostile, driver: true }] },
		notes: {
			chat: [{ author: hostile, text: hostile, at: Date.now() }],
			comments: [{ author: hostile, quote: hostile, text: hostile, replies: [], resolved: false }],
		},
	});

	expect(screen).not.toContain('\x1b]0;owned');
	expect(screen.split('\x1b[2J')).toHaveLength(2);
});
