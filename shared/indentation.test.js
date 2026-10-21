import { expect, test } from 'bun:test';

import indentation from './indentation';

test('a file indented with tabs, or saying nothing, indents with a tab', () => {
	expect(indentation('a {\n\tb;\n\t\tc;\n}\n')).toBe('\t');
	expect(indentation('one line\n')).toBe('\t');
});

test('a file indented with spaces indents in fours when they all come in fours, in twos otherwise', () => {
	expect(indentation('def a():\n    b\n        c\n')).toBe('    ');
	expect(indentation('a:\n  b:\n    c: 1\n')).toBe('  ');
});

test('a few lines of the other kind are outvoted', () => {
	expect(indentation('\ta\n\tb\n\tc\n  d\n')).toBe('\t');
	expect(indentation('  a\n  b\n  c\n\td\n')).toBe('  ');
});
