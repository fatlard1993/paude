import { expect, test } from 'bun:test';

import { titleOf } from './record';

test('a running session nothing has named yet is a new one; a stopped one without a name has none', () => {
	expect(titleOf('a', { title: '' }, null)).toBe('New session');
	expect(titleOf('a', { title: 'Fix the login' }, null)).toBe('Fix the login');
	expect(titleOf('a', null, { summary: 'Earlier work' })).toBe('Earlier work');
	expect(titleOf('a', null, null)).toBe('');
});
