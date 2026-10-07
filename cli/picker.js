import { runningSummary } from '../shared/checkouts';
import { matchesQuery } from '../shared/sessionSearch';
import { readProgress, recentLines } from '../shared/progress';
import { projectSummary } from '../shared/projects';
import sessionUrgency from '../shared/urgency';
import relativeTime from '../shared/relativeTime';
import { visitServer } from '../shared/serverClient';
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

// Any key in `keys` resolves with that key and the selected row
const choose = ({ title, subtitle, rows: entries, hint, keys = [], initial = 0 }) =>
	new Promise(resolve => {
		const selectable = entries
			.map((entry, index) => (entry.value === undefined ? null : index))
			.filter(index => index !== null);
		let cursor = Math.max(0, selectable.indexOf(initial));

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

// One line of text typed in place: Enter keeps it, Esc gives up (null)
const askLine = ({ title, subtitle, prompt, hint }) =>
	new Promise(resolve => {
		let text = '';

		const draw = () => {
			const { cols } = size();

			write(
				`${CLEAR}${bold(title)}${subtitle ? `  ${subtitle}` : ''}\r\n\r\n${prompt} ${text}█\r\n\r\n${dim(fit(hint, cols - 1))}`,
			);
		};

		// A paste, or fast typing, arrives as one chunk, Enter and all
		const stop = rawInput(key => {
			if (key === '\x1b' || key === '\x03') return finish(null);
			if (key.startsWith('\x1b')) return;

			for (const character of key) {
				if (is(character, 'enter')) return finish(text.trim());
				if (character === '\x7f' || character === '\b') text = text.slice(0, -1);
				else text += printable(character);
			}

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

// Where a new session goes, asked every time in a git repository: { checkout } to start with, or null to go back
const pickCheckout = async (server, project) => {
	const { checkouts } = await api(server, `/api/projects/${encodeURIComponent(project)}/checkouts`);

	if (!checkouts) return { checkout: undefined };

	const main = checkouts.find(checkout => checkout.main);
	const running = active => (active ? colored(`${active} running`, 179) : '');
	const rows = [
		{
			label: 'No worktree',
			detail: [`the project folder, on ${main.branch ?? 'a detached HEAD'}`, running(main.active)]
				.filter(Boolean)
				.join(' · '),
			value: { checkout: undefined },
		},
		...checkouts
			.filter(checkout => !checkout.main)
			.map(({ name, path, branch, active }) => ({
				label: `Worktree ${printable(name)}`,
				detail: [branch && branch !== name && `on ${printable(branch)}`, running(active)].filter(Boolean).join(' · '),
				value: { checkout: { join: path } },
			})),
		{ label: '＋ A new worktree', value: 'new' },
	];
	const picked = await choose({
		title: `paude · ${project}`,
		subtitle: runningSummary(checkouts),
		hint: '↑↓ move · enter start here · esc back',
		rows,
		// The main checkout is already busy: a worktree is the likelier want
		initial: main.active ? rows.length - 1 : 0,
	});

	if (picked !== 'new') return picked;

	const name = await askLine({
		title: `paude · ${project}`,
		subtitle: dim('a new worktree'),
		prompt: 'Name:',
		hint: 'enter create it (empty: named from the prompt, or at random) · esc back',
	});

	return name === null ? null : { checkout: { create: name } };
};

// Making a worktree streams the repo's own setup, shown here as it runs
const startSession = async (server, project, checkout) => {
	const route = `/api/projects/${encodeURIComponent(project)}/sessions`;

	if (!checkout || !('create' in checkout))
		return (await api(server, route, { method: 'POST', body: JSON.stringify({ checkout }) })).id;

	const response = await fetch(`${server.url}${route}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ checkout }),
	});

	if (!response.ok) throw new Error(await response.text());

	let output = '';
	const draw = () => {
		const { cols, rows } = size();
		const lines = recentLines(output, Math.max(rows - 4, 1)).map(line => fit(printable(line), cols - 1));

		write(`${CLEAR}${bold(`paude · ${project}`)}  ${dim('making the worktree')}\r\n\r\n${lines.join('\r\n')}`);
	};

	draw();

	const result = await readProgress(response, arrived => {
		output += arrived;
		draw();
	});

	if (result.error) throw new Error(result.error);

	return result.id;
};

// Every session on a server, narrowed as you type (title, first prompt, project, branch): the session, or null to
// go back
const pickFromAll = (server, sessions) =>
	new Promise(resolve => {
		let filter = '';
		let cursor = 0;

		const matching = () => sessions.filter(session => matchesQuery(session, filter));

		const draw = () => {
			const { cols, rows } = size();
			const shown = matching();
			const room = rows - 6;
			const start = Math.max(0, Math.min(cursor - Math.floor(room / 2), shown.length - room));
			const lines = [
				`${bold('paude · all sessions')}  ${dim(server.label)}`,
				`${orange('/')} ${printable(filter)}█  ${dim(`${shown.length} of ${sessions.length}`)}`,
				'',
			];

			for (const [offset, session] of shown.slice(start, start + room).entries()) {
				const row = sessionRow(server, session, { showProject: true });
				const line = `${row.marker} ${row.label}  ${dim(row.detail)}`;

				lines.push(start + offset === cursor ? inverse(fit(line, cols - 1)) : fit(line, cols - 1));
			}

			if (!shown.length) lines.push(dim('  no sessions match'));
			write(
				`${CLEAR}${lines.join('\r\n')}\r\n\r\n${dim(fit('type to search · ↑↓ move · enter open · esc clear or back', cols - 1))}`,
			);
		};

		const stop = rawInput(key => {
			const shown = matching();

			if (is(key, 'up') && !/^[jk]$/.test(key)) cursor = Math.max(0, cursor - 1);
			else if (is(key, 'down') && !/^[jk]$/.test(key)) cursor = Math.min(shown.length - 1, cursor + 1);
			else if (is(key, 'enter')) return shown[cursor] && finish(shown[cursor]);
			else if (key === '\x1b' || key === '\x03') {
				if (filter && key === '\x1b') {
					filter = '';
					cursor = 0;
				} else return finish(null);
			} else if (key === '\x7f' || key === '\b') filter = filter.slice(0, -1);
			else if (!key.startsWith('\x1b')) {
				filter += printable(key);
				cursor = 0;
			}

			cursor = Math.max(0, Math.min(cursor, matching().length - 1));
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
	waiting: { marker: '\x1b[1;38;5;179m!\x1b[22;39m', label: 'needs you' },
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
		session.worktree && `⎇ ${printable(session.worktree)}`,
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

	const where = await pickCheckout(server, project);

	if (!where) return null;

	try {
		return await startSession(server, project, where.checkout);
	} catch (error) {
		await choose({
			title: `paude · ${project}`,
			subtitle: colored(printable(error.message), 179),
			hint: 'enter back',
			rows: [{ label: 'Back', value: true }],
		});

		return null;
	}
};

const pickProject = async (server, projects) => {
	while (true) {
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

		if (!picked) return null;

		const id = await pickInProject(server, picked);

		if (id) return id;
	}
};

const gather = async server => {
	const visit = await visitServer(server);

	server.id = visit.serverId;
	// A name given here wins over the one the server goes by
	if (!server.local && !server.alias && visit.name) server.label = visit.name;

	return { server, ...visit };
};

const byUrgency = (a, b) => sessionUrgency(a.session, b.session);

const summaryOf = watched => {
	const waiting = watched.filter(({ session }) => session.status === 'waiting').length;
	const unseen = watched.reduce((sum, { session }) => sum + session.unseen, 0);

	return [waiting && colored(`${waiting} need${waiting === 1 ? 's' : ''} you`, 179), unseen && `${unseen} new`]
		.filter(Boolean)
		.join(dim(' · '));
};

const serverRows = ({ server, identity, sessions, projects, error }, watchedIds, watched, several) => {
	const rows = [{ label: several ? server.label : 'Continue' }];

	if (error) return [...rows, { note: printable(error) }];

	const recent = sessions.filter(session => !watchedIds.has(session.id));

	rows.push(...recent.map(session => sessionRow(server, session, { showProject: true })));
	// One row for the projects, so every server's sessions stay in view however many folders one has
	if (projects.length) {
		rows.push({
			label: '▸ All sessions',
			detail: 'search by title, prompt, project or branch',
			value: { server, allSessions: true },
		});
		rows.push({
			label: `▸ Projects (${projects.length})`,
			detail: 'start or find a session in one',
			marker: projects.some(project => project.liveCount) ? green('●') : ' ',
			value: { server, projects },
		});
	}

	if (identity.owner && !recent.length && !projects.length)
		rows.push({ note: server.local ? 'no folders yet: run paude add in one' : 'nothing here yet' });

	return rows;
};

const pickSession = async servers => {
	write(ENTER_ALT_SCREEN);

	try {
		while (true) {
			const seen = new Set();
			// Same server at two addresses: shown once, under the first
			const gathered = (await Promise.all(servers.map(gather))).filter(({ server }) => {
				if (!server.id) return true;
				if (seen.has(server.id)) return false;
				seen.add(server.id);

				return true;
			});
			const several = gathered.length > 1;
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

			if (picked.allSessions) {
				const all = await api(picked.server, '/api/sessions?limit=500');
				const session = await pickFromAll(picked.server, all);

				if (session) return { server: picked.server, id: session.id, identity };
				continue;
			}

			const id = await pickProject(picked.server, picked.projects);

			if (id) return { server: picked.server, id, identity };
		}
	} finally {
		write(LEAVE_ALT_SCREEN);
	}
};

export default pickSession;
