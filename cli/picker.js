import { byRecentActivity, projectSummary } from '../shared/projects';
import relativeTime from '../shared/relativeTime';
import {
	CLEAR,
	ENTER_ALT_SCREEN,
	LEAVE_ALT_SCREEN,
	bold,
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

// A full-screen list: arrows or j/k move, Enter picks, Esc or q goes back. Section headings aren't selectable.
const choose = ({ title, rows: entries, hint }) =>
	new Promise(resolve => {
		const selectable = entries
			.map((entry, index) => (entry.value === undefined ? null : index))
			.filter(index => index !== null);
		let cursor = 0;

		const draw = () => {
			const { cols, rows } = size();
			const room = rows - 4;
			const selected = selectable[cursor];
			const start = Math.max(0, Math.min(selected - Math.floor(room / 2), entries.length - room));
			const lines = [bold(title), ''];

			for (const [offset, entry] of entries.slice(start, start + room).entries()) {
				const index = start + offset;

				if (entry.value === undefined) lines.push(dim(entry.label.toUpperCase()));
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

const marker = ({ busy, live }) => {
	if (busy) return orange('◐');
	if (live) return green('●');

	return ' ';
};

const sessionRow = (session, showProject) => ({
	label: printable(session.title),
	detail: [
		showProject && session.project,
		relativeTime(session.lastModified),
		session.attached ? `${session.attached} here` : '',
	]
		.filter(Boolean)
		.join(' · '),
	marker: marker(session),
	value: { session: session.id },
});

const request = async ({ url, token }, path, init = {}) => {
	const response = await fetch(`${url}${path}`, {
		...init,
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
	});

	if (response.status === 401) throw new Error(`${url} refused the saved login; run: paude login ${url}`);
	if (!response.ok) throw new Error(`${url}${path} answered ${response.status}`);

	return response.json();
};

const pickInProject = async (server, project) => {
	const sessions = await request(server, `/api/projects/${encodeURIComponent(project)}/sessions`);
	const picked = await choose({
		title: `paude · ${project}`,
		hint: '↑↓ move · enter open · esc back',
		rows: [
			{ label: '＋ New session', value: { create: project } },
			...sessions.map(session => sessionRow(session, false)),
		],
	});

	if (!picked?.create) return picked?.session ?? null;

	const { id } = await request(server, `/api/projects/${encodeURIComponent(project)}/sessions`, {
		method: 'POST',
		body: JSON.stringify({}),
	});

	return id;
};

// Resolves to a session id, or null when the user backs out
const pickSession = async server => {
	write(ENTER_ALT_SCREEN);

	try {
		while (true) {
			const [sessions, projects] = await Promise.all([
				request(server, '/api/sessions?limit=8'),
				request(server, '/api/projects'),
			]);
			const ordered = projects.sort(byRecentActivity);

			const picked = await choose({
				title: 'paude',
				hint: '↑↓ move · enter open · q quit',
				rows: [
					{ label: 'Continue' },
					...sessions.map(session => sessionRow(session, true)),
					{ label: 'Projects' },
					...ordered.map(project => ({
						label: printable(project.name),
						detail: projectSummary(project),
						marker: project.liveCount ? green('●') : ' ',
						value: { project: project.name },
					})),
				],
			});

			if (!picked) return null;
			if (picked.session) return picked.session;

			const id = await pickInProject(server, picked.project);

			if (id) return id;
		}
	} finally {
		write(LEAVE_ALT_SCREEN);
	}
};

export default pickSession;
