import { expect, mock, test } from 'bun:test';

// The component library wants a page to draw on; copying isn't what's tested here
mock.module('@vanilla-bean/components', () => ({ Notify: class {}, copyToClipboard: () => {} }));

const { default: claudeKeys } = await import('./claudeKeys');

const key = (keyName, mods = {}) => ({
	type: 'keydown',
	key: keyName,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	preventDefault: () => {},
	...mods,
});
const handler = ({ canType = true, leave } = {}) => {
	const sent = [];
	const handle = claudeKeys({
		terminal: { hasSelection: () => false },
		send: data => sent.push(data),
		canType: () => canType,
		leave,
	});

	return { sent, handle };
};

test("a terminal's line and word keys, and Shift+Enter, go to Claude as a terminal sends them, wherever it's shown", () => {
	const { sent, handle } = handler();

	expect(handle(key('ArrowLeft', { metaKey: true }))).toBe(false);
	expect(handle(key('Backspace', { metaKey: true }))).toBe(false);
	expect(handle(key('ArrowRight', { altKey: true }))).toBe(false);
	expect(handle(key('Enter', { shiftKey: true }))).toBe(false);
	expect(sent).toEqual(['\x01', '\x15', '\x1bf', '\x1b\r']);
	// Anything else is xterm's own
	expect(handle(key('a'))).toBe(true);
	expect(handle(key('Enter'))).toBe(true);
	expect(sent).toHaveLength(4);
});

test('a watcher who may not type sends nothing, and keys left to the page pass xterm by', () => {
	const watcher = handler({ canType: false });

	expect(watcher.handle(key('Enter', { shiftKey: true }))).toBe(false);
	expect(watcher.sent).toEqual([]);

	const page = handler({ leave: event => event.ctrlKey && event.key === 'l' });

	expect(page.handle(key('l', { ctrlKey: true }))).toBe(false);
	expect(page.sent).toEqual([]);
});
