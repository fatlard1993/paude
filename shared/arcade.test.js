import { expect, test } from 'bun:test';

import { READING, readAloudFor } from './arcade';

test('an arcade written to be heard is read aloud, plain text is not, and a choice made for either is kept', () => {
	expect(Object.keys(READING)).toEqual(['listening', 'learning', 'reading']);
	expect(readAloudFor('listening')).toBe(true);
	expect(readAloudFor('learning')).toBe(true);
	expect(readAloudFor('reading')).toBe(false);
	expect(readAloudFor('reading', null)).toBe(false);
	// Turned on for plain text, or off for a spoken one, by whoever's at it
	expect(readAloudFor('reading', 'yes')).toBe(true);
	expect(readAloudFor('listening', 'no')).toBe(false);
	// Anything else kept there is no choice
	expect(readAloudFor('listening', 'maybe')).toBe(true);
});
