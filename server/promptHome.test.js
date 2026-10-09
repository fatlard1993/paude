import { expect, test } from 'bun:test';

import { candidatesFrom, homePrompt } from './promptHome';

const DAY = 24 * 60 * 60 * 1000;

test('running sessions and those touched in the last three days are weighed, at most fifteen', () => {
	const now = 100 * DAY;
	const sessions = [
		{ id: 'live-old', live: true, lastModified: 0 },
		{ id: 'recent', live: false, lastModified: now - DAY },
		{ id: 'stale', live: false, lastModified: now - 4 * DAY },
	];

	expect(candidatesFrom(sessions, now).map(session => session.id)).toEqual(['live-old', 'recent']);
	expect(
		candidatesFrom(
			Array.from({ length: 20 }, (_, index) => ({ id: index, live: true })),
			now,
		),
	).toHaveLength(15);
});

test('the prompt numbers each conversation with what it began with, lately asked and changed', () => {
	const prompt = homePrompt({
		prompt: 'make the cup show minutes left',
		candidates: [
			{
				title: 'Keep warm',
				project: 'paude',
				worktree: null,
				firstPrompt: 'ping idle sessions',
				latest: ['use a coffee cup'],
				changed: ['server/keepWarm.js'],
			},
		],
		projects: ['paude', 'minecraft'],
	});

	expect(prompt).toContain('The task:\nmake the cup show minutes left');
	expect(prompt).toContain(
		'1. "Keep warm" in paude\n   Began with: ping idle sessions\n   Lately: use a coffee cup\n   Changed lately: server/keepWarm.js',
	);
	expect(prompt).toContain('For a new session, the projects are: paude, minecraft.');
	expect(prompt).toContain('"fresh": {"project": "…", "why": "…"}');
});

test('kept to one project, a new session needs no project named', () => {
	const prompt = homePrompt({ prompt: 'x', candidates: [], projects: null });

	expect(prompt).toContain('There are no conversations going.');
	expect(prompt).not.toContain('the projects are');
	expect(prompt).toContain('"fresh": {"why": "…"}');
});
