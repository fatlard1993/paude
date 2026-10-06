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
	const fresh = (extra = {}) => ({ draft: null, picking: false, notes: { chat: [], comments: [] }, ...extra });
	const typeAll = (state, keys) => keys.forEach(key => overlayKey(state, key));

	test('maps the menu keys', () => {
		expect(overlayKey(fresh(), 'd')).toEqual({ type: 'detach' });
		expect(overlayKey(fresh(), 's')).toEqual({ type: 'switch' });
		expect(overlayKey(fresh(), '\x1b')).toEqual({ type: 'close' });
	});

	test('c writes a chat line that enter sends', () => {
		const state = fresh();

		overlayKey(state, 'c');
		typeAll(state, ['h', 'e', 'y', 'y', '\x7f', '\x1b[A']);

		expect(state.draft.text).toBe('hey[A');
		expect(overlayKey(state, '\r')).toEqual({ type: 'chat', text: 'hey[A' });
		expect(state.draft).toBeNull();
	});

	test('escape abandons the draft, and an empty one sends nothing', () => {
		const state = fresh();

		typeAll(state, ['c', 'x', '\x1b']);
		expect(state.draft).toBeNull();

		overlayKey(state, 'c');
		expect(overlayKey(state, '\r')).toEqual({ type: 'redraw' });
	});

	test('m comments on the selected text', () => {
		const state = fresh();

		overlayKey(state, 'm', { readSelection: () => '  npm ERR! code 1\n' });
		typeAll(state, ['w', 'h', 'y']);

		expect(overlayKey(state, '\r')).toEqual({ type: 'comment', quote: 'npm ERR! code 1', text: 'why' });
	});

	test('m with nothing selected explains instead of opening a draft', () => {
		const state = fresh();

		overlayKey(state, 'm', { readSelection: () => null });

		expect(state.draft).toBeNull();
		expect(state.hint).toContain('Nothing selected');
	});

	test('r then a number replies to that open comment', () => {
		const comments = [
			{ id: 'a', author: 'ana', quote: 'x', text: 'one', replies: [], resolved: false },
			{ id: 'b', author: 'ben', quote: 'y', text: 'two', replies: [], resolved: true },
			{ id: 'c', author: 'cat', quote: 'z', text: 'three', replies: [], resolved: false },
		];
		const state = fresh({ notes: { chat: [], comments } });

		typeAll(state, ['r', '2', 'o', 'k']);

		expect(overlayKey(state, '\r')).toEqual({ type: 'reply', commentId: 'c', text: 'ok' });
	});

	test('a guest without switching or note rights gets none of those keys', () => {
		const watcher = fresh({ canSwitch: false, role: 'watch' });

		for (const key of ['s', 'c', 'm', 'r'])
			expect(overlayKey(watcher, key, { readSelection: () => 'x' })).toEqual({ type: 'close' });
		expect(watcher.draft).toBeNull();
	});
});

test('the overlay never prints escape sequences a collaborator sends', () => {
	const hostile = '\x1b[2J\x1b]0;owned\x07';
	const screen = renderOverlay({
		id: 'abc',
		draft: null,
		picking: false,
		presence: { busy: false, title: hostile, you: 0, clients: [{ kind: hostile, name: hostile, driver: true }] },
		notes: {
			chat: [{ author: hostile, text: hostile, at: Date.now() }],
			comments: [{ author: hostile, quote: hostile, text: hostile, replies: [], resolved: false }],
		},
	});

	expect(screen).not.toContain('\x1b]0;owned');
	expect(screen.split('\x1b[2J')).toHaveLength(2);
});
