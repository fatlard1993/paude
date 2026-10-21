import { expect, test } from 'bun:test';

import { browserRows } from './sessionRows';

const server = { label: 'This machine' };
const hoursAgo = hours => Date.now() - hours * 60 * 60 * 1000;
const entry = (id, hours, extra = {}) => ({
	server,
	session: { id, title: id, lastModified: hoursAgo(hours), ...extra },
});
const shape = rows =>
	rows.map(
		row =>
			({
				heading: `# ${row.label}`,
				note: `~ ${row.text}`,
				session: row.session?.id,
				project: `> ${row.project?.name}`,
				new: '+',
				more: `+${row.count}`,
			})[row.kind],
	);

test('what needs you and what is going on head the list, then every session under the day it last changed', () => {
	const rows = browserRows({
		asking: [entry('asking', 0)],
		going: [entry('busy', 1)],
		sessions: [entry('fresh', 0), entry('older', 24 * 40)],
		total: 3,
		groupBy: 'day',
	});

	expect(shape(rows)).toEqual([
		'# Needs you',
		'asking',
		'# Watching: running, or with news',
		'busy',
		'# Sessions',
		'# Today',
		'fresh',
		'# Older',
		'older',
		'+1',
	]);
});

test('a filter or a search is a flat list that says what it holds, its times relative', () => {
	const rows = browserRows({
		narrowed: true,
		filter: 'archived',
		asking: [entry('asking', 0)],
		sessions: [entry('put-away', 30)],
		total: 1,
	});

	expect(shape(rows)).toEqual(['# 1 archived, newest first', 'put-away']);
	expect(rows[1].when).toBeUndefined();
});

test('by project: each project, and the open ones (watched or running unless told) with their newest sessions', () => {
	const projects = [
		{ server, name: 'watched', watching: true },
		{ server, name: 'quiet' },
		{ server, name: 'opened' },
	];
	const rows = browserRows({
		groupBy: 'project',
		projects,
		opened: { 'This machine/opened': true },
		previews: { 'This machine/watched': { sessions: [entry('w1', 2)] }, 'This machine/opened': { sessions: [] } },
	});

	expect(shape(rows)).toEqual(['# Projects', '> watched', 'w1', '> quiet', '> opened', '~   no sessions yet']);
});

test('inside a project, a new session comes first', () => {
	expect(shape(browserRows({ project: 'demo', sessions: [entry('one', 1)], total: 1 }))).toEqual([
		'+',
		'# Today',
		'one',
	]);
});
