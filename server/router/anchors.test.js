import { expect, test } from 'bun:test';

import { anchoredOn } from './git';

const comments = [
	{ id: 'open', resolved: false, anchor: { path: 'a.js', side: 'new' } },
	{ id: 'done', resolved: true, anchor: { path: 'a.js', side: 'new' } },
	{ id: 'before', resolved: false, anchor: { path: 'a.js', side: 'old' } },
	{ id: 'other', resolved: false, anchor: { path: 'b.js', side: 'new' } },
];
const ids = found => found.map(({ id }) => id);

test('the anchors route places the open comments on a file, or the one asked for, resolved too', () => {
	expect(ids(anchoredOn(comments, { path: 'a.js', inDiff: false }))).toEqual(['open']);
	expect(ids(anchoredOn(comments, { path: 'a.js', inDiff: true }))).toEqual(['open', 'before']);
	expect(ids(anchoredOn(comments, { path: 'a.js', inDiff: false, comment: 'done' }))).toEqual(['done']);
	expect(ids(anchoredOn(comments, { path: 'a.js', inDiff: false, comment: 'other' }))).toEqual([]);
});
