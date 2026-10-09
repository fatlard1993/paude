import { expect, test } from 'bun:test';

import { didOf, parseTour, tourPrompt } from './catchUp';

const turns = [
	{
		id: 'u1',
		prompt: 'fix the flaky test',
		at: '2026-10-09T01:00:00Z',
		said: 'Fixed: the test waited on a timer.',
		steps: [
			{ tool: 'Read', file: 'a.test.js' },
			{ tool: 'Edit', file: 'a.test.js', edits: true },
			{ tool: 'Bash', summary: 'Run the tests', ok: true },
		],
	},
	{ id: 'u2', prompt: 'commit it', at: '2026-10-09T01:05:00Z', steps: [] },
];

test('what a turn did, in a line', () => {
	expect(didOf(turns[0].steps)).toBe('changed a.test.js; ran 1 command (Run the tests); read 1 file');
	expect(didOf([{ tool: 'Bash', summary: 'push', ok: false }])).toBe('ran 1 command (push); 1 step failed');
});

test('the prompt numbers each turn with what was asked, done and said', () => {
	const prompt = tourPrompt(turns);

	expect(prompt).toContain('Turn 1, 2026-10-09T01:00:00Z\n  Asked: fix the flaky test\n  Did: changed a.test.js');
	expect(prompt).toContain('Claude ended with: Fixed: the test waited on a timer.');
	expect(prompt).toContain('Turn 2, 2026-10-09T01:05:00Z\n  Asked: commit it');
});

test('each stop lands on its turn, and a stop Haiku skipped falls back to the prompt', () => {
	const tour = parseTour(
		'Here:\n```json\n{"overview": "The test is fixed.", "stops": {"1": "Made the test wait properly."}}\n```',
		turns,
	);

	expect(tour).toEqual({
		overview: 'The test is fixed.',
		stops: [
			{ turnId: 'u1', prompt: 'fix the flaky test', at: '2026-10-09T01:00:00Z', text: 'Made the test wait properly.' },
			{ turnId: 'u2', prompt: 'commit it', at: '2026-10-09T01:05:00Z', text: 'commit it' },
		],
	});
	expect(parseTour('no idea', turns)).toBeNull();
});
