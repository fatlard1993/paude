import { expect, test } from 'bun:test';

import { forgetPresence, presenceNote } from './arcadePresence';

test('Claude is told who is here the first time and whenever it changes, and not again while it holds', () => {
	expect(presenceNote('s1', [{ name: 'Ben' }])).toBe(
		'paude: here in the arcade now: Ben. Build with them, by name where it fits.',
	);
	expect(presenceNote('s1', [{ name: 'Ben' }])).toBeNull();
	expect(presenceNote('s1', [{ name: 'Ben' }, { name: 'Ada' }, { name: 'Ben' }])).toContain('now: Ada and Ben.');
	expect(presenceNote('s1', [])).toBe('paude: nobody has the arcade open right now.');
});

test('a compaction makes it worth saying again', () => {
	presenceNote('s2', [{ name: 'Ben' }]);
	forgetPresence('s2');

	expect(presenceNote('s2', [{ name: 'Ben' }])).toContain('Ben');
});
