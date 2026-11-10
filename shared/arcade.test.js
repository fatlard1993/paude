import { expect, test } from 'bun:test';

import { READING, makesGame, readAloudFor } from './arcade';

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

test('a prompt sent to the arcade with no project named is a new game, from the home page or the bridge alike', () => {
	// Either prompt box, nothing picked for where it goes: every way of writing, plain text as much as the spoken ones
	for (const arcade of Object.keys(READING)) expect(makesGame({ arcade })).toBe(true);
	expect(makesGame({ arcade: 'reading', project: undefined, remote: undefined })).toBe(true);
	// No arcade, or a way of writing there isn't: placed like any prompt
	expect(makesGame({ arcade: null })).toBe(false);
	expect(makesGame({ arcade: 'shouting' })).toBe(false);
	// Named for a project, here or on another paude: that project's to place
	expect(makesGame({ arcade: 'reading', project: 'paude' })).toBe(false);
	expect(makesGame({ arcade: 'reading', project: 'paude', remote: { url: 'https://other' } })).toBe(false);
});
