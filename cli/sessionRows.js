import dayGroup, { DAY_GROUPS, whenIn } from '../shared/dayGroup';

export const FILTERS = ['', 'running', 'watching', 'archived'];
export const FILTER_LABELS = { '': 'All', running: 'Running', watching: 'Watching', archived: 'Archived' };

// What a row can be pressed for
export const SELECTABLE = new Set(['session', 'project', 'new', 'more']);

const heading = (label, count) => ({ kind: 'heading', label, count });
const note = text => ({ kind: 'note', text });

export const projectKey = ({ server, name }) => `${server.label}/${name}`;
export const sessionKey = ({ server, session }) => `${server.label}/${session.id}`;

const sessionRow = (entry, extra = {}) => ({ kind: 'session', key: sessionKey(entry), ...entry, ...extra });

const when = ({ session }) => session.lastModified ?? session.activeAt;

// The picker's rows, from what it loaded: entries are { server, session } (or { server, ...project } for projects).
// Above the list, while nothing narrows it, what needs you and what's going on among the watched; then every session
// newest first, grouped by day (each time told in its group's terms), or the projects, each open one with its newest
// sessions under it. Inside a project, starting a new session comes first.
export const browserRows = ({
	project,
	narrowed,
	filter,
	groupBy,
	asking = [],
	going = [],
	sessions = [],
	total = 0,
	projects = [],
	previews = {},
	opened = {},
}) => {
	const rows = [];

	if (project) rows.push({ kind: 'new', key: 'new' });

	if (!narrowed && !project) {
		if (asking.length) rows.push(heading('Needs you'), ...asking.map(entry => sessionRow(entry)));
		if (going.length) rows.push(heading('Watching: running, or with news'), ...going.map(entry => sessionRow(entry)));
	}

	if (!narrowed && !project && groupBy === 'project') {
		rows.push(heading('Projects', projects.length));
		if (!projects.length) rows.push(note('no projects yet: run paude add in a folder'));

		for (const found of projects) {
			const key = projectKey(found);
			const open = opened[key] ?? Boolean(found.watching || found.liveCount);
			const preview = previews[key];

			rows.push({ kind: 'project', key, project: found, open });
			if (!open) continue;
			if (!preview) rows.push(note('  loading'));
			else if (!preview.sessions.length) rows.push(note('  no sessions yet'));
			else rows.push(...preview.sessions.map(entry => sessionRow(entry, { depth: 1, inProject: true })));
		}

		return rows;
	}

	if (narrowed)
		rows.push(heading(`${total} ${filter ? FILTER_LABELS[filter].toLowerCase() : 'matching'}, newest first`));
	else if (!project) rows.push(heading('Sessions'));

	for (const group of DAY_GROUPS) {
		const inGroup = sessions.filter(entry => dayGroup(when(entry)) === group);

		if (!inGroup.length) continue;
		if (!narrowed) rows.push(heading(group, inGroup.length));
		rows.push(
			...inGroup.map(entry =>
				// Without its day's heading over it, a time of day would be ambiguous: the renderer says how long ago
				sessionRow(entry, {
					when: narrowed ? undefined : whenIn(group, when(entry)),
					inProject: Boolean(project),
					depth: narrowed ? 0 : 1,
				}),
			),
		);
	}

	if (!sessions.length) rows.push(note(narrowed ? 'none' : 'no sessions yet'));
	if (sessions.length < total) rows.push({ kind: 'more', key: 'more', count: total - sessions.length });

	return rows;
};
