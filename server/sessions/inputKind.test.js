import { expect, test } from 'bun:test';

import inputKind from './inputKind';

test('terminal answers to queries are replies', () => {
	for (const reply of [
		'\x1b[12;40R',
		'\x1b[?62;22c',
		'\x1b[>0;276;0c',
		'\x1b[0n',
		'\x1b[?2026;2$y',
		'\x1b[?1u',
		'\x1b[8;72;229t',
		'\x1b]11;rgb:1b1b/1b1b/1b1b\x1b\\',
		'\x1b]10;rgb:ffff/ffff/ffff\x07',
		'\x1bP>|kitty(0.39.1)\x1b\\',
		'\x1b[?2026;2$y\x1b[12;40R',
	]) {
		expect(inputKind(reply)).toBe('reply');
	}
});

test('mouse and focus reports are pointer input, even with a reply alongside', () => {
	expect(inputKind('\x1b[<0;10;5M\x1b[<0;10;5m')).toBe('pointer');
	expect(inputKind('\x1b[I')).toBe('pointer');
	expect(inputKind('\x1b[O\x1b[12;40R')).toBe('pointer');
});

test('keys a person types are typing', () => {
	for (const keys of ['a', 'hello\r', '\x1b', '\x1b[A', '\x03', '\x1b[Z', '\x1b[1;5D', 'x\x1b[12;40R']) {
		expect(inputKind(keys)).toBe('typing');
	}
});
