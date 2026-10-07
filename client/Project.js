import { Button, Elem, Input, Notify, View, styled } from '@vanilla-bean/components';

import { runningSummary } from '../shared/checkouts';
import { readProgress, recentLines } from '../shared/progress';
import { createSession, deleteSession, getCheckouts, getProjectSessions } from './api';
import { confirmDeleteSession } from './confirmDialog';
import { element } from './dom';
import goBack from './goBack';
import sessionList from './SessionList';
import { Header, Scroll, SectionTitle, sessionCard } from './Layout';

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

// The repo's own create command, as it runs
const Progress = styled(
	Elem,
	({ colors }) => `
		max-height: 14em;
		overflow: auto;
		margin: 6px 0;
		padding: 8px 10px;
		border-radius: 6px;
		background: ${colors.alpha(colors.black, 0.35)};
		font-size: 0.85em;
		white-space: pre-wrap;
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

		const back = new Button({ appendTo: header, icon: 'arrow-left', attributes: { title: 'Back' } });

		// On click, not press: navigating on press leaves the click to land on whatever card is now under the finger
		back.elem.addEventListener('click', () => goBack('#/'));
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
		this.progress = new Progress({ appendTo: scroll, tag: 'pre', style: { display: 'none' } }).elem;

		const actions = new Actions({ appendTo: scroll });

		this.startButton = new Button({
			appendTo: actions,
			textContent: 'Start session',
			onPointerPress: () => this.start(),
		});

		new SectionTitle({ appendTo: scroll, textContent: 'Sessions' });
		this.sessions = sessionList({
			appendTo: scroll,
			placeholder: `Find a session in ${project}`,
			empty: 'No sessions in this project yet.',
			firstPage: 30,
			fetchPage: async searchParameters => {
				const { body, response } = await getProjectSessions(project, { searchParameters });

				return { sessions: body ?? [], total: Number(response?.headers.get('x-total-count') ?? 0) };
			},
			renderCard: (session, appendTo) =>
				sessionCard(session, {
					showProject: false,
					appendTo,
					remove: async () => (await confirmDeleteSession(session, deleteSession)) && this.load(),
				}),
		});

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
				.map(({ name, path, branch, active }) =>
					option(`join:${path}`, `Worktree ${name}`, branch && branch !== name ? `on ${branch}` : '', active),
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

	load() {
		return this.sessions.reload();
	}

	async start() {
		const text = this.prompt.elem.value.trim();
		const checkout = this.choice?.();
		const creating = Boolean(checkout && 'create' in checkout);

		if (this.starting) return;

		this.starting = true;
		this.startButton.elem.disabled = true;
		this.startButton.elem.textContent = creating ? 'Making the worktree...' : 'Starting...';

		const result = creating ? await this.startInNewWorktree(text, checkout) : await this.startSession(text, checkout);

		this.starting = false;
		this.startButton.elem.disabled = false;
		this.startButton.elem.textContent = 'Start session';

		if (result.error) {
			if (checkout?.join) this.loadCheckouts();

			return new Notify({ type: 'error', content: result.error, timeout: 10_000 });
		}

		window.location.hash = `#/sessions/${result.id}`;
	}

	async startSession(text, checkout) {
		const { body, response } = await createSession(this.options.project, text, checkout);

		if (response?.ok) return { id: body.id };
		if (response?.status === 404 && checkout?.join) return { error: 'That worktree is gone; pick again.' };

		const reason = response?.status === 404 ? 'this project folder is gone' : `the server answered ${response?.status}`;

		return { error: `Could not start the session: ${reason}.` };
	}

	// Streamed, so a repo's own setup shows here while it runs
	async startInNewWorktree(text, checkout) {
		const response = await fetch(`/api/projects/${encodeURIComponent(this.options.project)}/sessions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text, checkout }),
		}).catch(() => null);

		if (!response) return { error: 'Could not reach the server.' };
		if (!response.ok) return { error: await response.text() };

		let output = '';

		this.progress.textContent = '';
		this.progress.style.display = '';

		return readProgress(response, arrived => {
			output += arrived;
			this.progress.textContent = recentLines(output, 12).join('\n');
			this.progress.scrollTop = this.progress.scrollHeight;
		});
	}
}
