import { expect, test } from 'bun:test';

import { attachLinesText, attachOutputText } from './attachText';

test('attached text says where it came from', () => {
	expect(attachLinesText('a.js', 2, 3, 'b\nc')).toBe('a.js lines 2-3:\n```\nb\nc\n```\n');
	expect(attachLinesText('a.js', 2, 2, 'b')).toBe('a.js line 2:\n```\nb\n```\n');
	expect(attachOutputText('$ ls\nREADME.md\n\n  ')).toBe('From my terminal:\n```\n$ ls\nREADME.md\n```\n');
});
