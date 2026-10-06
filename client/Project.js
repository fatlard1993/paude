import { Button, Elem, Input, Notify, View, styled } from '@vanilla-bean/components';

import { runningSummary } from '../shared/checkouts';
import { createSession, deleteSession, getCheckouts, getProjectSessions } from './api';
import { confirmDeleteSession } from './confirmDialog';
import { element } from './dom';
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

const Where = styled(
	Elem,
	({ colors }) => `
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 10px 0 4px;

		.summary {
			color: ${colors.light(colors.gray)};
		}

		label {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-start;
			align-items: center;
			gap: 8px;
			padding: 6px 8px;
			border-radius: 6px;
			cursor: pointer;
		}

		label:hover {
			background: ${colors.alpha(colors.white, 0.05)};
		}

		.detail {
			color: ${colors.light(colors.gray)};
		}

		.busy {
			color: ${colors.light(colors.orange)};
		}

		label > span {
			white-space: nowrap;
		}

		input[type='radio'] {
			flex: none;
			width: 16px;
			height: 16px;
			margin: 0;
			padding: 0;
		}

		input[type='text'] {
			flex: 1;
			width: auto;
			min-width: 120px;
			max-width: 320px;
			margin: 0;
		}
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

		this.where = new Where({ appendTo: scroll, style: { display: 'none' } });

		const actions = new Actions({ appendTo: scroll });

		this.startButton = new Button({
			appendTo: actions,
			textContent: 'Start session',
			onPointerPress: () => this.start(),
		});

		new SectionTitle({ appendTo: scroll, textContent: 'Sessions' });
		this.sessions = new Scroll({ appendTo: scroll, style: { padding: 0, overflow: 'visible' } });

		this.load();
		this.loadCheckouts();
	}

	// Asked every time in a git repository
	async loadCheckouts() {
		const checkouts = (await getCheckouts(this.options.project)).body?.checkouts;
		const where = this.where.elem;

		this.choice = () => undefined;
		where.replaceChildren();
		where.style.display = 'none';

		if (!checkouts) return;

		const main = checkouts.find(checkout => checkout.main);
		const option = (value, title, detail, active) => {
			const label = element('label');
			const radio = Object.assign(element('input'), { type: 'radio', name: 'checkout', value });

			radio.checked = value === (main.active ? 'new' : 'main');
			label.append(radio, element('span', '', title));
			if (detail) label.append(element('span', 'detail', detail));
			if (active) label.append(element('span', 'busy', `· ${active} running`));

			return label;
		};
		const newName = Object.assign(element('input'), {
			type: 'text',
			placeholder: 'name (from the prompt when empty)',
		});
		const newOption = option('new', 'A new worktree', '');

		newOption.append(newName);
		newName.addEventListener('focus', () => {
			newOption.querySelector('input[type=radio]').checked = true;
		});

		where.append(
			element('div', 'summary', runningSummary(checkouts)),
			option('main', 'No worktree', `the project folder, on ${main.branch ?? 'a detached HEAD'}`, main.active),
			...checkouts
				.filter(checkout => !checkout.main)
				.map(({ name, branch, active }) =>
					option(`join:${name}`, `Worktree ${name}`, branch && branch !== name ? `on ${branch}` : '', active),
				),
			newOption,
		);
		where.style.display = '';

		this.choice = () => {
			const picked = where.querySelector('input[name=checkout]:checked')?.value;

			if (picked === 'new') return { create: newName.value.trim() };
			if (picked?.startsWith('join:')) return { join: picked.slice('join:'.length) };

			return undefined;
		};
	}

	async load() {
		const { body: sessions } = await getProjectSessions(this.options.project);

		this.sessions.empty();

		if (!sessions?.length) new Empty({ appendTo: this.sessions, textContent: 'No sessions in this project yet.' });

		for (const session of sessions ?? []) {
			sessionCard(session, {
				showProject: false,
				appendTo: this.sessions,
				remove: async () => (await confirmDeleteSession(session, deleteSession)) && this.load(),
			});
		}
	}

	async start() {
		const text = this.prompt.elem.value.trim();

		if (this.starting) return;

		this.starting = true;
		this.startButton.elem.disabled = true;
		this.startButton.elem.textContent = 'Starting...';

		const { body, response } = await createSession(this.options.project, text, this.choice?.());

		this.starting = false;
		this.startButton.elem.disabled = false;
		this.startButton.elem.textContent = 'Start session';

		if (!response?.ok) {
			if (
				response?.status === 400 ||
				(response?.status === 404 && typeof body === 'string' && body.includes('worktree'))
			)
				return new Notify({ type: 'error', content: body });

			const reason =
				response?.status === 404 ? 'this project folder is gone' : `the server answered ${response?.status}`;

			return new Notify({ type: 'error', content: `Could not start the session: ${reason}.` });
		}

		window.location.hash = `#/sessions/${body.id}`;
	}
}
