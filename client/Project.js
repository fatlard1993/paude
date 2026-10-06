import { Button, Elem, Input, Notify, View, styled } from '@vanilla-bean/components';

import { createSession, getProjectSessions } from './api';
import { Empty, Header, Scroll, SectionTitle, sessionCard } from './Layout';

const Composer = styled(
	Input,
	() => `
		width: 100%;
		min-height: 4.5em;
		max-height: 40vh;
		box-sizing: border-box;
	`,
);

const Actions = styled.Component`
	display: flex;
	justify-content: flex-end;
	align-items: center;
	gap: 8px;
`;

export default class Project extends View {
	build() {
		const { project } = this.options;
		const header = new Header({ appendTo: this });

		new Button({ appendTo: header, icon: 'arrow-left', onPointerPress: () => (window.location.hash = '#/') });
		new Elem({ addClass: 'title', appendTo: header, textContent: project });

		const scroll = new Scroll({ appendTo: this });

		this.prompt = new Composer({
			appendTo: scroll,
			tag: 'textarea',
			placeholder: `What should Claude do in ${project}? (or leave empty to just open Claude)`,
			onKeyDown: event => {
				if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
					event.preventDefault();
					this.start();
				}
			},
		});

		const actions = new Actions({ appendTo: scroll });

		this.startButton = new Button({
			appendTo: actions,
			textContent: 'Start session',
			onPointerPress: () => this.start(),
		});

		new SectionTitle({ appendTo: scroll, textContent: 'Sessions' });
		this.sessions = new Scroll({ appendTo: scroll, style: { padding: 0, overflow: 'visible' } });

		this.load();
	}

	async load() {
		const { body: sessions } = await getProjectSessions(this.options.project);

		this.sessions.empty();

		if (!sessions?.length) new Empty({ appendTo: this.sessions, textContent: 'No sessions in this project yet.' });

		for (const session of sessions ?? []) sessionCard(session, { showProject: false, appendTo: this.sessions });
	}

	async start() {
		const text = this.prompt.elem.value.trim();

		if (this.starting) return;

		this.starting = true;
		this.startButton.elem.disabled = true;
		this.startButton.elem.textContent = 'Starting...';

		const { body, response } = await createSession(this.options.project, text);

		this.starting = false;
		this.startButton.elem.disabled = false;
		this.startButton.elem.textContent = 'Start session';

		if (!response?.ok) {
			const reason =
				response?.status === 404 ? 'this project folder is gone' : `the server answered ${response?.status}`;

			return new Notify({ type: 'error', content: `Could not start the session: ${reason}.` });
		}

		window.location.hash = `#/sessions/${body.id}`;
	}
}
