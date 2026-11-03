import { expect, test } from 'bun:test';

import olderPaude from './olderPaude';

const listed = (id, extra) => ({
	id,
	title: id,
	project: 'site',
	hue: 10,
	status: 'stopped',
	live: false,
	unseen: 0,
	...extra,
});

test("an older paude's running sessions and watched ones with news come aboard, each once", () => {
	const answer = olderPaude({
		sessions: [
			listed('running', { live: true, status: 'ready' }),
			listed('busy', { live: true, status: 'ready', busy: true }),
			listed('done'),
		],
		watching: [
			listed('running', { live: true, status: 'ready', watching: true }),
			listed('news', { watching: true, unseen: 2 }),
			listed('quiet', { watching: true }),
		],
		projects: [
			{ name: 'site', hue: 10, watching: true },
			{ name: 'idle', hue: 20 },
		],
	});

	expect(answer.older).toBe(true);
	expect(answer.sessions.map(({ id, status }) => [id, status])).toEqual([
		['running', 'ready'],
		['news', 'stopped'],
		['busy', 'working'],
	]);
	expect(answer.projects).toEqual([
		{ name: 'site', hue: 10, watching: true },
		{ name: 'idle', hue: 20, watching: false },
	]);
	expect(answer.sessions.every(({ tool, reply }) => tool === null && reply === null)).toBe(true);
});

test('an older paude listing nothing brings nothing aboard but is still seen into', () => {
	expect(olderPaude({})).toMatchObject({ older: true, sessions: [], projects: [], checkouts: [], tools: [] });
});
