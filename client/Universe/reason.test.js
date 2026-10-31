import { expect, test } from 'bun:test';

import refusal, { reasonOf } from './reason';

test("a server's short refusal is shown after our sentence in its own words, ending as it ends", () => {
	expect(refusal('Could not send that to dellbook', 'Session not found')).toBe(
		'Could not send that to dellbook: Session not found.',
	);
	expect(refusal('Could not reach vps', '  Not one of your servers.\r\n')).toBe(
		'Could not reach vps: Not one of your servers.',
	);
	expect(refusal('Could not reach vps', 'Gone away!')).toBe('Could not reach vps: Gone away!');
	expect(refusal('Could not reach vps', 'Is it on?')).toBe('Could not reach vps: Is it on?');
	expect(refusal('Could not reach vps', { error: 'No such project' })).toBe('Could not reach vps: No such project.');
});

test('a reason up to 120 characters is shown, one longer is not', () => {
	expect(reasonOf('x'.repeat(120))).toBe('x'.repeat(120));
	expect(reasonOf(` ${'x'.repeat(120)} `)).toBe('x'.repeat(120));
	expect(reasonOf('x'.repeat(121))).toBe('');
});

test('nothing worth showing leaves our sentence alone: empty, several lines, HTML, or not words', () => {
	for (const body of [
		'',
		'   ',
		null,
		undefined,
		{},
		'Error: boom\n    at send (server.js:12)',
		'Error: boom\r\n    at send',
		'two\rlines',
		'<html><body>502 Bad Gateway</body></html>',
		'Bad Gateway <nginx>',
	])
		expect(refusal('Could not send that to dellbook', body)).toBe('Could not send that to dellbook.');
});
