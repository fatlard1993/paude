import { expect, test } from 'bun:test';

import mergedPages from './mergedPages';

const source =
	(name, times) =>
	async ({ offset, limit }) => ({
		sessions: times.slice(offset, offset + limit).map(lastModified => ({ id: `${name}${lastModified}`, lastModified })),
		total: times.length,
	});

test('pages through several sources newest first, each read only as far as it needs to be', async () => {
	const fetchPage = mergedPages([source('a', [9, 6, 3, 1]), source('b', [8, 7, 2])]);
	const ids = page => page.sessions.map(({ id }) => id);

	const first = await fetchPage({ q: '', offset: 0, limit: 3 });

	expect(ids(first)).toEqual(['a9', 'b8', 'b7']);
	expect(first.total).toBe(7);
	expect(ids(await fetchPage({ q: '', offset: 3, limit: 3 }))).toEqual(['a6', 'a3', 'b2']);
	expect(ids(await fetchPage({ q: '', offset: 6, limit: 3 }))).toEqual(['a1']);
	expect(ids(await fetchPage({ q: '', offset: 0, limit: 2 }))).toEqual(['a9', 'b8']);
});

test('whatever narrows the listing reaches every source, and something else asked starts over', async () => {
	const asked = [];
	const fetchPage = mergedPages([
		async page => {
			asked.push(page);

			return { sessions: [{ id: 'a', lastModified: 1 }], total: 1 };
		},
	]);

	await fetchPage({ filter: 'running', offset: 0, limit: 5 });
	await fetchPage({ filter: 'archived', q: 'attic', offset: 1, limit: 5 });

	expect(asked).toEqual([
		{ filter: 'running', offset: 0, limit: 5 },
		{ filter: 'archived', q: 'attic', offset: 0, limit: 5 },
	]);
});
