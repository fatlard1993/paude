import { Notify } from '@vanilla-bean/components';
import { relativeTime } from '@vanilla-bean/components/utils/date';

import {
	addFolder,
	connectRemote,
	getProjectArtifacts,
	getProjectLinks,
	getProjectSessions,
	getProjects,
	getRecentSessions,
	getRemoteSessions,
	markProjectLink,
} from '../api';
import { button, element } from '../dom';
import { sessionCard } from '../Layout';
import SessionBrowser from '../SessionBrowser';
import { bulkActions, sessionMenu } from '../sessionActions';
import mergedPages from '../../shared/mergedPages';
import { matchesFilter } from '../../shared/sessionSearch';
import ArtifactsPanel from '../Terminal/ArtifactsPanel';
import LinksPanel from '../Terminal/LinksPanel';
import { heading } from './replyCard';
import { LOCAL, hiddenNow, shipsAssigned } from './shown';

// A dock of panes for something bigger than a session (a project, the whole ship): the same frame as a session's,
// tabs along its top, each pane built the first time it's wanted. `entries` are { key, label, make(body) },
// make answering { elem, refresh? }. `show(key)` switches; `dispose()` lets them go.
export const listDock = ({ title, about, entries, open, onClose }) => {
	const card = element('div', 'dock');
	const tabs = element('div', 'tabs');
	const body = element('div', 'body');
	const panes = new Map();
	let showing;

	const head = heading(title, about, onClose, { close: 'Close' });
	for (const { key, label } of entries) {
		const tab = button(label, () => card.show(key), { className: 'variant-flat' });

		tab.dataset.verb = key;
		tabs.append(tab);
	}
	card.append(head, tabs, body);
	// Escape closes it, unless what has the keyboard used it (a search box clearing itself, say)
	card.addEventListener('keydown', event => {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		if (event.target.matches?.('input[type="search"]') && event.target.value) return;

		event.stopPropagation();
		onClose();
	});

	card.show = key => {
		if (!panes.has(key)) {
			const pane = entries.find(entry => entry.key === key).make(body);

			pane.elem.hidden = true;
			panes.set(key, pane);
		}
		for (const [other, { elem }] of panes) elem.hidden = other !== key;
		for (const tab of tabs.children) tab.classList.toggle('active', tab.dataset.verb === key);
		if (showing !== key) panes.get(key).refresh?.();
		showing = key;

		return panes.get(key);
	};
	card.opened = () => card.show(entries.some(({ key }) => key === open) ? open : entries[0].key);
	card.dispose = () => {
		for (const { elem } of panes.values()) elem.remove();
	};

	return card;
};

// Sessions, newest first, to search and manage as on home: this paude's and `remotes`', or one project's here. A
// session pressed goes to `onPick`, so it's read and woken from the universe.
export const sessionsPane = ({ project, remotes = [], local = true, onPick, changed }) => ({
	key: 'sessions',
	label: 'Sessions',
	make: appendTo => {
		const elem = element('div', 'pane scrolling');
		const fetchLocal = async searchParameters => {
			const { body, response } = project
				? await getProjectSessions(project, { searchParameters })
				: await getRecentSessions({ searchParameters });

			return { sessions: body ?? [], total: Number(response?.headers.get('x-total-count') ?? 0) };
		};
		const fetchRemote = remote => async searchParameters => {
			const { body, response } = await getRemoteSessions(remote.url, { searchParameters });

			if (!response?.ok) return { sessions: [], total: 0 };

			const { filter, q } = searchParameters;

			return {
				sessions: body.filter(session => matchesFilter(session, filter, q)).map(session => ({ ...session, remote })),
				total: Number(response.headers.get('x-total-count') ?? 0),
			};
		};
		const browser = new SessionBrowser({
			appendTo: elem,
			key: project ? 'paude.universe.project' : 'paude.universe',
			placeholder: project
				? `Find a session in ${project}: its name, first prompt or branch`
				: 'Find a session in any project: its name, first prompt, project or branch',
			empty: project ? 'No sessions in this project yet.' : 'No sessions yet.',
			fetchPage: project
				? fetchLocal
				: mergedPages([
						...(local ? [fetchLocal] : []),
						...remotes.filter(({ error }) => !error).map(remote => fetchRemote(remote)),
					]),
			renderCard: (session, cards, { showProject = !project, when } = {}) =>
				sessionCard(session, {
					appendTo: cards,
					showProject,
					when,
					server: session.remote?.name,
					onOpen: () => onPick(session),
					...(session.remote ? {} : { menu: () => sessionMenu(session, () => browser.reload()) }),
				}),
			bulk: picked => bulkActions(picked, () => (browser.reload(), changed?.())),
		});

		appendTo.append(elem);

		return { elem, refresh: () => browser.reload() };
	},
});

// Every project to start a session in, newest work first: this paude's to start here, the other paudes' to open there
export const projectsPane = ({ remotes = [], onStart, onOpenThere }) => ({
	key: 'projects',
	label: 'Projects',
	make: appendTo => {
		const elem = element('div', 'pane scrolling projects-list');
		const row = ({ name, sessionCount = 0, lastActivity, server }, action) => {
			const line = element('div', 'project-row');
			const about = [
				server,
				sessionCount ? `${sessionCount} session${sessionCount === 1 ? '' : 's'}` : 'never worked in',
				lastActivity && relativeTime(lastActivity),
			]
				.filter(Boolean)
				.join(' · ');

			line.append(element('strong', '', name), element('span', 'about', about), action);

			return line;
		};
		const refresh = async () => {
			const { body } = await getProjects();
			const localProjects = [...(body ?? [])].sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
			const remoteProjects = remotes
				.filter(({ error }) => !error)
				.flatMap(remote => (remote.projects ?? []).map(project => ({ ...project, server: remote.name, remote })));

			elem.replaceChildren(
				...localProjects.map(project =>
					row(
						project,
						button('Start a session', () => onStart(project.name), { className: 'variant-flat' }),
					),
				),
				...remoteProjects.map(project =>
					row(
						project,
						button(`Open on ${project.server}`, () => onOpenThere(project.remote, project.name), {
							className: 'variant-flat',
						}),
					),
				),
			);
		};

		appendTo.append(elem);

		return { elem, refresh };
	},
});

// The other paudes this one is logged into, how each is doing, and a form to log into another. `onConnected` once one
// joins.
export const enginesPane = ({ remotes = [], localName, onConnected }) => ({
	key: 'devices',
	label: 'Devices',
	make: appendTo => {
		const elem = element('div', 'pane scrolling devices');
		const list = element('div', 'projects-list');
		const form = element('form', 'add-folder');
		const url = element('input');
		const password = element('input');
		const name = element('input');
		const connect = element('button', '', 'Connect');
		const state = remote =>
			remote.error
				? `out of reach: ${remote.error}`
				: `${(remote.sessions ?? []).length} recent sessions, ${(remote.projects ?? []).length} projects`;

		Object.assign(url, { placeholder: 'Its address: https://paude.example.com', autocomplete: 'off' });
		Object.assign(password, { type: 'password', placeholder: 'Its owner password', autocomplete: 'off' });
		Object.assign(name, { placeholder: 'A name to show it by (optional)', autocomplete: 'off' });
		list.append(
			...[
				{ name: localName, detail: 'this machine' },
				...remotes.map(remote => ({ name: remote.name, detail: state(remote) })),
			].map(engine => {
				const line = element('div', 'project-row');

				line.append(element('strong', '', engine.name), element('span', 'about', engine.detail));

				return line;
			}),
		);
		form.append(
			element(
				'p',
				'about',
				'Another machine running paude joins as an engine once this one is logged into it, as `paude login <url>` does there.',
			),
			url,
			password,
			name,
			connect,
		);
		form.addEventListener('submit', async event => {
			event.preventDefault();
			if (!url.value.trim() || !password.value) return;

			connect.disabled = true;

			const { body, response } = await connectRemote({
				url: url.value.trim(),
				password: password.value,
				name: name.value,
			});

			connect.disabled = false;
			password.value = '';
			if (!response?.ok)
				return new Notify({
					intent: 'danger',
					content: typeof body === 'string' && body ? body : 'Could not connect.',
				});

			const connected = JSON.parse(body);

			new Notify({ intent: 'success', content: `Connected to ${connected.name}`, timeout: 4000 });
			url.value = '';
			name.value = '';
			onConnected(connected);
		});
		elem.append(list, form);
		appendTo.append(elem);

		return { elem, refresh: () => url.focus({ preventScroll: true }) };
	},
});

// A folder added as a project, or each folder in one; `onAdded(names)` once it's done
export const foldersPane = ({ onAdded }) => ({
	key: 'folders',
	label: 'Add a folder',
	make: appendTo => {
		const elem = element('div', 'pane');
		const form = element('form', 'add-folder');
		const input = element('input');
		const add = element('button', '', 'Add');

		input.placeholder = '~/path/to/it, or ~/path/* for each folder in it';
		form.append(
			element(
				'p',
				'about',
				'A folder becomes a project to start sessions in. It comes aboard, a module on the hull and a deck inside, once a session starts there or you watch it.',
			),
			input,
			add,
		);
		form.addEventListener('submit', async event => {
			event.preventDefault();
			if (!input.value.trim()) return;

			const { body, response } = await addFolder(input.value.trim());

			if (!response?.ok) return new Notify({ intent: 'danger', content: body || 'Could not add that folder.' });

			const { names } = JSON.parse(body);

			input.value = '';
			new Notify({
				intent: 'success',
				content: names.length === 1 ? `Added "${names[0]}"` : `Added ${names.length} projects: ${names.join(', ')}`,
				timeout: 4000,
			});
			onAdded(names);
		});
		elem.append(form);
		appendTo.append(elem);

		return { elem, refresh: () => input.focus({ preventScroll: true }) };
	},
});

// What a project's sessions brought up and made, across all of them
export const projectPanes = project => [
	{
		key: 'links',
		label: 'Links',
		make: appendTo =>
			new LinksPanel({
				appendTo,
				addClass: 'docked',
				load: () => getProjectLinks(project),
				mark: (url, change) => markProjectLink(project, url, change),
				close: () => {},
			}),
	},
	{
		key: 'artifacts',
		label: 'Made',
		make: appendTo =>
			new ArtifactsPanel({
				appendTo,
				addClass: 'docked',
				load: () => getProjectArtifacts(project),
				close: () => {},
			}),
	},
];

// Every engine and project, those hidden too, each with its toggle: `answers` returns each engine's last answer,
// unfiltered
export const shownPane = ({ answers, toggle, assign }) => ({
	key: 'shown',
	label: 'Shown',
	make: appendTo => {
		const elem = element('div', 'pane scrolling shown');
		const paint = () => {
			const hidden = hiddenNow();
			const row = (kind, key, name, detail) => {
				const off = (hidden[kind] ?? []).includes(key);
				const line = element('div', `project-row${off ? ' off' : ''}`);

				line.append(
					element('strong', '', name),
					element('span', 'about', detail),
					button(off ? 'Hidden' : 'Shown', () => (toggle(kind, key), paint()), {
						className: off ? 'variant-flat' : '',
						title: off ? `Show ${name}` : `Hide ${name}`,
					}),
				);

				return line;
			};
			const names = [...new Set(answers().flatMap(({ projects = [] }) => projects.map(({ name }) => name)))].sort();

			const engines = element('div', 'projects-list');
			const projects = element('div', 'projects-list');

			// An engine that doesn't say which Claude account it's on: pressed, it steps through sharing another's
			// subscription and having its own
			const ship = answer => {
				const sharing = shipsAssigned()[answer.key] ?? LOCAL;
				const others = answers().filter(({ key }) => key !== answer.key);
				const choices = [...others.map(({ key }) => key), 'own'];
				const next = choices[(choices.indexOf(sharing) + 1) % choices.length];
				const shared = others.find(({ key }) => key === sharing);

				return button(
					shared ? `Same subscription as ${shared.name}` : 'A subscription of its own',
					() => (assign(answer.key, next), paint()),
					{
						className: 'variant-flat',
						title: 'Which subscription it runs on, as it does not say: the ships are one to a subscription',
					},
				);
			};

			engines.append(
				...answers().map(answer => {
					const line = row('engines', answer.key, answer.name, answer.remote ? 'another paude' : 'this machine');

					if (!answer.fuel?.account) line.append(ship(answer));

					return line;
				}),
			);
			projects.append(...names.map(name => row('projects', name, name, '')));
			elem.replaceChildren(element('p', 'about', 'Engines'), engines, element('p', 'about', 'Projects'), projects);
		};

		paint();
		appendTo.append(elem);

		return { elem, refresh: paint };
	},
});
