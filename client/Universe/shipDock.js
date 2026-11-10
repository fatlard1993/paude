import { Notify } from '@vanilla-bean/components';
import { relativeTime } from '@vanilla-bean/components/utils/date';

import {
	addFolder,
	connectRemote,
	getProjectArtifacts,
	getCabinetPlay,
	getProjectLinks,
	getProjectSessions,
	getProjects,
	getRecentSessions,
	getRemoteSessions,
	markProjectLink,
	setProjectWatching,
	setRemoteWatching,
	remoteBase,
} from '../api';
import { button, element } from '../dom';
import { sessionCard } from '../Layout';
import SessionBrowser from '../SessionBrowser';
import { bulkActions, sessionMenu } from '../sessionActions';
import mergedPages from '../../shared/mergedPages';
import { matchesFilter } from '../../shared/sessionSearch';
import ArtifactsPanel from '../Terminal/ArtifactsPanel';
import LinksPanel from '../Terminal/LinksPanel';
import { PANELS } from '../Terminal/panels';
import { copyWithNotice } from '../Terminal/copySelection';
import { heading } from './replyCard';

// A dock of panes for something bigger than a session (a project, the whole ship): the same frame as a session's,
// tabs along its top, each pane built the first time it's wanted. `entries` are { key, label, make(body) },
// make answering { elem, refresh? }. `show(key)` switches; `dispose()` lets them go.
// `buttons`: in its head before the close, there whichever pane shows
export const listDock = ({ title, about, entries, open, onClose, buttons = [] }) => {
	const card = element('div', 'dock');
	const tabs = element('div', 'tabs');
	const body = element('div', 'body');
	const panes = new Map();
	let showing;

	const head = heading(title, about, onClose, { close: 'Close', buttons });
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

// What can be done to a session on another paude from here: watched there, or not, as its owner
const remoteSessionMenu = (session, changed) => [
	{ heading: session.title || session.project || 'A new session' },
	{
		label: session.watching ? 'Stop watching' : 'Watch',
		detail: session.watching ? '' : 'Show whether it works, waits or is ready, and what happened since you looked',
		onPress: async () => {
			const { response } = await setRemoteWatching(session.remote.url, session.id, !session.watching);

			if (!response?.ok) return new Notify({ intent: 'danger', content: 'Could not change watching.' });
			changed();
		},
	},
];

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
					menu: () =>
						session.remote
							? remoteSessionMenu(session, () => (browser.reload(), changed?.()))
							: sessionMenu(session, () => browser.reload()),
				}),
			bulk: picked => bulkActions(picked, () => (browser.reload(), changed?.())),
		});

		appendTo.append(elem);

		return { elem, refresh: () => browser.reload() };
	},
});

// Every project to start a session in, newest work first: this paude's started here, the other paudes' started there
// from here (`onStart` with the paude) or opened there; each watched from here, or not, so it comes aboard without a
// session starting. `onWatched` once one is.
export const projectsPane = ({ remotes = [], onStart, onOpenThere, onWatched }) => ({
	key: 'projects',
	label: 'Projects',
	make: appendTo => {
		const elem = element('div', 'pane scrolling projects-list');
		const watchButton = project =>
			button(
				project.watching ? 'Stop watching' : 'Watch',
				async () => {
					const watching = !project.watching;
					const { response } = await setProjectWatching(project.name, watching, project.remote?.url);

					if (!response?.ok)
						return new Notify({ intent: 'danger', content: `Could not change watching ${project.name}.` });
					// The other paude's list was read when it was last visited, so its copy is told
					if (project.remote) project.remote.projects.find(({ name }) => name === project.name).watching = watching;
					await refresh();
					onWatched?.();
				},
				{
					className: 'variant-flat',
					title: project.watching
						? 'It leaves the ship once nothing runs in it'
						: 'It comes aboard, and every session in it is watched, new ones too',
				},
			);
		const row = (project, action) => {
			const { name, sessionCount = 0, lastActivity, server, watching } = project;
			const line = element('div', 'project-row');
			const about = [
				server,
				sessionCount ? `${sessionCount} session${sessionCount === 1 ? '' : 's'}` : 'never worked in',
				lastActivity && relativeTime(lastActivity),
				watching && 'watched',
			]
				.filter(Boolean)
				.join(' · ');
			const actions = element('span', 'actions');

			actions.append(action, watchButton(project));
			const label = element('strong', '', name);

			if (project.icon)
				label.prepend(
					Object.assign(element('img', 'icon'), { src: `${remoteBase(project.remote?.url)}${project.icon}`, alt: '' }),
				);
			line.append(label, element('span', 'about', about), actions);

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
						button('Start a session', () => onStart(project.name, { url: project.remote.url, name: project.server }), {
							className: 'variant-flat',
						}),
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

// A folder on one of `machines` ({ name, url }, url null for this one) added as a project, or each folder in one, and
// watched so it comes aboard now unless that's unticked; `onAdded(names)` once it's done
export const foldersPane = ({ onAdded, machines = [] }) => ({
	key: 'folders',
	label: 'Add a folder',
	make: appendTo => {
		const elem = element('div', 'pane');
		const form = element('form', 'add-folder');
		const machine = element('select', 'where');
		const input = element('input');
		const watch = element('label', 'watch');
		const watching = element('input');
		const add = element('button', '', 'Add');

		machines.forEach(({ name }, index) =>
			machine.append(Object.assign(element('option', '', `On ${name}`), { value: String(index) })),
		);
		machine.title = 'The machine the folder is on';
		machine.hidden = machines.length < 2;
		watching.type = 'checkbox';
		watching.checked = true;
		watch.append(watching, ' Watch it, so it comes aboard now');
		input.placeholder = '~/path/to/it, or ~/path/* for each folder in it';
		form.append(
			element(
				'p',
				'about',
				'A folder on one of your machines becomes a project to start sessions in. It comes aboard, a module on the hull and a deck inside, once you watch it or a session starts there.',
			),
			machine,
			input,
			watch,
			add,
		);
		form.addEventListener('submit', async event => {
			event.preventDefault();
			if (!input.value.trim()) return;

			const on = machines[Number(machine.value)] ?? { name: 'this machine', url: null };
			const { body, response } = await addFolder(input.value.trim(), on.url);

			if (!response?.ok) return new Notify({ intent: 'danger', content: body || 'Could not add that folder.' });

			const { names } = JSON.parse(body);

			if (watching.checked) await Promise.all(names.map(name => setProjectWatching(name, true, on.url)));
			input.value = '';
			new Notify({
				intent: 'success',
				content: `${names.length === 1 ? `Added "${names[0]}"` : `Added ${names.length} projects: ${names.join(', ')}`} on ${on.name}${watching.checked ? ', watched' : ''}`,
				timeout: 4000,
			});
			onAdded(names);
		});
		elem.append(form);
		appendTo.append(elem);

		return { elem, refresh: () => input.focus({ preventScroll: true }) };
	},
});

// A new arcade game on one of `machines` ({ name, url }, url null for this one): what it's called if that's known, the
// idea so far if there is one, for whom, how they read, and made there from the game scaffold with Claude started in
// A mother-hub game from its cabinet in the lounge, to play right here: the game itself in a frame, served through
// paude's preview listener (so over the page's own https)
export const cabinetPane = ({ cabinet }) => ({
	key: 'game',
	label: cabinet.title,
	make: appendTo => {
		const elem = element('div', 'pane cabinet');
		const bar = element('div', 'cabinet-bar');
		const blocked = !cabinet.url || (window.location.protocol === 'https:' && cabinet.url.startsWith('http:'));

		bar.append(
			element('span', 'meta', (!cabinet.running && 'off') || (cabinet.players && `${cabinet.players} playing`) || 'on'),
		);
		elem.append(bar);
		const frame = element('iframe', 'cabinet-game');
		const note = element('p', 'about', `Opening ${cabinet.title}…`);

		frame.allow = 'autoplay; fullscreen';
		elem.append(note);
		// Through paude's own preview listener, over the page's own https, wherever the hub serves it from; straight
		// from the hub where paude can't reach its port and the page allows it
		getCabinetPlay(cabinet.id).then(({ body, response }) => {
			const url = (response?.ok && body?.url) || (!blocked && cabinet.url);

			if (!url) {
				note.textContent = `${cabinet.title} can't be shown here: open it in a tab.`;

				return;
			}
			frame.src = url;
			note.replaceWith(frame);
		});
		appendTo.append(elem);

		return { elem, refresh: () => {} };
	},
});

// Where a cabinet's game opens in a tab of its own: its own address where it has one, else through paude's preview
// listener; null when neither is to be had
export const cabinetAddress = async cabinet => {
	if (cabinet.url) return cabinet.url;

	const { body, response } = await getCabinetPlay(cabinet.id);

	return (response?.ok && body?.url) || null;
};

// A cabinet's game to hand to someone else: each address it's reached at, who can open it there, and a button to copy
// it
export const cabinetSharePane = ({ cabinet }) => ({
	key: 'share',
	label: 'Share',
	make: appendTo => {
		const elem = element('div', 'pane cabinet-share');
		const row = (label, about, url) => {
			const line = element('div', 'address');
			const link = Object.assign(element('a', '', url), { href: url, target: '_blank', rel: 'noopener' });
			const words = element('div', 'words');

			words.append(element('strong', '', label), element('div', 'about', about), link);
			line.append(
				words,
				button('Copy', () => copyWithNotice(url, 'Address copied'), { icon: 'copy', className: 'variant-flat' }),
			);

			return line;
		};
		const refresh = async () => {
			const { body, response } = await getCabinetPlay(cabinet.id);
			const through = response?.ok && body?.url;
			const rows = [
				cabinet.publicUrl && row('Public', 'anyone with the address', cabinet.publicUrl),
				cabinet.lanUrl && row('On this network', 'anyone on the same network as the hub', cabinet.lanUrl),
				through && row('Through this paude', 'whoever is logged in to this paude', through),
			].filter(Boolean);

			elem.replaceChildren(
				...(rows.length
					? rows
					: [element('p', 'about', `${cabinet.title} has no address to share: it isn't being served anywhere.`)]),
			);
		};

		elem.append(element('p', 'about', 'Finding where it can be reached…'));
		appendTo.append(elem);

		return { elem, refresh };
	},
});

// What a project's sessions brought up and made, across all of them
export const projectPanes = project => [
	{
		key: 'links',
		label: PANELS.links.label,
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
		label: PANELS.artifacts.label,
		make: appendTo =>
			new ArtifactsPanel({
				appendTo,
				addClass: 'docked',
				load: () => getProjectArtifacts(project),
				close: () => {},
			}),
	},
];
