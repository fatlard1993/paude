import { Elem, Notify, View, styled } from '@vanilla-bean/components';

import { runningSummary } from '../shared/checkouts';
import { tintsOf } from '../shared/hues';
import { readProgress, recentLines } from '../shared/progress';
import { LIFETIMES } from '../shared/lifetimes';
import {
	createSession,
	getCheckouts,
	getProjectArtifacts,
	getProjectLinks,
	getProjectSessions,
	getProjects,
	markProjectLink,
	setProjectWatching,
} from './api';
import confirmDialog from './confirmDialog';
import { element } from './dom';
import { Bar, ghostButton } from './Bar';
import { breadcrumbs } from './Breadcrumbs';
import SessionBrowser from './SessionBrowser';
import { bulkActions, sessionMenu } from './sessionActions';
import { Scroll, sessionCard } from './Layout';
import { openMenu } from './menu';
import { Places, composeBox, placePrompt, takeDraft } from './PromptHome';
import LinksPanel from './Terminal/LinksPanel';
import ArtifactsPanel from './Terminal/ArtifactsPanel';
import { tabs } from './Tabs';
import { updateTabTitle } from './tabTitle';

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

export default class Project extends View {
	build() {
		const { project } = this.options;

		this.bar = new Bar({ appendTo: this });
		updateTabTitle({ page: project });
		this.addCleanup('tabTitle', () => updateTabTitle({ page: '' }));
		breadcrumbs({
			appendTo: this.bar,
			current: project,
			project,
			addCleanup: (name, stop) => this.addCleanup(name, stop),
		});
		this.watchButton = ghostButton(this.bar, {
			icon: 'eye-slash',
			label: 'Watch',
			onPress: () => this.toggleWatching(),
		});

		const scroll = new Scroll({ appendTo: this });
		const compose = composeBox({
			appendTo: scroll,
			keep: `paude.prompt.${project}`,
			placeholder: `What should Claude do in ${project}? (or leave empty to just open Claude)`,
			actions: [
				{
					label: 'Find a session for it',
					title: 'Carry it on in a session already going, if one fits',
					onPress: () =>
						placePrompt({
							places: this.places,
							prompt: this.prompt.value.trim(),
							project,
							startFresh: (_, lifetime) => {
								this.pickLifetime(lifetime);
								this.start();
							},
							onSent: () => this.sent(),
						}),
				},
				{ label: 'Start session', onPress: () => this.start() },
			],
		});

		this.prompt = compose.prompt;
		this.sent = compose.sent;
		this.startButton = compose.buttons[1];
		this.startLabel = this.startButton.querySelector('.label');
		this.checkoutChip = element('button', 'chip variant-flat');
		this.newName = Object.assign(element('input', 'chip-name'), { placeholder: 'worktree name (from the prompt)' });
		this.fromInput = Object.assign(element('input', 'chip-name'), {
			placeholder: 'branch, tag, commit or PR (#123)',
		});
		this.lifetimeChip = element('button', 'chip variant-flat');
		this.checkoutChip.style.display = 'none';
		this.newName.style.display = 'none';
		this.fromInput.style.display = 'none';
		this.checkoutChip.addEventListener('click', () => this.openCheckouts());
		this.lifetimeChip.addEventListener('click', () => this.openLifetimes());
		compose.options.append(this.checkoutChip, this.newName, this.fromInput, this.lifetimeChip);
		this.progress = new Progress({ appendTo: scroll, tag: 'pre', style: { display: 'none' } }).elem;
		this.places = new Places({ appendTo: scroll });

		// Brought here from home to start in this project, in place of what was left typed here
		const draft = takeDraft(project);

		if (draft) {
			this.prompt.value = draft.text;
			this.prompt.dispatchEvent(new Event('input'));
		}
		this.pickLifetime(draft?.lifetime);

		this.holdings(scroll);
		this.load();
		this.loadCheckouts();
		this.paint();
	}

	holdings(scroll) {
		const { project } = this.options;
		// What the project holds, one at a time: its sessions, the links they brought up, what they made
		this.tabs = tabs({
			appendTo: scroll,
			key: 'paude.projectTab',
			names: [
				{ name: 'sessions', label: 'Sessions' },
				{ name: 'links', label: 'Links' },
				{ name: 'artifacts', label: 'Artifacts' },
			],
		});

		const sessions = this.tabs.pane('sessions', new Elem({ appendTo: scroll }).elem);

		this.sessions = new SessionBrowser({
			appendTo: sessions,
			key: 'paude.project',
			placeholder: `Find a session in ${project}: its name, first prompt or branch`,
			empty: 'No sessions in this project yet.',
			fetchPage: async searchParameters => {
				const { body, response } = await getProjectSessions(project, { searchParameters });
				const total = Number(response?.headers.get('x-total-count') ?? 0);

				if (!searchParameters.q && !searchParameters.filter) this.tabs.count('sessions', total);

				return { sessions: body ?? [], total };
			},
			renderCard: (session, appendTo, { when } = {}) =>
				sessionCard(session, {
					showProject: false,
					appendTo,
					when,
					menu: () => sessionMenu(session, () => this.load()),
				}),
			bulk: picked => bulkActions(picked, () => this.load()),
		});

		// Every link the project's sessions brought up (docs, tickets, repos, servers), and everything they made; the
		// tab names each, so their own title bars go
		const panel = (Kind, load) =>
			new Kind({
				appendTo: scroll,
				addClass: 'project-links',
				style: { height: 'auto', flexShrink: '0', padding: '0' },
				load,
				mark: (url, change) => markProjectLink(project, url, change),
			});

		this.links = panel(LinksPanel, () => getProjectLinks(project));
		this.artifacts = panel(ArtifactsPanel, () => getProjectArtifacts(project));
		for (const [name, shown] of [
			['links', this.links],
			['artifacts', this.artifacts],
		]) {
			shown.bar.style.display = 'none';
			// Sized by what it holds here, not by the panel's height as at a session's side
			Object.assign(shown.body.style, { flex: '0 1 auto', maxHeight: 'none' });
			this.tabs.pane(name, shown.elem);
		}
		this.countHeld();
		this.tabs.show();
	}

	async countHeld() {
		await Promise.all([this.links.refresh(), this.artifacts.refresh()]);
		this.tabs.count('links', this.links.links.length);
		this.tabs.count('artifacts', this.artifacts.artifacts.length);
	}

	// The bar underlined in the project's folder color, as its card on home is, and the open tab with it
	async paint() {
		const { hue, watching } = (await getProjects()).body?.find(({ name }) => name === this.options.project) ?? {};
		const accent = tintsOf(hue)?.accent;

		this.showWatching(watching);

		if (!accent) return;
		this.bar.elem.classList.add('accented');
		this.elem.style.setProperty('--bar-accent', accent);
	}

	showWatching(watching) {
		this.watching = Boolean(watching);
		this.watchButton.classList.toggle('active', this.watching);
		this.watchButton.firstChild.className = `fa-solid fa-${this.watching ? 'eye' : 'eye-slash'}`;
		this.watchButton.lastChild.textContent = this.watching ? 'Watching' : 'Watch';
		this.watchButton.title = this.watching
			? 'Watching every session here, new ones too. Click to stop watching them all.'
			: 'Not watching. Click to watch every session here, new ones too.';
	}

	async toggleWatching() {
		const { response } = await setProjectWatching(this.options.project, !this.watching);

		if (!response?.ok) return new Notify({ type: 'error', content: 'Could not change watching.' });

		this.showWatching(!this.watching);
		this.load();
	}

	// How long the session lasts, as the session's own bar shows it: as the prompt's router suggested, 'warm' or
	// 'brief', anything else ordinary
	pickLifetime(lifetime) {
		this.lifetime = ['warm', 'brief'].includes(lifetime) ? lifetime : 'ordinary';

		const { icon, label, detail } = LIFETIMES[this.lifetime];

		this.lifetimeChip.replaceChildren(element('i', `fa-solid fa-${icon}`), ` ${label}`);
		this.lifetimeChip.classList.remove('ordinary', 'warm', 'brief');
		this.lifetimeChip.classList.add('lifetime', this.lifetime);
		this.lifetimeChip.title = `How long it lasts: ${label}, ${detail}. Click to change`;
	}

	openLifetimes() {
		openMenu(this.lifetimeChip, [
			{ heading: 'How long the new session lasts' },
			...Object.entries(LIFETIMES).map(([lifetime, { label, detail }]) => ({
				label: lifetime === this.lifetime ? `✓ ${label}` : label,
				detail,
				onPress: () => this.pickLifetime(lifetime),
			})),
		]);
	}

	// Where the session works, asked every time in a git repository: the project folder, a worktree already there, or
	// a new one
	async loadCheckouts() {
		this.checkouts = (await getCheckouts(this.options.project)).body?.checkouts;
		this.checkoutChip.style.display = this.checkouts ? '' : 'none';
		if (!this.checkouts) return this.pickCheckout(undefined);

		const main = this.checkouts.find(checkout => checkout.main);

		this.pickCheckout(main.active ? 'new' : 'main');
	}

	// 'main', 'new', 'from' (a new one on someone's branch or pull request), or 'join:<path>'
	pickCheckout(value) {
		this.checkout = value;
		this.newName.style.display = value === 'new' ? '' : 'none';
		this.fromInput.style.display = value === 'from' ? '' : 'none';
		if (!this.checkouts) return;

		const joined = value?.startsWith('join:') && this.checkouts.find(({ path }) => `join:${path}` === value);
		const main = this.checkouts.find(checkout => checkout.main);
		const label =
			(value === 'new' && 'a new worktree') ||
			(value === 'from' && 'a new worktree from') ||
			(joined && joined.name) ||
			main.branch ||
			'the project folder';

		this.checkoutChip.replaceChildren(element('i', 'fa-solid fa-code-branch'), ` ${label}`);
		this.checkoutChip.title = `Where it works: ${label}. ${runningSummary(this.checkouts)} Click to change`;
	}

	openCheckouts() {
		const running = active => (active ? ` · ${active} running` : '');
		const option = (value, label, detail) => ({
			label: value === this.checkout ? `✓ ${label}` : label,
			detail,
			onPress: () => {
				this.pickCheckout(value);
				if (value === 'new') this.newName.focus();
				if (value === 'from') this.fromInput.focus();
			},
		});
		const main = this.checkouts.find(checkout => checkout.main);

		openMenu(this.checkoutChip, [
			{ heading: runningSummary(this.checkouts) },
			option(
				'main',
				'No worktree',
				`the project folder, on ${main.branch ?? 'a detached HEAD'}${running(main.active)}`,
			),
			...this.checkouts
				.filter(checkout => !checkout.main)
				.map(({ name, path, branch, active }) =>
					option(
						`join:${path}`,
						`Worktree ${name}`,
						`${branch && branch !== name ? `on ${branch}` : 'its own folder'}${running(active)}`,
					),
				),
			option('new', 'A new worktree', 'its own folder and branch, named from the prompt unless you name it'),
			option(
				'from',
				'A new worktree from a branch or PR',
				"someone's branch, a tag, a commit or a pull request, fresh from origin: to review it, or try it",
			),
		]);
	}

	choice() {
		if (this.checkout === 'new') return { create: this.newName.value.trim() };
		if (this.checkout === 'from') return { create: '', from: this.fromInput.value.trim() };
		if (this.checkout?.startsWith('join:')) return { join: this.checkout.slice('join:'.length) };

		return undefined;
	}

	load() {
		return this.sessions.reload();
	}

	async start() {
		const text = this.prompt.value.trim();
		const checkout = this.choice();
		const mode = this.lifetime === 'ordinary' ? undefined : this.lifetime;
		const creating = Boolean(checkout && 'create' in checkout);

		if (this.starting) return;
		if (checkout?.from === '') {
			this.fromInput.focus();

			return new Notify({ type: 'warning', content: 'Name the branch, tag, commit or pull request to start from.' });
		}

		this.starting = true;
		this.startButton.disabled = true;
		this.startLabel.textContent = creating ? 'Making the worktree...' : 'Starting...';

		const result = creating
			? await this.startInNewWorktree(text, checkout, mode)
			: await this.startSession(text, checkout, mode);

		this.starting = false;
		this.startButton.disabled = false;
		this.startLabel.textContent = 'Start session';

		if (result.error) {
			if (checkout?.join) this.loadCheckouts();

			return new Notify({ type: 'error', content: result.error, timeout: 10_000 });
		}

		if (result.files) return this.startAnyway(result, text, mode);

		this.sent();
		window.location.hash = `#/sessions/${result.id}`;
	}

	// A pull request that brings files Claude Code reads on start (hooks it would run among them) is checked out, but
	// Claude starts in it only when asked. Otherwise the worktree stays, picked, to look over and start from later.
	async startAnyway({ worktree, warning }, text, mode) {
		const loading = this.loadCheckouts();
		const confirmed = await confirmDialog({
			header: 'Start Claude in this pull request?',
			body: warning,
			cancelLabel: "Don't start",
			confirmLabel: 'Start anyway',
		});

		await loading;
		if (this.checkouts?.some(({ path }) => path === worktree)) this.pickCheckout(`join:${worktree}`);

		if (!confirmed)
			return new Notify({
				type: 'info',
				content: `Claude wasn't started. The worktree is at ${worktree}; once you've looked, Start session starts Claude there.`,
				timeout: 20_000,
			});

		const started = await this.startSession(text, { join: worktree }, mode);

		if (started.error) return new Notify({ type: 'error', content: started.error, timeout: 10_000 });
		this.sent();
		window.location.hash = `#/sessions/${started.id}`;
	}

	async startSession(text, checkout, mode) {
		const { body, response } = await createSession(this.options.project, text, checkout, mode);

		if (response?.ok) return { id: body.id };
		if (response?.status === 404 && checkout?.join) return { error: 'That worktree is gone; pick again.' };

		const reason = response?.status === 404 ? 'this project folder is gone' : `the server answered ${response?.status}`;

		return { error: `Could not start the session: ${reason}.` };
	}

	// Streamed, so a repo's own setup shows here while it runs
	async startInNewWorktree(text, checkout, mode) {
		const response = await fetch(`/api/projects/${encodeURIComponent(this.options.project)}/sessions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text, checkout, mode }),
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
