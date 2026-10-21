import { relativeTime } from '@vanilla-bean/components/utils/date';
import { runningSummary } from '../shared/checkouts';
import mergedPages from '../shared/mergedPages';
import { matchesFilter, matchesQuery } from '../shared/sessionSearch';
import { readProgress, recentLines } from '../shared/progress';
import { byWatchedThenRecent, projectSummary } from '../shared/projects';
import sessionUrgency from '../shared/urgency';
import { serverPage, visitServer } from '../shared/serverClient';
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
	wrap,
	write,
} from './screen';
import { loadPrefs, savePrefs } from './prefs';
import { FILTERS, FILTER_LABELS, SELECTABLE, browserRows, projectKey } from './sessionRows';
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

// One line of text typed in place, starting from `initial`: Enter keeps it, Esc gives up (null)
const askLine = ({ title, subtitle, prompt, hint, initial = '' }) =>
	new Promise(resolve => {
		let text = initial;

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
				// As a shell's line takes them: Ctrl+U clears it, Ctrl+W takes the last word
				else if (character === '\x15') text = '';
				else if (character === '\x17') text = text.replace(/\S*\s*$/, '');
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
		{ label: '＋ A new worktree from a branch or PR', detail: 'to review it, or try it', value: 'from' },
	];
	const picked = await choose({
		title: `paude · ${project}`,
		subtitle: runningSummary(checkouts),
		hint: '↑↓ move · enter start here · esc back',
		rows,
		// The main checkout is already busy: a worktree is the likelier want
		initial: main.active ? rows.length - 2 : 0,
	});

	if (picked === 'from') {
		const from = await askLine({
			title: `paude · ${project}`,
			subtitle: dim('a new worktree from a branch or pull request'),
			prompt: 'From:',
			hint: 'a branch, tag, commit or PR number (#123) · enter create it · esc back',
		});

		return from?.trim() ? { checkout: { create: '', from: from.trim() } } : null;
	}

	if (picked !== 'new') return picked;

	const name = await askLine({
		title: `paude · ${project}`,
		subtitle: dim('a new worktree'),
		prompt: 'Name:',
		hint: 'enter create it (empty: named from the prompt, or at random) · esc back',
	});

	return name === null ? null : { checkout: { create: name } };
};

// A pull request that brings files Claude Code reads on start (hooks it would run among them) is checked out, but
// Claude starts in it only when asked: the warning, then Don't start (first, so a reflexive Enter is the safe one)
// and Start anyway
export const startAnywayRows = ({ warning }, width) => [
	...wrap(printable(warning), width).map(note => ({ note })),
	{ label: "Don't start", detail: 'leave the worktree to look over', value: 'leave' },
	{ label: 'Start anyway', value: 'start' },
];

export const leftWorktree = worktree =>
	`Claude wasn't started. The worktree is at ${printable(worktree)}; once you've looked, start a session in it from here.`;

const startAnyway = async (server, project, route, result) => {
	const title = `paude · ${project}`;
	const picked = await choose({
		title,
		subtitle: colored('Claude is not started yet', 179),
		hint: "↑↓ move · enter pick · esc don't start",
		rows: startAnywayRows(result, size().cols - 4),
	});

	if (picked === 'start')
		return (await api(server, route, { method: 'POST', body: JSON.stringify({ checkout: { join: result.worktree } }) }))
			.id;

	await choose({
		title,
		subtitle: dim('nothing started'),
		hint: 'enter back',
		rows: [
			...wrap(leftWorktree(result.worktree), size().cols - 4).map(note => ({ note })),
			{ label: 'Back', value: true },
		],
	});

	return null;
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
	if (result.files) return startAnyway(server, project, route, result);

	return result.id;
};

const PAGE = 50;
const PREVIEW = 3;
const SEARCH_DELAY_MS = 200;
const ESC = '\x1b';
const KEY = {
	tab: '\t',
	backTab: `${ESC}[Z`,
	right: [`${ESC}[C`, `${ESC}OC`, 'l'],
	left: [`${ESC}[D`, `${ESC}OD`, 'h'],
};

const STATUS = {
	waiting: { marker: '\x1b[1;38;5;179m!\x1b[22;39m', label: 'needs you' },
	working: { marker: orange('◐'), label: 'working' },
	ready: { marker: green('●'), label: 'ready' },
	stopped: { marker: ' ', label: '' },
};

const byUrgency = (a, b) => sessionUrgency(a.session, b.session);
const counted = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const gather = async server => {
	const visit = await visitServer(server);

	server.id = visit.serverId;
	// A name given here wins over the one the server goes by
	if (!server.local && !server.alias && visit.name) server.label = visit.name;

	return { server, ...visit };
};

// Same server at two addresses: shown once, under the first
const gatherAll = async servers => {
	const seen = new Set();

	return (await Promise.all(servers.map(gather))).filter(({ server }) => {
		if (!server.id) return true;
		if (seen.has(server.id)) return false;
		seen.add(server.id);

		return true;
	});
};

const summaryOf = watched => {
	const waiting = watched.filter(({ session }) => session.status === 'waiting').length;
	const unseen = watched.reduce((sum, { session }) => sum + session.unseen, 0);

	return [waiting && colored(`${waiting} need${waiting === 1 ? 's' : ''} you`, 179), unseen && `${unseen} new`]
		.filter(Boolean)
		.join(dim(' · '));
};

// A server's sessions a page at a time, narrowed by `asked` ({ q, filter, project }). A guest has its one session. An
// older server ignores the filters, so they're applied here too.
const pagesOf =
	({ server, identity, sessions: own }) =>
	async ({ offset, limit, ...asked }) => {
		const keep = session =>
			matchesQuery(session, asked.q) &&
			matchesFilter(session, asked.filter, asked.q) &&
			(!asked.project || session.project === asked.project);

		if (!identity?.owner) {
			const mine = offset ? [] : (own ?? []).filter(keep);

			return { sessions: mine.map(session => ({ server, session })), total: mine.length };
		}

		const query = new URLSearchParams({ ...asked, offset: String(offset), limit: String(limit) });
		const { items, total } = await serverPage(server, `/api/sessions?${query}`);

		return { sessions: items.filter(keep).map(session => ({ server, session })), total };
	};

// The first `count` sessions the servers have between them, newest first, less those listed above them
const sessionsFrom = async (gathered, asked, count, above) => {
	const fetchPage = mergedPages(
		gathered.filter(({ error }) => !error).map(pagesOf),
		entry => entry.session.lastModified ?? 0,
	);
	const sessions = [];
	let total = Infinity;
	let fetched = 0;

	while (sessions.length < count && fetched < total) {
		const page = await fetchPage({ ...asked, offset: fetched, limit: PAGE });

		total = page.sessions.length ? page.total : fetched;
		fetched += page.sessions.length;
		sessions.push(...page.sessions.filter(({ session }) => !above.has(session.id)));
	}

	return { sessions, total: Math.max(total - above.size, sessions.length) };
};

const sessionLine = (row, { several, picked, cols }) => {
	const { server, session } = row;
	const status = STATUS[session.status] ?? STATUS.stopped;
	const detail = [
		session.unseen ? colored(`${session.unseen} new`, 179) : '',
		status.label,
		session.archived && 'archived',
		several && server.label,
		!row.inProject && session.project,
		session.worktree && `⎇ ${printable(session.worktree)}`,
		row.when ?? relativeTime(session.lastModified ?? session.activeAt),
		session.attached ? `${session.attached} here` : '',
	]
		.filter(Boolean)
		.join(' · ');
	const title = `${printable(session.title) || 'untitled'}${session.watching ? dim(' 👁') : ''}`;

	return fit(
		`${'  '.repeat(row.depth ?? 0)}${picked ? orange('✓') : ' '}${status.marker} ${title}  ${dim(detail)}`,
		cols,
	);
};

const projectLine = ({ project, open }, { several, cols }) => {
	const about = [
		several && project.server.label,
		project.liveCount && green(`${project.liveCount} running`),
		projectSummary(project),
	]
		.filter(Boolean)
		.join(' · ');

	return fit(
		`${open ? '▾' : '▸'} ${bold(printable(project.name))}${project.watching ? dim(' 👁') : ''}  ${dim(about)}`,
		cols,
	);
};

const lineOf = (row, context) => {
	if (row.kind === 'heading') return dim(`${row.label.toUpperCase()}${row.count ? `  ${row.count}` : ''}`);
	if (row.kind === 'note') return dim(`  ${row.text}`);
	if (row.kind === 'session') return sessionLine(row, { ...context, picked: context.picked.has(row.key) });
	if (row.kind === 'project') return projectLine(row, context);
	if (row.kind === 'new') return '  ＋ New session';

	return `  ${dim(`▸ ${row.count} more`)}`;
};

const HINTS = [
	'↑↓ move · enter open · / search · tab running, watching, archived · g by day or project · q quit',
	'space pick several · w watch · a archive · r rename · d delete · u undo · →← open or close a project',
];

// The sessions across the servers, as the web's home lists them: what needs you and what's going on among the
// watched, then every one newest first, by day or by project, searchable and narrowed by filter, each one acted on
// where it stands. `scope` ({ server, identity, project }) is one project's, with a new session first. Resolves with
// { server, id, identity } to open, or null.
const browse = ({ servers, scope }) =>
	new Promise(resolve => {
		const prefs = { groupBy: 'day', openProjects: {} };
		const state = { query: '', typing: false, filter: '', cursor: null, message: '', undo: null, count: PAGE };
		const picked = new Map();
		let data = { rows: [], gathered: [], watched: [] };
		let stop = () => {};
		let timer;
		let loading = 0;
		let busy = false;
		let done = false;

		const narrowed = () => Boolean(state.query || state.filter);
		const selectable = () => data.rows.filter(row => SELECTABLE.has(row.kind));
		const current = () => selectable().find(row => row.key === state.cursor) ?? selectable()[0];

		const load = async () => {
			const ask = ++loading;
			const gathered = scope ? [{ ...scope, ...(await visitServer(scope.server)) }] : await gatherAll(servers);
			const watched = scope
				? []
				: gathered
						.flatMap(({ server, watching }) => (watching ?? []).map(session => ({ server, session })))
						.sort(byUrgency);
			const asking = watched.filter(({ session }) => session.status === 'waiting');
			const going = watched.filter(
				({ session }) =>
					session.status !== 'waiting' && (['working', 'ready'].includes(session.status) || session.unseen > 0),
			);
			const above = narrowed() || scope ? new Set() : new Set([...asking, ...going].map(({ session }) => session.id));
			const asked = {
				...(state.query && { q: state.query }),
				...(state.filter && { filter: state.filter }),
				...(scope && { project: scope.project }),
			};
			const byProject = !scope && !narrowed() && prefs.groupBy === 'project';
			const listed = byProject ? { sessions: [], total: 0 } : await sessionsFrom(gathered, asked, state.count, above);
			const projects = byProject
				? gathered
						.flatMap(({ server, projects: found }) => (found ?? []).map(project => ({ ...project, server })))
						.sort(byWatchedThenRecent)
				: [];
			const previews = {};

			if (byProject)
				await Promise.all(
					projects.map(async project => {
						const key = projectKey(project);

						if (!(prefs.openProjects[key] ?? (project.watching || project.liveCount))) return;

						const query = new URLSearchParams({ project: project.name, limit: String(PREVIEW) });
						const { items } = await serverPage(project.server, `/api/sessions?${query}`).catch(() => ({ items: [] }));

						previews[key] = { sessions: items.map(session => ({ server: project.server, session })) };
					}),
				);

			if (ask !== loading) return;

			data = {
				gathered,
				watched,
				rows: [
					...gathered
						.filter(({ error }) => error)
						.map(({ server, error }) => ({ kind: 'note', text: `${server.label}: ${printable(error)}` })),
					...browserRows({
						project: scope?.project,
						narrowed: narrowed(),
						filter: state.filter,
						groupBy: prefs.groupBy,
						asking: scope ? [] : asking,
						going: scope ? [] : going,
						...listed,
						projects,
						previews,
						opened: prefs.openProjects,
					}),
				],
			};
			draw();
		};

		const draw = () => {
			const { cols, rows: height } = size();
			const several = !scope && data.gathered.length > 1;
			const chips = FILTERS.map(name =>
				name === state.filter ? inverse(` ${FILTER_LABELS[name]} `) : ` ${dim(FILTER_LABELS[name])} `,
			).join('');
			const grouping = scope || narrowed() ? '' : dim(`  by ${prefs.groupBy}`);
			const header = [
				`${bold(scope ? `paude · ${scope.project}` : 'paude')}  ${scope ? dim(scope.server.label) : summaryOf(data.watched)}`,
				`${chips}${grouping}${picked.size ? `  ${orange(`${picked.size} picked`)}` : ''}`,
				state.typing || state.query ? `${orange('/')} ${printable(state.query)}${state.typing ? '█' : ''}` : '',
			];
			const footer = [state.message ? colored(state.message, 179) : '', ...HINTS.map(hint => dim(fit(hint, cols - 1)))];
			const room = Math.max(height - header.length - footer.length - 1, 3);
			const at = current();
			const index = Math.max(data.rows.indexOf(at), 0);
			const start = Math.max(0, Math.min(index - Math.floor(room / 2), data.rows.length - room));
			const context = { several, picked, cols: cols - 1 };
			const body = data.rows.slice(start, start + room).map(row => {
				const line = lineOf(row, context);

				return row === at && !state.typing ? inverse(fit(line, cols - 1)) : line;
			});

			write(
				`${CLEAR}${[...header, ...body, ...Array(Math.max(room - body.length, 0)).fill(''), ...footer].join('\r\n')}`,
			);
		};

		const reload = () => {
			draw();
			load().catch(error => {
				state.message = printable(error.message);
				draw();
			});
		};

		const move = step => {
			const rows = selectable();
			const index = rows.indexOf(current());

			state.cursor = rows[Math.min(Math.max(index + step, 0), rows.length - 1)]?.key ?? null;
		};

		const finish = value => {
			done = true;
			stop();
			clearTimeout(timer);
			process.stdout.off('resize', draw);
			resolve(value);
		};

		// Something that takes the screen (a question, a prompt for a name) has the keys until it's done
		const aside = async work => {
			busy = true;
			stop();
			try {
				await work();
			} catch (error) {
				state.message = printable(error.message);
			}
			busy = false;
			if (done) return;
			stop = rawInput(onKey);
			reload();
		};

		// Each server's own sessions: the picked ones, or the one under the cursor
		const targets = () => {
			const row = current();

			if (picked.size) return [...picked.values()];

			return row?.kind === 'session' ? [row] : [];
		};

		const perServer = async (rows, act) => {
			const answers = await Promise.allSettled(rows.map(row => act(row)));
			const failed = answers.filter(({ status }) => status === 'rejected');

			if (failed.length)
				throw new Error(`${failed.length} of ${rows.length} didn't go through: ${failed[0].reason?.message}`);
		};

		const watch = rows => {
			const on = !rows.every(({ session }) => session.watching);

			return aside(async () => {
				await perServer(rows, ({ server, session }) =>
					api(server, `/api/sessions/${session.id}/watch`, { method: 'PUT', body: JSON.stringify({ watching: on }) }),
				);
				state.message = `${on ? 'Watching' : 'Stopped watching'} ${counted(rows.length, 'session')}`;
				state.undo = () => watch(rows.map(row => ({ ...row, session: { ...row.session, watching: on } })));
				picked.clear();
			});
		};

		const archive = (rows, on = !rows.every(({ session }) => session.archived)) => {
			const stopped = rows.filter(({ session }) => !session.live);

			if (!stopped.length) {
				state.message = "Running sessions aren't archived: they're in use";

				return draw();
			}

			return aside(async () => {
				const byServer = Map.groupBy(stopped, ({ server }) => server);

				await perServer([...byServer], ([server, group]) =>
					api(server, '/api/sessions/archive', {
						method: 'POST',
						body: JSON.stringify({ ids: group.map(({ session }) => session.id), archived: on }),
					}),
				);
				state.message = `${on ? 'Archived' : 'Unarchived'} ${counted(stopped.length, 'session')}${stopped.length < rows.length ? " (running ones aren't)" : ''}`;
				state.undo = () => archive(stopped, !on);
				picked.clear();
			});
		};

		const rename = row =>
			aside(async () => {
				const name = await askLine({
					title: 'Rename',
					subtitle: dim(printable(row.session.title)),
					prompt: 'Name:',
					initial: printable(row.session.title),
					hint: 'enter save (empty: back to the automatic name) · esc back',
				});

				if (name === null) return;
				await api(row.server, `/api/sessions/${row.session.id}/name`, {
					method: 'PUT',
					body: JSON.stringify({ name }),
				});
				state.message = name ? `Renamed to ${name}` : 'Back to the automatic name';
			});

		const remove = rows =>
			aside(async () => {
				const sure = await choose({
					title: `Delete ${rows.length === 1 ? printable(rows[0].session.title) : counted(rows.length, 'session')}?`,
					subtitle: colored('cannot be undone', 179),
					hint: '↑↓ move · enter pick · esc keep',
					rows: [
						...wrap(
							'Their conversations, chat and comments are removed, and anyone invited loses access.',
							size().cols - 4,
						).map(text => ({ note: text })),
						{ label: 'Keep', value: 'keep' },
						{ label: `Delete ${counted(rows.length, 'session')}`, value: 'delete' },
					],
				});

				if (sure !== 'delete') return;
				await perServer(rows, ({ server, session }) =>
					api(server, `/api/sessions/${session.id}`, { method: 'DELETE' }),
				);
				state.message = `Deleted ${counted(rows.length, 'session')}`;
				state.undo = null;
				picked.clear();
			});

		const watchProject = ({ project }) =>
			aside(async () => {
				await api(project.server, `/api/projects/${encodeURIComponent(project.name)}/watch`, {
					method: 'PUT',
					body: JSON.stringify({ watching: !project.watching }),
				});
				state.message = `${project.watching ? 'Stopped watching' : 'Watching'} every session in ${project.name}`;
			});

		const openProject = (row, open) => {
			prefs.openProjects = { ...prefs.openProjects, [row.key]: open };
			savePrefs({ ...loadedPrefs, pickerOpenProjects: prefs.openProjects }).catch(() => {});
			reload();
		};

		const enter = row => {
			if (!row) return;
			if (row.kind === 'session') {
				const { identity } = data.gathered.find(({ server }) => server === row.server) ?? scope;

				return finish({ server: row.server, id: row.session.id, identity });
			}
			if (row.kind === 'more') {
				state.count += PAGE;

				return reload();
			}
			if (row.kind === 'new')
				return aside(async () => {
					const id = await newSession(scope.server, scope.project);

					if (id) finish({ server: scope.server, id, identity: scope.identity });
				});
			if (row.kind === 'project') {
				const { identity } = data.gathered.find(({ server }) => server === row.project.server);

				return aside(async () => {
					const opened = await browse({ scope: { server: row.project.server, identity, project: row.project.name } });

					if (opened) finish(opened);
				});
			}
		};

		const typed = key => {
			for (const character of key) {
				if (is(character, 'enter')) state.typing = false;
				else if (character === '\x7f' || character === '\b') state.query = state.query.slice(0, -1);
				else state.query += printable(character);
			}
			state.count = PAGE;
			clearTimeout(timer);
			timer = setTimeout(reload, SEARCH_DELAY_MS);
			draw();
		};

		const onKey = key => {
			if (busy) return;
			// Keys typed quickly, or pasted, can arrive together: each one counts
			if (!state.typing && !key.startsWith(ESC) && [...key].length > 1) {
				for (const single of key) onKey(single);

				return;
			}
			state.message = '';

			if (state.typing) {
				if (key === ESC) {
					state.typing = false;
					state.query = '';

					return reload();
				}
				if (is(key, 'down') && !/^[jk]$/.test(key)) state.typing = false;
				else if (key === '\x03') return finish(null);
				else if (!key.startsWith(ESC)) return typed(key);

				return draw();
			}

			const row = current();

			if (is(key, 'up')) move(-1);
			else if (is(key, 'down')) move(1);
			else if (is(key, 'enter')) return enter(row);
			else if (key === '/') state.typing = true;
			else if (key === KEY.tab || key === KEY.backTab) {
				const step = key === KEY.tab ? 1 : FILTERS.length - 1;

				state.filter = FILTERS[(FILTERS.indexOf(state.filter) + step) % FILTERS.length];
				state.count = PAGE;

				return reload();
			} else if (key === 'g' && !scope) {
				prefs.groupBy = prefs.groupBy === 'day' ? 'project' : 'day';
				savePrefs({ ...loadedPrefs, pickerGroupBy: prefs.groupBy }).catch(() => {});

				return reload();
			} else if (key === ' ' && row?.kind === 'session') {
				if (picked.has(row.key)) picked.delete(row.key);
				else picked.set(row.key, row);
				move(1);
			} else if (key === 'w' && row?.kind === 'project') return watchProject(row);
			else if (key === 'w' && targets().length) return watch(targets());
			else if (key === 'a' && targets().length) return archive(targets());
			else if (key === 'r' && row?.kind === 'session' && !picked.size) return rename(row);
			else if (key === 'd' && targets().length) return remove(targets());
			else if (key === 'u' && state.undo) {
				const undo = state.undo;

				state.undo = null;

				return undo();
			} else if (KEY.right.includes(key) && row?.kind === 'project' && !row.open) return openProject(row, true);
			else if (KEY.left.includes(key) && row?.kind === 'project' && row.open) return openProject(row, false);
			else if (key === ESC && (state.query || picked.size)) {
				picked.clear();
				state.query = '';

				return reload();
			} else if (is(key, 'back')) return finish(null);

			draw();
		};

		let loadedPrefs = {};

		loadPrefs().then(stored => {
			loadedPrefs = stored;
			prefs.groupBy = stored.pickerGroupBy === 'project' ? 'project' : 'day';
			prefs.openProjects = stored.pickerOpenProjects ?? {};
			stop = rawInput(onKey);
			process.stdout.on('resize', draw);
			reload();
		});
	});

// A new session in a project, worktree and all: its id, or null when given up
const newSession = async (server, project) => {
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

const pickSession = async servers => {
	write(ENTER_ALT_SCREEN);

	try {
		return await browse({ servers });
	} finally {
		write(LEAVE_ALT_SCREEN);
	}
};

export default pickSession;
