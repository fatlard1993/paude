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
	const fresh = (extra = {}) => ({ draft: null, thread: null, notes: { chat: [], comments: [] }, ...extra });
	const typeAll = (state, keys) => keys.forEach(key => overlayKey(state, key));

	test('maps the menu keys', () => {
		expect(overlayKey(fresh(), 'd')).toEqual({ type: 'detach' });
		expect(overlayKey(fresh(), 's')).toEqual({ type: 'switch' });
		expect(overlayKey(fresh(), '\x1b')).toEqual({ type: 'close' });
		expect(overlayKey(fresh(), 'q')).toEqual({ type: 'close' });
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

	const thread = () => [
		{ id: 'a', author: 'ana', quote: 'x', text: 'one', replies: [], resolved: false, at: 1 },
		{ id: 'b', author: 'ben', quote: 'y', text: 'two', replies: [], resolved: true, at: 2 },
		{
			id: 'c',
			author: 'cat',
			quote: 'line one\nline two',
			text: 'three',
			replies: [{ author: 'dee', text: 'a reply worth reading', at: 4 }],
			resolved: false,
			at: 3,
		},
	];

	test('a number opens that comment, where r replies and x resolves', () => {
		const state = fresh({ notes: { chat: [], comments: thread() } });

		overlayKey(state, '2');
		expect(state.thread).toBe('c');

		typeAll(state, ['r', 'o', 'k']);
		expect(overlayKey(state, '\r')).toEqual({ type: 'reply', commentId: 'c', text: 'ok' });
		expect(overlayKey(state, 'x')).toEqual({ type: 'resolve', commentId: 'c', resolved: true });

		overlayKey(state, '\x1b');
		expect(state.thread).toBeNull();
	});

	test('the thread view shows the whole quote, the comment and its replies', () => {
		const state = fresh({ id: 's', presence: { clients: [] }, notes: { chat: [], comments: thread() }, thread: 'c' });
		const screen = renderOverlay(state);

		for (const text of ['line one', 'line two', 'three', 'dee', 'a reply worth reading'])
			expect(screen).toContain(text);
	});

	test('mouse and focus reports from a brushed touchpad change nothing', () => {
		const state = fresh({ notes: { chat: [], comments: thread() } });

		overlayKey(state, '2');
		overlayKey(state, 'r');

		for (const noise of ['\x1b[<35;40;12M', '\x1b[<0;40;12m', '\x1b[I', '\x1b[O']) {
			expect(overlayKey(state, noise)).toEqual({ type: 'ignore' });
		}

		expect(state.draft.kind).toBe('reply');
		expect(overlayKey(fresh(), '\x1b[<35;1;1M')).toEqual({ type: 'ignore' });
	});

	test('keys that mean nothing are ignored rather than closing the overlay', () => {
		expect(overlayKey(fresh(), 'z')).toEqual({ type: 'ignore' });
		expect(overlayKey(fresh(), 'q')).toEqual({ type: 'close' });
	});

	test('a guest without switching or note rights gets none of those keys', () => {
		const watcher = fresh({ canSwitch: false, role: 'watch' });

		for (const key of ['s', 'c', 'm']) {
			expect(overlayKey(watcher, key, { readSelection: () => 'x' })).toEqual({ type: 'ignore' });
		}
		expect(watcher.draft).toBeNull();
	});
});

test('the overlay never prints escape sequences a collaborator sends', () => {
	const hostile = '\x1b[2J\x1b]0;owned\x07';
	const screen = renderOverlay({
		id: 'abc',
		draft: null,
		thread: null,
		presence: { busy: false, title: hostile, you: 0, clients: [{ kind: hostile, name: hostile, driver: true }] },
		notes: {
			chat: [{ author: hostile, text: hostile, at: Date.now() }],
			comments: [{ author: hostile, quote: hostile, text: hostile, replies: [], resolved: false }],
		},
	});

	expect(screen).not.toContain('\x1b]0;owned');
	expect(screen.split('\x1b[2J')).toHaveLength(2);
});
