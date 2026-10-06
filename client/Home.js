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

		this.recentTitle = new SectionTitle({ appendTo: scroll, textContent: 'Continue' });
		this.recent = new List({ appendTo: scroll });

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

		input.placeholder = 'Add a folder as a project: /full/path/to/it';
		button.textContent = 'Add';
		form.elem.append(input, button);
		form.elem.addEventListener('submit', async event => {
			event.preventDefault();
			if (!input.value.trim()) return;

			const { body, response } = await addFolder(input.value.trim());

			if (!response?.ok) return new Notify({ type: 'error', content: body || 'Could not add that folder.' });

			input.value = '';
			new Notify({ type: 'success', content: `Added "${JSON.parse(body).name}"`, timeout: 2000 });
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
		const [{ body: sessions }, { body: projects }, { body: watching }, { body: remotes }] = await Promise.all([
			getRecentSessions(),
			getProjects(),
			getWatching(),
			identity()?.local ? getRemotes() : { body: [] },
		]);
		const reachable = (remotes ?? []).filter(remote => !remote.error);
		const remoteWatched = reachable.flatMap(remote => remote.watching.map(session => ({ ...session, remote })));
		const watched = [...(watching ?? []), ...remoteWatched].sort(byUrgency);
		const watchedIds = new Set(watched.map(({ id }) => id));
		const recent = (sessions ?? []).filter(({ id }) => !watchedIds.has(id));
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

		this.recent.empty();
		// Everything recent may already be listed under Watching
		this.recentTitle.elem.style.display = recent.length || !watched.length ? '' : 'none';

		if (!recent.length && !watched.length)
			new Empty({ appendTo: this.recent, textContent: 'Nothing yet. Pick a project to start a session.' });

		for (const session of recent) {
			sessionCard(session, {
				appendTo: this.recent,
				remove: remove(session),
			});
		}

		this.projects.empty();

		const ordered = [...(projects ?? [])].sort(byRecentActivity);

		for (const project of ordered) {
			LinkCard({
				appendTo: this.projects,
				href: `#/projects/${project.name}`,
				title: project.name,
				meta: [projectSummary(project)],
				live: project.liveCount > 0,
				...(project.registered && {
					removeLabel: `Stop treating ${project.path} as a project (nothing is deleted)`,
					removeIcon: 'folder-minus',
					remove: async () => {
						const confirmed = await confirmDialog({
							header: `Stop treating ${project.name} as a project?`,
							body: `Nothing in ${project.path} is deleted, but its sessions leave these lists and can't be reopened here until you add the folder again.`,
							confirmLabel: 'Remove',
						});

						if (!confirmed) return;
						await removeFolder(project.name);
						this.load();
					},
				}),
			});
		}
	}
}
