import { expect, test } from 'bun:test';

import untilCompact from './untilCompact';

const screen = lines => ({
	length: lines.length,
	getLine: y => (y < lines.length ? { translateToString: () => lines[y] } : undefined),
});

test("what's left before Claude compacts, as its prompt's footer says it", () => {
	expect(untilCompact(screen(['❯ ', '─'.repeat(40), '  ⏵⏵ auto mode on · 1% until auto-compact']))).toBe(1);
	expect(untilCompact(screen(['  12% until auto-compact · ctrl+t to hide tasks']))).toBe(12);
});

test('nothing said, or said only far up the scrollback: not known', () => {
	expect(untilCompact(screen(['❯ ', '─'.repeat(40), '  ⏵⏵ auto mode on']))).toBe(null);
	expect(untilCompact(screen(['3% until auto-compact', ...Array(20).fill('')]))).toBe(null);
});
