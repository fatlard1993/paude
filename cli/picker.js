import { byRecentActivity, projectSummary } from '../shared/projects';
import relativeTime from '../shared/relativeTime';
import {
	CLEAR,
	ENTER_ALT_SCREEN,
	LEAVE_ALT_SCREEN,
	bold,
	colored,
	dim,
	fit,
	green,
	inverse,
	is,
	orange,
	printable,
	rawInput,
	size,
	write,
} from './screen';
import { api } from './servers';

// A full-screen list: arrows or j/k move, Enter picks, Esc or q goes back, and any key in `keys` resolves with that
// key and the selected row. Section headings and notes aren't selectable.
const choose = ({ title, subtitle, rows: entries, hint, keys = [] }) =>
	new Promise(resolve => {
		const selectable = entries
			.map((entry, index) => (entry.value === undefined ? null : index))
			.filter(index => index !== null);
		let cursor = 0;

		const draw = () => {
			const { cols, rows } = size();
			const room = rows - 5;
			const selected = selectable[cursor];
			const start = Math.max(0, Math.min(selected - Math.floor(room / 2), entries.length - room));
			const lines = [`${bold(title)}${subtitle ? `  ${subtitle}` : ''}`, ''];

			for (const [offset, entry] of entries.slice(start, start + room).entries()) {
				const index = start + offset;

				if (entry.note) lines.push(`  ${dim(entry.note)}`);
				else if (entry.value === undefined) lines.push(dim(entry.label.toUpperCase()));
				else {
					const line = `${entry.marker ?? ' '} ${entry.label}${entry.detail ? `  ${dim(entry.detail)}` : ''}`;

					lines.push(index === selected ? inverse(fit(line, cols - 1)) : fit(line, cols - 1));
				}
			}

			write(`${CLEAR}${lines.join('\r\n')}\r\n\r\n${dim(fit(hint, cols - 1))}`);
		};

		const stop = rawInput(key => {
			if (is(key, 'up')) cursor = Math.max(0, cursor - 1);
			else if (is(key, 'down')) cursor = Math.min(selectable.length - 1, cursor + 1);
			else if (is(key, 'enter') && selectable.length) return finish(entries[selectable[cursor]].value);
			else if (is(key, 'back')) return finish(null);
			else if (keys.includes(key) && selectable.length) return finish({ key, row: entries[selectable[cursor]].value });

			draw();
		});

		const finish = value => {
			stop();
			process.stdout.off('resize', draw);
			resolve(value);
		};

		process.stdout.on('resize', draw);
		draw();
	});

const STATUS = {
	waiting: { marker: '\x1b[1;38;5;179m!\x1b[0m', label: 'needs you' },
	working: { marker: orange('◐'), label: 'working' },
	ready: { marker: green('●'), label: 'ready' },
	stopped: { marker: ' ', label: '' },
};

const sessionRow = (server, session, { showServer, showProject }) => ({
	label: `${printable(session.title) || 'untitled'}${session.watching ? dim(' 👁') : ''}`,
	detail: [
		session.unseen ? colored(`${session.unseen} new`, 179) : '',
		STATUS[session.status]?.label,
		showServer && server.label,
		showProject && session.project,
		relativeTime(session.lastModified ?? session.activeAt),
		session.attached ? `${session.attached} here` : '',
	]
		.filter(Boolean)
		.join(' · '),
	marker: STATUS[session.status]?.marker ?? ' ',
	value: { server, session },
});

const pickInProject = async (server, project) => {
	const sessions = await api(server, `/api/projects/${encodeURIComponent(project)}/sessions`);
	const picked = await choose({
		title: `paude · ${project}`,
		subtitle: dim(server.label),
		hint: '↑↓ move · enter open · esc back',
		rows: [
			{ label: '＋ New session', value: { create: project } },
			...sessions.map(session => sessionRow(server, session, {})),
		],
	});

	if (!picked?.create) return picked?.session?.id ?? null;

	const { id } = await api(server, `/api/projects/${encodeURIComponent(project)}/sessions`, {
		method: 'POST',
		body: JSON.stringify({}),
	});

	return id;
};

const pickProject = async (server, projects) => {
	const picked = await choose({
		title: 'paude · projects',
		subtitle: dim(server.label),
		hint: '↑↓ move · enter open · esc back',
		rows: projects.map(project => ({
			label: printable(project.name),
			detail: projectSummary(project),
			marker: project.liveCount ? green('●') : ' ',
			value: project.name,
		})),
	});

	return picked ? pickInProject(server, picked) : null;
};

// What one server has for this person: an owner sees recent sessions and projects, a guest their one session
const gather = async server => {
	try {
		const { identity } = await api(server, '/api/auth');

		if (!identity) throw new Error('the saved login has ended');
		if (!identity.owner) {
			return { server, identity, watching: await api(server, '/api/watching'), sessions: [], projects: [] };
		}

		const [watching, sessions, projects] = await Promise.all([
			api(server, '/api/watching'),
			api(server, '/api/sessions?limit=8'),
			api(server, '/api/projects'),
		]);

		return { server, identity, watching, sessions, projects: projects.sort(byRecentActivity) };
	} catch (error) {
		return { server, error: error.name === 'TimeoutError' ? 'not answering' : error.message };
	}
};

// What needs a person most: a question first, then the most unseen, then the most recently active
const byUrgency = (a, b) =>
	(b.session.status === 'waiting') - (a.session.status === 'waiting') ||
	b.session.unseen - a.session.unseen ||
	(b.session.activeAt ?? 0) - (a.session.activeAt ?? 0);

const summaryOf = watched => {
	const waiting = watched.filter(({ session }) => session.status === 'waiting').length;
	const unseen = watched.reduce((sum, { session }) => sum + session.unseen, 0);

	return [waiting && colored(`${waiting} need${waiting === 1 ? 's' : ''} you`, 179), unseen && `${unseen} new`]
		.filter(Boolean)
		.join(dim(' · '));
};

const serverRows = ({ server, identity, sessions, projects, error }, watchedIds, watched, several) => {
	const rows = [{ label: several ? server.label : 'Continue' }];

	if (error) return [...rows, { note: error }];

	const recent = sessions.filter(session => !watchedIds.has(session.id));

	rows.push(...recent.map(session => sessionRow(server, session, { showProject: true })));
	// One row for the projects, so every server's sessions stay in view however many folders one has
	if (projects.length) {
		rows.push({
			label: `▸ Projects (${projects.length})`,
			detail: 'start or find a session in one',
			marker: projects.some(project => project.liveCount) ? green('●') : ' ',
			value: { server, projects },
		});
	}

	if (!identity.owner && !watched.some(({ server: other }) => other === server))
		rows.push({ note: 'your invited session is not watched; press w on it once it shows, or open its link' });
	if (identity.owner && !recent.length && !projects.length)
		rows.push({ note: server.local ? 'no folders yet: run paude add in one' : 'nothing here yet' });

	return rows;
};

// Resolves to { server, id, identity }, or null when the user backs out
const pickSession = async servers => {
	write(ENTER_ALT_SCREEN);

	try {
		while (true) {
			const gathered = await Promise.all(servers.map(gather));
			const several = servers.length > 1;
			const watched = gathered
				.flatMap(({ server, watching }) => (watching ?? []).map(session => ({ server, session })))
				.sort(byUrgency);
			const watchedIds = new Set(watched.map(({ session }) => session.id));
			const rows = [
				...(watched.length ? [{ label: 'Watching' }] : []),
				...watched.map(({ server, session }) =>
					sessionRow(server, session, { showServer: several, showProject: true }),
				),
				...gathered.flatMap(found => serverRows(found, watchedIds, watched, several)),
			];

			const picked = await choose({
				title: 'paude',
				subtitle: summaryOf(watched),
				hint: '↑↓ move · enter open · w watch or stop watching · q quit',
				rows,
				keys: ['w'],
			});

			if (!picked) return null;

			if (picked.key === 'w') {
				const { server, session } = picked.row;

				if (session) {
					await api(server, `/api/sessions/${session.id}/watch`, {
						method: 'PUT',
						body: JSON.stringify({ watching: !session.watching }),
					}).catch(() => {});
				}
				continue;
			}

			const { identity } = gathered.find(({ server }) => server === picked.server);

			if (picked.session) return { server: picked.server, id: picked.session.id, identity };

			const id = await pickProject(picked.server, picked.projects);

			if (id) return { server: picked.server, id, identity };
		}
	} finally {
		write(LEAVE_ALT_SCREEN);
	}
};

export default pickSession;
