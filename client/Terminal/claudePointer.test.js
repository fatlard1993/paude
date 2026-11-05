import { expect, test } from 'bun:test';

import { claudePointer, wheelToClaude } from './claudePointer';

const fakeTerminal = buffer => {
	const terminal = {
		cols: 10,
		rows: 5,
		buffer: { active: { type: buffer } },
		element: { querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50 }) }) },
		attachCustomWheelEventHandler: handler => (terminal.wheel = handler),
	};

	return terminal;
};

test("the wheel goes to Claude as a wheel once it asks for one, and otherwise never becomes arrow keys on Claude's screen", () => {
	const sent = [];
	const alternate = fakeTerminal('alternate');
	const pointer = claudePointer(alternate);

	wheelToClaude(alternate, pointer, data => sent.push(data));
	// Not asked for, on the alternate screen: xterm is told to leave it, so it sends no arrow keys
	expect(alternate.wheel({ deltaY: -100, clientX: 15, clientY: 15 })).toBe(false);
	expect(sent).toEqual([]);

	// Asked for, in the SGR encoding: a wheel up at the cell under the pointer, a notch for each hundred
	pointer.track('1000', true);
	pointer.track('1006', true);
	expect(alternate.wheel({ deltaY: -200, clientX: 15, clientY: 15 })).toBe(false);
	expect(sent).toEqual(['\x1b[<64;2;2M\x1b[<64;2;2M']);

	// Its scrollback, on the normal screen with nothing asked for, xterm scrolls itself
	const normal = fakeTerminal('normal');

	wheelToClaude(normal, claudePointer(normal), data => sent.push(data));
	expect(normal.wheel({ deltaY: 100, clientX: 15, clientY: 15 })).toBe(true);
});
