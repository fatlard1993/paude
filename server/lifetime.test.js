import { expect, test } from 'bun:test';

import { UNDO_MS, lastSwitch, lifetimeOf, switchLifetime } from './lifetime';

test('a switch by hand keeps what it was for an hour, to put back', async () => {
	const now = Date.now();

	await switchLifetime('switched', 'warm', now);
	expect(lifetimeOf('switched')).toBe('warm');
	expect(lastSwitch('switched', now)).toEqual({ was: 'ordinary', until: now + UNDO_MS });

	await switchLifetime('switched', 'brief', now + 1);
	expect(lastSwitch('switched', now + 1)?.was).toBe('warm');
	expect(lastSwitch('switched', now + 1 + UNDO_MS)).toBeNull();
});

test('putting it back leaves nothing to undo', async () => {
	const now = Date.now();

	await switchLifetime('walked-back', 'brief', now);
	await switchLifetime('walked-back', 'ordinary', now + 1);
	expect(lastSwitch('walked-back', now + 1)).toBeNull();
});

test('choosing what it already is changes nothing', async () => {
	await switchLifetime('unchanged', 'ordinary');
	expect(lastSwitch('unchanged')).toBeNull();
});
