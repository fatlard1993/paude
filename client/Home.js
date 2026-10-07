import { Button, Elem, Notify, View, styled } from '@vanilla-bean/components';

import { byRecentActivity, projectSummary } from '../shared/projects';
import byUrgency from '../shared/urgency';
import {
	addFolder,
	deleteSession,
	getProjects,
	getRecentSessions,
	getRemotes,
	getWatching,
	openRemote,
	removeFolder,
} from './api';
import confirmDialog, { confirmDeleteSession } from './confirmDialog';
import { identity } from './identity';
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
		this.recent = sessionList({
			appendTo: scroll,
			placeholder: 'Find a session in any project',
			empty: 'Nothing yet. Pick a project to start a session.',
			fetchPage: async searchParameters => {
				const { body, response } = await getRecentSessions({ searchParameters });

				return { sessions: body ?? [], total: Number(response?.headers.get('x-total-count') ?? 0) };
			},
			renderCard: (session, appendTo) =>
				sessionCard(session, {
					appendTo,
					remove: async () => (await confirmDeleteSession(session, deleteSession)) && this.load(),
				}),
		});

		this.remotes = new Elem({ appendTo: scroll });

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

	remoteCard(session) {
		return {
			server: session.remote.name,
			onOpen: async () => {
				const { body, response } = await openRemote(session.remote.url, session.id);

				if (response?.ok) window.location.href = body.link;
				else new Notify({ type: 'error', content: `Could not reach ${session.remote.name}.` });
			},
		};
	}

	renderRemotes(remotes, watchedIds) {
		this.remotes.empty();

		for (const remote of remotes) {
			const recent = remote.error ? [] : remote.sessions.filter(({ id }) => !watchedIds.has(id));

			// A server whose sessions are all under Watching has nothing more to show
			if (!remote.error && !recent.length) continue;

			new SectionTitle({ appendTo: this.remotes, textContent: `On ${remote.name}` });

			const list = new List({ appendTo: this.remotes });

			if (remote.error) new Empty({ appendTo: list, textContent: `Could not load: ${remote.error}` });
			for (const session of recent)
				sessionCard(session, { appendTo: list, ...this.remoteCard({ ...session, remote }) });
		}
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
		const remove = session => async () => (await confirmDeleteSession(session, deleteSession)) && this.load();

		this.watching.empty();
		this.watchingTitle.elem.style.display = watched.length ? '' : 'none';
		for (const session of watched) {
			sessionCard(session, {
				appendTo: this.watching,
				...(session.remote ? this.remoteCard(session) : { remove: remove(session) }),
			});
		}

		this.renderRemotes(remotes ?? [], new Set(remoteWatched.map(({ id }) => id)));

		// What's under Watching isn't listed again, unless a search asks for it
		this.recent.reload({ exclude: watchedIds });

		this.projects.empty();

		const ordered = [...(projects ?? [])].sort(byRecentActivity);

		for (const project of ordered) {
			LinkCard({
				appendTo: this.projects,
				href: `#/projects/${project.name}`,
				title: project.name,
				meta: [projectSummary(project)],
				live: project.liveCount > 0,
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
