import { Elem, Notify, View, styled } from '@vanilla-bean/components';

import { tintsOf } from '../shared/hues';
import { byRecentActivity, projectSummary } from '../shared/projects';
import mergedPages from '../shared/mergedPages';
import byUrgency from '../shared/urgency';
import {
	addFolder,
	deleteSession,
	getProjects,
	getRecentSessions,
	getRemoteSessions,
	getRemotes,
	getWatching,
	openRemote,
	removeFolder,
} from './api';
import confirmDialog, { confirmDeleteSession } from './confirmDialog';
import { identity, serverName } from './identity';
import { setServers } from './servers';
import sessionList from './SessionList';
import { breadcrumbs } from './Breadcrumbs';
import { button, element } from './dom';
import { Bar, ghostButton } from './Bar';
import { Empty, LinkCard, Scroll, SectionTitle, sessionCard } from './Layout';
import { Places, carryDraft, composeBox, placePrompt } from './PromptHome';

const Grid = styled.Component`
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
	gap: 8px;
`;

// The grid's last card: pressed, it opens across the grid into the folder's path
const AddFolder = styled(
	Elem,
	({ colors }) => `
		display: flex;
		align-items: center;
		min-height: 56px;

		.open-form {
			flex: 1;
			align-self: stretch;
			border: 1px dashed ${colors.alpha(colors.white, 0.18)};
			border-radius: 6px;
			background: transparent;
			color: ${colors.light(colors.gray)};
			font: inherit;
			cursor: pointer;
		}

		.open-form::after {
			display: none;
		}

		.open-form:hover {
			border-color: ${colors.alpha(colors.white, 0.35)};
			color: ${colors.white};
		}

		form {
			flex: 1;
			display: none;
			gap: 6px;
		}

		form input {
			flex: 1;
			min-width: 0;
			font-family: ui-monospace, monospace;
		}

		&.open {
			grid-column: 1 / -1;
		}

		&.open .open-form {
			display: none;
		}

		&.open form {
			display: flex;
		}
	`,
);

// What needs you heads the page, in the color of a session asking
const urgent = { color: 'hsl(38, 80%, 70%)' };

const List = styled.Component`
	display: flex;
	flex-direction: column;
	gap: 6px;
`;

const hereName = () => serverName() ?? 'this machine';

export default class Home extends View {
	constructor(options) {
		const refresh = () => this.load();

		// A cleanup, not onDisconnected: the router destroys the view, and a destroyed view never hears its removal
		super({
			...options,
			onConnected: () => {
				window.addEventListener('focus', refresh);
				this.addCleanup('focus', () => window.removeEventListener('focus', refresh));
			},
		});
	}

	build() {
		const bar = new Bar({ appendTo: this });

		breadcrumbs({ appendTo: bar, addCleanup: (name, stop) => this.addCleanup(name, stop) });
		ghostButton(bar, { icon: 'right-from-bracket', title: 'Log out', onPress: () => this.logout() });

		const scroll = new Scroll({ appendTo: this });

		this.promptBox(scroll);
		this.needsTitle = new SectionTitle({
			appendTo: scroll,
			textContent: 'Needs you',
			style: { ...urgent, display: 'none' },
		});
		this.needs = new List({ appendTo: scroll });
		this.watchingTitle = new SectionTitle({ appendTo: scroll, textContent: 'Watching', style: { display: 'none' } });
		this.watching = new List({ appendTo: scroll });

		new SectionTitle({ appendTo: scroll, textContent: 'Continue' });
		this.unreachable = new List({ appendTo: scroll });
		this.fetchRecent = this.recentFrom([]);
		this.recent = sessionList({
			appendTo: scroll,
			placeholder: 'Find a session in any project',
			empty: 'Nothing yet. Pick a project to start a session.',
			fetchPage: searchParameters => this.fetchRecent(searchParameters),
			renderCard: (session, appendTo) => this.card(session, appendTo),
		});

		new SectionTitle({ appendTo: scroll, textContent: 'Projects' });
		this.projects = new Grid({ appendTo: scroll });
		this.adder = this.addFolderCard();

		this.load();
	}

	// A prompt placed before it's sent: in a conversation it carries on, or a new session in the project that fits
	promptBox(appendTo) {
		const { prompt } = composeBox({
			appendTo,
			placeholder: 'What should Claude do? paude finds the session it carries on, or the project to start one in',
			actions: [{ label: 'Find where it goes', onPress: () => place() }],
		});
		const places = new Places({ appendTo });
		const place = () =>
			placePrompt({
				places,
				prompt: prompt.value.trim(),
				startFresh: (project, lifetime) => carryDraft(project, prompt.value.trim(), lifetime),
			});
	}

	addFolderCard() {
		const card = new AddFolder({});
		const opener = element('button', 'open-form', '+ Add a folder');
		const form = element('form');
		const input = element('input');
		const add = element('button', '', 'Add');
		const close = () => {
			card.elem.classList.remove('open');
			input.value = '';
		};

		input.placeholder = 'A folder to add as a project: ~/path/to/it, or ~/path/* for each folder in it';
		form.append(input, add, button('', close, { icon: 'xmark', title: 'Cancel (Esc)', className: 'icon-only' }));
		card.elem.append(opener, form);
		opener.addEventListener('click', () => {
			card.elem.classList.add('open');
			input.focus();
		});
		input.addEventListener('keydown', event => event.key === 'Escape' && close());
		form.addEventListener('submit', async event => {
			event.preventDefault();
			if (!input.value.trim()) return;

			const { body, response } = await addFolder(input.value.trim());

			if (!response?.ok) return new Notify({ type: 'error', content: body || 'Could not add that folder.' });

			const { names } = JSON.parse(body);

			close();
			new Notify({
				type: 'success',
				content: names.length === 1 ? `Added "${names[0]}"` : `Added ${names.length} projects: ${names.join(', ')}`,
				timeout: 4000,
			});
			this.load();
		});

		return card.elem;
	}

	// Logs this browser in on that server and goes there: { sessionId } or { project }
	async openThere(remote, to) {
		const { body, response } = await openRemote(remote.url, to);

		if (response?.ok) window.location.href = body.link;
		else new Notify({ type: 'error', content: `Could not reach ${remote.name}.` });
	}

	remoteCard(session) {
		return { server: session.remote.name, onOpen: () => this.openThere(session.remote, { sessionId: session.id }) };
	}

	// With other servers in the lists, every card names its server, this one's too, so they read as one list
	card(session, appendTo) {
		return sessionCard(session, {
			appendTo,
			...(session.remote
				? this.remoteCard(session)
				: {
						server: this.otherServers ? hereName() : undefined,
						remove: async () => (await confirmDeleteSession(session, deleteSession)) && this.load(),
					}),
		});
	}

	// This server's sessions and those of the other servers that answered, newest first; one that stops answering
	// partway is left out rather than failing the page
	recentFrom(remotes) {
		const here = async searchParameters => {
			const { body, response } = await getRecentSessions({ searchParameters });

			return { sessions: body ?? [], total: Number(response?.headers.get('x-total-count') ?? 0) };
		};
		const there = remote => async searchParameters => {
			const { body, response } = await getRemoteSessions(remote.url, { searchParameters });

			if (!response?.ok) return { sessions: [], total: 0 };

			return {
				sessions: body.map(session => ({ ...session, remote })),
				total: Number(response.headers.get('x-total-count') ?? 0),
			};
		};

		return mergedPages([here, ...remotes.map(there)]);
	}

	async logout() {
		await fetch('/api/logout', { method: 'POST' });
		window.location.reload();
	}

	async load() {
		const [{ body: projects }, { body: watching }, { body: remotes }] = await Promise.all([
			getProjects(),
			getWatching(),
			identity()?.remotes ? getRemotes() : { body: [] },
		]);
		const reachable = (remotes ?? []).filter(remote => !remote.error);

		if (remotes) setServers(remotes);

		this.otherServers = reachable.length > 0;
		const remoteWatched = reachable.flatMap(remote => remote.watching.map(session => ({ ...session, remote })));
		const watched = [...(watching ?? []), ...remoteWatched].sort(byUrgency);
		const watchedIds = new Set(watched.map(({ id }) => id));
		const asking = watched.filter(({ status }) => status === 'waiting');
		const quiet = watched.filter(({ status }) => status !== 'waiting');

		this.needs.empty();
		this.needsTitle.elem.style.display = asking.length ? '' : 'none';
		for (const session of asking) this.card(session, this.needs);
		this.watching.empty();
		this.watchingTitle.elem.style.display = quiet.length ? '' : 'none';
		for (const session of quiet) this.card(session, this.watching);

		this.unreachable.empty();
		for (const remote of (remotes ?? []).filter(({ error }) => error))
			new Empty({ appendTo: this.unreachable, textContent: `${remote.name}: ${remote.error}` });

		// What's under Needs you and Watching isn't listed again, unless a search asks for it
		this.fetchRecent = this.recentFrom(reachable.map(({ url, name }) => ({ url, name })));
		this.recent.reload({ exclude: watchedIds });

		this.projects.empty();

		const remoteProjects = reachable.flatMap(remote =>
			(remote.projects ?? []).map(project => ({ ...project, remote })),
		);
		const ordered = [...(projects ?? []), ...remoteProjects].sort(byRecentActivity);

		for (const project of ordered) {
			if (project.remote) {
				LinkCard({
					appendTo: this.projects,
					href: '#/',
					title: project.name,
					server: project.remote.name,
					meta: [projectSummary(project)],
					live: project.liveCount > 0,
					accent: tintsOf(project.hue)?.accent,
					onOpen: () => this.openThere(project.remote, { project: project.name }),
				});
				continue;
			}

			LinkCard({
				appendTo: this.projects,
				href: `#/projects/${project.name}`,
				title: project.name,
				server: this.otherServers ? hereName() : undefined,
				meta: [projectSummary(project)],
				live: project.liveCount > 0,
				accent: tintsOf(project.hue)?.accent,
				removeLabel: project.registered
					? `Stop treating ${project.path} as a project (nothing is deleted)`
					: `Hide ${project.name} from the list (nothing is deleted)`,
				removeIcon: 'folder-minus',
				remove: async () => {
					const where = project.path ?? project.name;
					const confirmed = await confirmDialog({
						header: `Take ${project.name} off the list?`,
						body: `Nothing in ${where} is deleted, but its sessions leave these lists and can't be reopened here until you add the folder again.`,
						confirmLabel: 'Remove',
					});

					if (!confirmed) return;
					await removeFolder(project.name);
					this.load();
				},
			});
		}
		this.projects.elem.append(this.adder);
	}
}
