import { Button, Elem, View, styled } from '@vanilla-bean/components';

import { byRecentActivity, projectSummary } from '../shared/projects';
import { getProjects, getRecentSessions } from './api';
import { Empty, Header, LinkCard, Scroll, SectionTitle, sessionCard } from './Layout';

const Grid = styled.Component`
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	gap: 8px;
`;

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

		new SectionTitle({ appendTo: scroll, textContent: 'Continue' });
		this.recent = new List({ appendTo: scroll });

		new SectionTitle({ appendTo: scroll, textContent: 'Projects' });
		this.projects = new Grid({ appendTo: scroll });

		this.load();
	}

	async logout() {
		await fetch('/api/logout', { method: 'POST' });
		window.location.reload();
	}

	async load() {
		const [{ body: sessions }, { body: projects }] = await Promise.all([getRecentSessions(), getProjects()]);

		this.recent.empty();

		if (!sessions?.length)
			new Empty({ appendTo: this.recent, textContent: 'Nothing yet. Pick a project to start a session.' });

		for (const session of sessions ?? []) sessionCard(session, { appendTo: this.recent });

		this.projects.empty();

		const ordered = [...(projects ?? [])].sort(byRecentActivity);

		for (const project of ordered) {
			LinkCard({
				appendTo: this.projects,
				href: `#/projects/${project.name}`,
				title: project.name,
				meta: [projectSummary(project)],
				live: project.liveCount > 0,
			});
		}
	}
}
