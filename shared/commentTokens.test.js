import { expect, test } from 'bun:test';

import commentTokens from './commentTokens';

test("a file's comments come from its extension, or its name when it has none", () => {
	expect(commentTokens('src/app.tsx')).toEqual({ line: '//', block: { open: '/*', close: '*/' } });
	expect(commentTokens('styles/site.css')).toEqual({ block: { open: '/*', close: '*/' } });
	expect(commentTokens('scripts/deploy.sh')).toEqual({ line: '#' });
	expect(commentTokens('Makefile')).toEqual({ line: '#' });
	expect(commentTokens('.gitignore')).toEqual({ line: '#' });
	expect(commentTokens('docs/README.md')).toEqual({ block: { open: '<!--', close: '-->' } });
});

test('a file of a kind nobody listed has none', () => {
	expect(commentTokens('data.bin')).toBe(null);
	expect(commentTokens('LICENSE')).toBe(null);
});
