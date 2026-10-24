import { expect, test } from 'bun:test';

import { didOf, leftOutOf, markInterruptions, parseTour, settledLine, steeringOf, tourPrompt } from './catchUp';

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

test('what a turn settled goes with it, and the questions left waiting go with the whole', () => {
	const settled = {
		kind: 'decision',
		chose: 'Wait on the event.',
		rejected: 'A longer timer.',
		because: 'Timers flake.',
	};
	const prompt = tourPrompt([{ ...turns[0], settled: [settled] }, turns[1]], {
		waiting: ['Is this the fix for the flaky test?'],
	});

	expect(settledLine(settled)).toBe('Decided: Wait on the event. Not: A longer timer. Because: Timers flake.');
	expect(settledLine({ kind: 'deferred', chose: 'Retries.', rejected: '', because: '' })).toBe('Put off: Retries.');
	expect(prompt).toContain('Claude ended with: Fixed: the test waited on a timer.\n  Decided: Wait on the event.');
	expect(prompt).toContain(
		'Questions waiting on the person, about writing what was settled into the commits:\n- Is this the fix',
	);
	expect(tourPrompt(turns)).not.toContain('Questions waiting');
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

test('a tour says what it leaves out: turns cut short, sent again, past what it holds, or before what it read', () => {
	const turn = (prompt, at, extra = {}) => ({ prompt, at: new Date(at).toISOString(), ...extra });
	const read = [
		turn('fix it', 2000),
		turn('fix it', 3000),
		turn('[Request interrupted by user]', 4000, { interrupted: true }),
		turn('ship it', 5000),
	];
	const told = [read[1], read[3]];

	expect(leftOutOf({ read, told, picked: told.slice(-1), since: 1000, reachesBack: true })).toEqual([
		"The 1 earliest turn since then isn't in it; Activity has every turn.",
		'1 prompt sent again is told once.',
	]);
	expect(leftOutOf({ read: told, told, picked: told, since: 1000, reachesBack: false })).toEqual([
		'It reads only the latest part of a long session, so anything before that is missing.',
	]);
	expect(leftOutOf({ read: told, told, picked: told, since: 1000, reachesBack: true })).toEqual([]);
	expect(leftOutOf({ read: told, told, picked: told, reachesBack: false })).toEqual([]);
});

test('where the person steered is marked and told: a turn stopped, the one that redirected it, a step turned down', () => {
	const turns = markInterruptions([
		{ prompt: 'make it blue', steps: [] },
		{ prompt: '[Request interrupted by user]', interrupted: true, steps: [] },
		{ prompt: 'no, green', steps: [{ tool: 'Edit', summary: 'a.css', ok: false, declined: true }] },
	]);

	expect(turns.map(steeringOf)).toEqual([['stopped partway'], [], ['redirected', 'a step turned down']]);
	expect(didOf(turns[2].steps)).toBe('the person turned down Edit a.css');

	const prompt = tourPrompt([turns[0], turns[2]].map(turn => ({ ...turn, at: 'now' })));

	expect(prompt).toContain('The person stopped Claude partway through this.');
	expect(prompt).toContain('This redirected the turn before, which the person had stopped.');
	expect(parseTour('{"overview": "o", "stops": {"1": "a", "2": "b"}}', [turns[0], turns[2]]).stops[1].steered).toEqual([
		'redirected',
		'a step turned down',
	]);
});
