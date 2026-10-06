import { Button, Elem, Notify, View, styled } from '@vanilla-bean/components';

import { byRecentActivity, projectSummary } from '../shared/projects';
import { addFolder, deleteSession, getProjects, getRecentSessions, getWatching, removeFolder } from './api';
import { confirmDeleteSession } from './confirmDialog';
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

const byUrgency = (a, b) =>
	(b.status === 'waiting') - (a.status === 'waiting') || b.unseen - a.unseen || (b.activeAt ?? 0) - (a.activeAt ?? 0);

const List = styled.Component`
	display: flex;
	flex-direction: column;
	gap: 6px;
`;

export default class Home extends View {
	constructor(options) {
		const refresh = () => this.load();

		super({
			...options,
			onConnected: () => window.addEventListener('focus', refresh),
			onDisconnected: () => window.removeEventListener('focus', refresh),
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

	async logout() {
		await fetch('/api/logout', { method: 'POST' });
		window.location.reload();
	}

	async load() {
		const [{ body: sessions }, { body: projects }, { body: watching }] = await Promise.all([
			getRecentSessions(),
			getProjects(),
			getWatching(),
		]);
		const watched = [...(watching ?? [])].sort(byUrgency);
		const watchedIds = new Set(watched.map(({ id }) => id));
		const recent = (sessions ?? []).filter(({ id }) => !watchedIds.has(id));
		const remove = session => async () => (await confirmDeleteSession(session, deleteSession)) && this.load();

		this.watching.empty();
		this.watchingTitle.elem.style.display = watched.length ? '' : 'none';
		for (const session of watched) sessionCard(session, { appendTo: this.watching, remove: remove(session) });

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
					remove: async () => {
						await removeFolder(project.name);
						this.load();
					},
				}),
			});
		}
	}
}
