import { expect, test } from 'bun:test';

import { beginHandover, summaryNotes, takeHandover } from './compaction';
import { keepWarm, monitorOf, noteMonitor } from './keepWarm';

const fakeSession = () => ({ cwd: '/work' });
const going = (
	session,
	turns = [{ id: 't1', prompt: 'fix the build', asked: 'fix the build', steps: [] }],
	decisions = [],
) => ({
	sessionOf: () => session,
	turnsOf: async () => turns,
	decisionsOf: async () => ({ decisions }),
});
const verdict = answer => ({ answer, delivered: true, resumable: true, usage: null, why: '' });

test('the summary is asked to keep what a summary loses first, and what the session settled as paude recorded it', async () => {
	const decisions = [
		{ turnId: 't1', kind: 'decision', chose: 'per-user counts', rejected: 'per-session counts' },
		{ turnId: 't1', kind: 'deferred', chose: 'the README section', dismissed: true },
		{ turnId: 't1', question: 'Which port?', chose: 'the dev server' },
	];
	const notes = await summaryNotes('anyone', going(fakeSession(), undefined, decisions));

	expect(notes).toContain("in the person's own words");
	expect(notes).toContain('- Waiting on the person: Which port? (about: the dev server)');
	expect(notes).toContain('- Decided: per-user counts Rejected: per-session counts');
	// What the person set aside stays out
	expect(notes).not.toContain('README');
	expect(await summaryNotes('anyone', going(fakeSession()))).not.toContain('settled');
	expect(await summaryNotes('anyone', { ...going(fakeSession()), sessionOf: () => undefined })).toBe('');
	expect(
		(
			await summaryNotes(
				'anyone',
				going(
					fakeSession(),
					undefined,
					Array.from({ length: 50 }, (_, n) => ({ turnId: 't1', kind: 'decision', chose: 'x'.repeat(400) + n })),
				),
			)
		).length,
	).toBeLessThanOrEqual(10_000);
});

test('as Claude compacts, a fabled monitor that has looked writes a handover, taken once, and its record left as it was', async () => {
	const session = fakeSession();
	const asks = [];
	const askMonitor = async (monitor, cwd, prompt, options) => {
		asks.push({ monitor, prompt, options });

		return verdict('Still waiting on: the README. Rejected: per-session counts.');
	};
	const deps = { ...going(session), askMonitor, repoOf: async () => '' };

	await keepWarm('handover', 24, Date.now(), { fabled: true });
	// A monitor that hasn't looked yet has nothing to hand over
	expect(await beginHandover('handover', {}, deps)).toBe(false);
	await noteMonitor('handover', { monitor: monitorOf('handover').monitor, seen: 't1', missed: 1 });
	expect(await beginHandover('handover', { custom_instructions: ' the README ' }, deps)).toBe(true);
	expect(await takeHandover('handover', 1000)).toBe('Still waiting on: the README. Rejected: per-session counts.');
	expect(await takeHandover('handover', 1000)).toBe('');
	expect(asks).toHaveLength(1);
	expect(asks[0].monitor).toBe(monitorOf('handover').monitor);
	expect(asks[0].prompt).toContain('<focus>\nthe README\n</focus>');
	expect(asks[0].options.turns).toBeLessThan(5);
	expect(monitorOf('handover')).toMatchObject({ seen: 't1', missed: 1 });

	// One too slow to write is let go, and Claude carries on without it
	const slow = async () => new Promise(resolve => setTimeout(() => resolve(verdict('late')), 200));

	expect(await beginHandover('handover', {}, { ...deps, askMonitor: slow })).toBe(true);
	expect(await takeHandover('handover', 10)).toBe('');

	// Only fabled sessions hand over
	await keepWarm('handover', 24, Date.now(), { going: true });
	expect(await beginHandover('handover', {}, deps)).toBe(false);
	await keepWarm('handover', 0);
});
