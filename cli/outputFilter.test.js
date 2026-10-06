import { expect, test } from 'bun:test';

import outputFilter from './outputFilter';

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
