import { expect, test } from 'bun:test';

import { typed } from './phoneTyping';

test('a letter typed at the end is that letter', () => {
	expect(typed('hello wor', 'hello worl')).toBe('l');
});

test('a word finished by its suggestion sends only the rest of it, not the whole text again', () => {
	expect(typed('hello wor', 'hello world ')).toBe('ld ');
});

test('a word corrected after it was typed is erased back to where it differs and typed anew', () => {
	expect(typed('fix teh ', 'fix the ')).toBe('\x7f\x7f\x7fhe ');
});

test('a letter taken back is a backspace', () => {
	expect(typed('hello', 'hell')).toBe('\x7f');
});

test('a line break is Enter, as a terminal takes it', () => {
	expect(typed('run it', 'run it\n')).toBe('\r');
});

test('nothing changed is nothing sent', () => {
	expect(typed('same', 'same')).toBe('');
});
