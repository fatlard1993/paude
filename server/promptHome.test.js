import { expect, test } from 'bun:test';

import { candidatesFrom, homePrompt, limitsPrompt } from './promptHome';

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
		projects: ['paude on dellbook', 'minecraft on vps'],
	});

	expect(prompt).toContain('The task:\nmake the cup show minutes left');
	expect(prompt).toContain(
		'1. "Keep warm" in paude\n   Began with: ping idle sessions\n   Lately: use a coffee cup\n   Changed lately: server/keepWarm.js',
	);
	expect(prompt).toContain('the projects (each on its server) are: paude on dellbook, minecraft on vps.');
	expect(prompt).toContain('"project" is one of the projects exactly as written above');
	expect(prompt).toContain(
		'"fresh": {"project": "…", "model": "sonnet", "modelWhy": "…", "lifetime": "ordinary", "why": "…"}',
	);
	expect(prompt).toContain('"brief" for a quick question or one-off check');
	expect(prompt).toContain('which model suits the task, the lightest that will do it well: "haiku" (quick and light');
	expect(prompt).toContain('"fable" (the most capable');
});

test('kept to one project, a new session needs no project named', () => {
	const prompt = homePrompt({ prompt: 'x', candidates: [], projects: null });

	expect(prompt).toContain('There are no conversations going.');
	expect(prompt).not.toContain('the projects are');
	expect(prompt).toContain('"fresh": {"model": "sonnet", "modelWhy": "…", "lifetime": "ordinary", "why": "…"}');
});

test("the account's limits are weighed in the model when known, each with how long it has to reset", () => {
	const now = Date.parse('2026-11-05T12:00:00Z');
	const limits = {
		session: { percent: 82, resetsAt: '2026-11-05T14:00:00Z' },
		week: { percent: 28.4, resetsAt: '2026-11-08T12:00:00Z' },
		models: [{ name: 'Fable', percent: 95, resetsAt: '2026-11-08T12:00:00Z' }],
	};
	const said = limitsPrompt(limits, now);

	expect(said).toContain(
		"the five-hour window 82% used, resetting in 2 hours; the week 28% used, resetting in 3 days; Fable's own week 95% used",
	);
	expect(said).toContain('suggest a lighter model unless the task truly needs a heavier one');
	expect(limitsPrompt({ session: { percent: 0, resetsAt: null }, week: null, models: [] }, now)).toContain(
		'the five-hour window not yet begun (none of it used).',
	);
	expect(limitsPrompt(null)).toBeNull();
	expect(homePrompt({ prompt: 'x', candidates: [], projects: null, limits, now })).toContain(
		"Fable's own week 95% used",
	);
	expect(homePrompt({ prompt: 'x', candidates: [], projects: null })).not.toContain('usage limits');
});
