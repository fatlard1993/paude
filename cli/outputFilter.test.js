import { expect, test } from 'bun:test';

import outputFilter, { filterText } from './outputFilter';

const bytes = text => new TextEncoder().encode(text);

test('drops clipboard writes and notifications, keeps titles, links and plain output', () => {
	const filter = outputFilter();
	const input = [
		'before ',
		'\x1b]52;c;Y3VybCBldmlsfHNo\x07',
		'\x1b]0;✳ Task\x07',
		'\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\',
		'\x1b]9;spoofed\x07',
		'\x1b]1337;File=inline=1:AAAA\x07',
		'\x1b[31mred\x1b[0m after',
	].join('');

	expect(filter(bytes(input))).toBe(
		'before \x1b]0;✳ Task\x07\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\\x1b[31mred\x1b[0m after',
	);
});

test('a blocked sequence split across chunks is still dropped', () => {
	const filter = outputFilter();
	const parts = ['ok \x1b', ']52;c;Y3Vy', 'bA==\x07 done'];

	expect(parts.map(part => filter(bytes(part))).join('')).toBe('ok  done');
});

test('multibyte characters split across chunks survive', () => {
	const filter = outputFilter();
	const glyph = bytes('✳');

	expect(filter(glyph.slice(0, 1)) + filter(glyph.slice(1))).toBe('✳');
});

test('padded OSC numbers, string sequences and C1 controls are dropped too', () => {
	const filter = outputFilter();
	const input = [
		'a',
		'\x1b]052;c;Y3Vy\x07',
		'\x1bPtmux;\x1b\x1b]52;c;x\x07\x1b\\',
		'\x1b_Gf=100;AAAA\x1b\\',
		'\u009d52;c;x\u009c',
		'\x1b]2;title\x07',
		'b',
	].join('');

	expect(filter(bytes(input))).toBe('a\x1b]2;title\x07b');
});

test('a whole snapshot is filtered the same way', () => {
	expect(filterText('x\x1b]52;c;Y3Vy\x07y')).toBe('xy');
});
