import { expect, test } from 'bun:test';

import { crewJob, crewOf, noteCrew } from './crew';

test("paude's own helpers are the crew at work while a job runs, and counted for an hour after", async () => {
	const before = crewOf().lately;
	const counted = job => (crewOf().lately[job] ?? 0) - (before[job] ?? 0);
	let finish;
	const running = crewJob('a test job', () => new Promise(resolve => (finish = resolve)));

	noteCrew('a test ping');
	expect(crewOf().busy).toContain('a test job');
	expect([counted('a test job'), counted('a test ping')]).toEqual([0, 1]);

	finish('done');
	expect(await running).toBe('done');
	expect(crewOf().busy).not.toContain('a test job');
	expect(counted('a test job')).toBe(1);
	expect(crewOf(Date.now() + 61 * 60_000)).toEqual({ busy: [], lately: {} });
});
