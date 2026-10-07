import { expect, test } from 'bun:test';

import mergedPages from './mergedPages';

const source = (name, times) => async ({ offset, limit }) => ({
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
