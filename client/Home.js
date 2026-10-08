import { Button, Elem, Notify, View, styled } from '@vanilla-bean/components';

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
import sessionList from './SessionList';
import { Empty, Header, LinkCard, Scroll, SectionTitle, sessionCard } from './Layout';

const Grid = styled.Component`
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	gap: 8px;
`;

const AddFolder = styled(
	Elem,
	({ colors }) => `
		display: flex;
		gap: 6px;
		margin-top: 8px;

		input {
			flex: 1;
			font-family: ui-monospace, monospace;
		}

		.hint {
			color: ${colors.gray};
			font-size: 0.85em;
			align-self: center;
		}
	`,
);

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
		new Header(
			{ appendTo: this },
			new Elem({ addClass: 'title', textContent: 'paude' }),
			new Button({ textContent: 'Log out', onPointerPress: () => this.logout() }),
		);

		const scroll = new Scroll({ appendTo: this });

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
		this.addFolderForm(scroll);

		this.load();
	}

	addFolderForm(appendTo) {
		const form = new AddFolder({ appendTo, tag: 'form' });
		const input = document.createElement('input');
		const button = document.createElement('button');

		input.placeholder = 'Add a folder as a project: ~/path/to/it, or ~/path/* for each folder in it';
		button.textContent = 'Add';
		form.elem.append(input, button);
		form.elem.addEventListener('submit', async event => {
			event.preventDefault();
			if (!input.value.trim()) return;

			const { body, response } = await addFolder(input.value.trim());

			if (!response?.ok) return new Notify({ type: 'error', content: body || 'Could not add that folder.' });

			const { names } = JSON.parse(body);

			input.value = '';
			new Notify({
				type: 'success',
				content: names.length === 1 ? `Added "${names[0]}"` : `Added ${names.length} projects: ${names.join(', ')}`,
				timeout: 4000,
			});
			this.load();
		});
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

	// Every card names its server, this one's too, so sessions from several read as one list
	card(session, appendTo) {
		return sessionCard(session, {
			appendTo,
			...(session.remote
				? this.remoteCard(session)
				: {
						server: hereName(),
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
		const remoteWatched = reachable.flatMap(remote => remote.watching.map(session => ({ ...session, remote })));
		const watched = [...(watching ?? []), ...remoteWatched].sort(byUrgency);
		const watchedIds = new Set(watched.map(({ id }) => id));

		this.watching.empty();
		this.watchingTitle.elem.style.display = watched.length ? '' : 'none';
		for (const session of watched) this.card(session, this.watching);

		this.unreachable.empty();
		for (const remote of (remotes ?? []).filter(({ error }) => error))
			new Empty({ appendTo: this.unreachable, textContent: `${remote.name}: ${remote.error}` });

		// What's under Watching isn't listed again, unless a search asks for it
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
				server: hereName(),
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
	}
}
