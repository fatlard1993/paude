import { Notify, Tabs } from '@vanilla-bean/components';

import { relativeTime } from '@vanilla-bean/components/utils/date';
import { getGit, getVerification, runGit, sessionOf } from '../api';
import confirmDialog from '../confirmDialog';
import { button, closeButton, element, icon } from '../dom';
import { checkbox } from '../Layout';
import { canType } from '../identity';
import Panel from './GitPanel.styles';

const STATUS_LETTERS = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', untracked: 'U' };
const TABS = [
	['changes', 'Changes'],
	['history', 'History'],
	['review', 'Review'],
	['branches', 'Branches'],
	['stashes', 'Stashes'],
];
// Uncommitted files named before opening a pull request; the rest are counted
const NAMED_FILES = 4;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const IN_PROGRESS = {
	merging: 'A merge is half done.',
	rebasing: 'A rebase is half done.',
	'cherry-picking': 'A cherry-pick is half done.',
};

const iconButton = (name, title, onPress, className = '') =>
	button('', onPress, { icon: name, title, className: `icon-only ${className}` });

// git in the session's checkout: its state, history, branches and stashes, and the everyday actions as buttons.
// Reading takes the files role; the buttons that change anything, the typing role. Diffs open in the files panel.
export default class GitPanel extends Panel {
	// Set here rather than as class fields: VBC runs build() from its own constructor, before subclass fields exist
	build() {
		this.tab = 'changes';
		this.history = [];
		this.status = null;

		this.bar = element('div', 'bar');
		this.output = element('div', 'output');
		// Each tab reads afresh, the open one too: the checkout may have changed by hand, or by Claude, since
		this.tabStrip = new Tabs({
			addClass: 'tabs',
			tabs: TABS.map(([id, label]) => ({ id, label })),
			onChange: ({ value }) => {
				this.tab = value;
				this.refresh();
			},
		});
		this.tabs = this.tabStrip.elem;
		this.tabs.addEventListener(
			'click',
			event => event.target.closest('[aria-selected="true"]') && this.refresh(),
			true,
		);
		this.body = element('div', 'body');
		this.elem.tabIndex = -1;
		this.elem.append(this.bar, this.output, this.tabs, this.body);
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape' || event.target.matches('textarea, input')) return;

			event.stopPropagation();
			this.options.close();
		});
	}

	async refresh() {
		const { body, response } = await getGit(this.options.place, 'status');

		if (!response?.ok) {
			this.status = null;
			this.bar.replaceChildren(
				element('span', 'branch', 'git'),
				closeButton(() => this.options.close()),
			);
			this.tabs.style.display = 'none';
			this.body.replaceChildren(
				element('div', 'empty', typeof body === 'string' && body ? body : 'Could not read git here.'),
			);

			return;
		}

		this.status = body;
		this.tabs.style.display = '';
		this.renderBar();
		await this.showTab(this.tab);
	}

	renderBar() {
		const { repository, branch, detached, upstream, ahead, behind, inProgress } = this.status;
		const where = element('button', 'branch', detached ? 'detached HEAD' : branch);

		where.title = upstream ? `Tracking ${upstream}` : 'Not tracking a remote branch';
		where.addEventListener('click', () => this.showTab('branches'));

		const tracking = element(
			'span',
			'tracking',
			[ahead && `↑${ahead}`, behind && `↓${behind}`].filter(Boolean).join(' '),
		);
		const actions = canType()
			? [
					iconButton('rotate', 'Fetch: see what the remotes have', () => this.act('fetch')),
					iconButton('arrow-down', 'Pull: bring in the remote branch (fast-forward only)', () => this.act('pull')),
					iconButton('arrow-up', upstream ? `Push to ${upstream}` : 'Push, tracking origin', () => this.act('push')),
				]
			: [];

		this.bar.replaceChildren(
			element('span', 'repository', repository),
			where,
			tracking,
			element('span', 'spacer'),
			...actions,
			closeButton(() => this.options.close()),
		);
		this.tabStrip.count('changes', this.changeCount());
		this.tabStrip.count('stashes', this.status.stashes);
		this.output.classList.toggle('shown', Boolean(inProgress));
		if (inProgress) {
			this.say(`${IN_PROGRESS[inProgress]} Settle the conflicts below, then carry on; or give it up.`, { error: true });
			if (canType())
				this.output.querySelector('pre').after(
					button('Continue', () => this.act('continue', {}, { done: 'Carried on' })),
					button('Abort', () => this.act('abort', {}, { done: 'Given up' }), { className: 'danger' }),
				);
		}
	}

	changeCount() {
		const { staged, unstaged, untracked, conflicted } = this.status;

		return staged.length + unstaged.length + untracked.length + conflicted.length;
	}

	async showTab(tab) {
		this.tab = tab;
		this.tabStrip.options.selected = tab;

		if (!this.status) return;
		if (tab === 'changes') return this.renderChanges();
		if (tab === 'history') return this.renderHistory();
		if (tab === 'branches') return this.renderBranches();
		if (tab === 'review') return this.renderReview();

		return this.renderStashes();
	}

	// What git said, kept in view to read; a refusal stays until dismissed
	say(text, { error = false } = {}) {
		const dismiss = iconButton('xmark', 'Dismiss', () => this.output.classList.remove('shown'));

		this.output.replaceChildren(element('pre', '', text), dismiss);
		this.output.classList.toggle('error', error);
		this.output.classList.add('shown');
	}

	// onSuccess runs before the panel is drawn again, so what it changes is drawn
	async act(action, body = {}, { done, onSuccess } = {}) {
		this.elem.classList.add('busy');

		const { body: result, response } = await runGit(this.options.place, action, body);

		this.elem.classList.remove('busy');

		if (!response?.ok || !result?.ok) {
			this.say(result?.output || (typeof result === 'string' && result) || `git ${action} failed`, { error: true });
		} else {
			onSuccess?.();
			this.output.classList.remove('shown');
			new Notify({ intent: 'success', content: done ?? (result.output.split('\n').at(-1) || 'Done'), timeout: 2500 });
		}

		await this.refresh();
		this.options.changed?.();

		return result?.ok;
	}

	fileRow(file, controls) {
		const row = element('div', 'file');
		const name = element('button', 'path variant-flat', file.from ? `${file.from} → ${file.path}` : file.path);

		name.title = 'Show the change';
		name.addEventListener('click', () => this.options.openDiff({ source: 'changes', path: file.here ?? file.path }));
		row.append(element('span', `status ${file.status}`, STATUS_LETTERS[file.status] ?? ''), name, ...controls);

		return row;
	}

	section(title, files, { all, each }) {
		if (!files.length) return [];

		const head = element('div', 'section-head');

		head.append(element('span', '', `${title} ${files.length}`), ...(all && canType() ? [all] : []));

		return [head, ...files.map(file => this.fileRow(file, canType() ? each(file) : []))];
	}

	async renderChanges() {
		const { body: stack } = await getGit(this.options.place, 'stack');

		if (this.tab !== 'changes') return;

		const concerns = stack?.concerns ?? [];
		const { staged, unstaged, untracked, conflicted } = this.status;
		const discard = async file => {
			const confirmed = await confirmDialog({
				header: `Discard ${file.path}?`,
				body:
					file.status === 'untracked'
						? 'The file is deleted. It was never committed, so git cannot bring it back.'
						: 'Its changes since the last commit are lost. Staged changes stay.',
				confirmLabel: 'Discard',
			});

			if (confirmed) this.act('discard', { paths: [file.path] }, { done: `Discarded ${file.path}` });
		};
		const nodes = [
			...this.section('Conflicts', conflicted, {
				each: file => [
					button(
						'Mine',
						() => this.act('resolve', { path: file.path, side: 'ours' }, { done: `Kept yours of ${file.path}` }),
						{
							title: "Keep this branch's version",
						},
					),
					button(
						'Theirs',
						() => this.act('resolve', { path: file.path, side: 'theirs' }, { done: `Kept theirs of ${file.path}` }),
						{ title: 'Keep the incoming version' },
					),
					iconButton('plus', 'Mark it resolved as it is now (after editing it)', () =>
						this.act('stage', { paths: [file.path] }),
					),
				],
			}),
			...this.section('Staged', staged, {
				all: button('Unstage all', () => this.act('unstage', { all: true })),
				each: file => [iconButton('minus', 'Unstage', () => this.act('unstage', { paths: [file.path] }))],
			}),
			...this.section('Changes', [...unstaged, ...untracked], {
				all: button('Stage all', () => this.act('stage', { all: true })),
				each: file => [
					iconButton('plus', 'Stage', () => this.act('stage', { paths: [file.path] })),
					iconButton('rotate-left', 'Discard', () => discard(file), 'danger'),
				],
			}),
		];

		if (!nodes.length) nodes.push(element('div', 'empty', 'Nothing changed since the last commit.'));
		if (canType()) nodes.push(this.commitBox(concerns));
		nodes.push(...this.stackNodes(concerns));

		this.body.replaceChildren(...nodes);
	}

	// The commits not pushed, each a concern with what was filed into it; settling folds those in, ready to push
	stackNodes(concerns) {
		if (!concerns.length) return [];

		const folds = concerns.reduce((count, concern) => count + concern.folds.length, 0);
		const head = element('div', 'section-head');

		head.append(element('span', '', `Not pushed ${concerns.length}`));
		if (folds && canType()) {
			const settle = button('Settle', () => this.act('settle', {}, { done: 'Settled' }));

			settle.title = `Fold ${plural(folds, 'filed change')} into ${concerns.length === 1 ? 'its concern' : 'their concerns'}, ready to push`;
			head.append(settle);
		}

		return [
			head,
			...concerns.map(concern => {
				const row = element('button', 'history-item variant-flat');

				row.title = 'Show this commit';
				row.append(
					element('div', 'subject', concern.subject),
					...(concern.body ? [element('div', 'meta stack-body', concern.body)] : []),
					element(
						'div',
						'meta',
						[concern.short, concern.folds.length && `${plural(concern.folds.length, 'change')} to fold in`]
							.filter(Boolean)
							.join(' · '),
					),
				);
				row.addEventListener('click', () => this.options.openDiff({ source: 'commit', ref: concern.hash }));

				return row;
			}),
		];
	}

	commitBox(concerns = []) {
		const box = element('div', 'commit-box');
		const options = element('div', 'commit-options');
		const message = element('textarea');
		const amend = element('label', 'amend');
		const amending = checkbox(false);
		// Into a concern not pushed yet: the change, or only the reasoning, folded into it at settling
		const into = element('select', 'into');
		const intoConcern = () => concerns.find(concern => concern.hash === into.value);
		const commit = button('Commit', async () => {
			const target = intoConcern();
			const done = amending.checked ? 'Amended' : 'Committed';
			await this.act(
				'commit',
				{ message: message.value, amend: !target && amending.checked, into: target?.hash },
				{ done: target ? `Filed into ${target.short}` : done, onSuccess: () => (this.draft = '') },
			);
		});

		for (const [value, label] of [
			['', 'A commit of its own'],
			...concerns.map(concern => [concern.hash, `Into ${concern.short} ${concern.subject}`]),
		])
			into.append(Object.assign(element('option', '', label), { value }));
		into.title = 'File it into a commit not pushed yet, with the whole message that commit will have';
		into.hidden = !concerns.length;
		into.addEventListener('change', () => {
			const target = intoConcern();

			amend.hidden = Boolean(target) || !this.status.hasCommits;
			commit.disabled = !target && !this.status.staged.length && !this.status.hasCommits;
			// The message it will have starts from the one it has
			if (target && (!message.value.trim() || message.value === this.filled)) {
				message.value = [target.subject, target.body].filter(Boolean).join('\n\n');
				this.filled = message.value;
				this.draft = message.value;
			}
		});

		message.placeholder = 'Commit message';
		message.rows = 3;
		message.value = this.draft ?? '';
		message.addEventListener('input', () => (this.draft = message.value));
		// Ctrl/Cmd+Enter commits, as in an editor's commit box
		message.addEventListener('keydown', event => {
			if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) commit.click();
		});
		amend.append(amending, ' Amend the last commit');
		amend.hidden = !this.status.hasCommits;
		commit.classList.add('primary');
		commit.disabled = !this.status.staged.length && !this.status.hasCommits;
		// Claude reads what's staged and writes the message in the repository's style; it's only filled in, to edit
		const write = button(
			'Claude, write it',
			async () => {
				write.disabled = true;
				write.textContent = 'Writing…';

				const { body } = await runGit(this.options.place, 'message', {
					amend: amending.checked,
					into: intoConcern()?.hash,
				});

				write.disabled = false;
				write.textContent = 'Claude, write it';
				if (!body?.ok) return this.say(body?.output ?? 'Claude could not write one.', { error: true });

				message.value = body.message;
				this.draft = body.message;
				message.focus();
			},
			{
				title:
					'Claude reads the staged changes, and the conversation that made them, and writes a message for you to edit',
			},
		);

		write.disabled = !this.status.staged.length;
		options.append(amend, write, commit);
		box.append(into, message, options);

		return box;
	}

	async renderHistory({ more = false } = {}) {
		const { body } = await getGit(this.options.place, 'log', { skip: more ? this.history.length : 0 });

		this.history = more ? [...this.history, ...(body ?? [])] : (body ?? []);
		if (this.tab !== 'history') return;

		const rows = this.history.map(commit => {
			const row = element('button', 'history-item variant-flat');
			const refs = element('span', 'refs');

			for (const ref of commit.refs) refs.append(element('span', 'ref', ref.replace('HEAD -> ', '')));
			row.title = 'Show this commit';
			row.append(
				element('div', 'subject', commit.subject),
				element('div', 'meta', `${commit.short} · ${commit.author} · ${relativeTime(Date.parse(commit.date))}`),
				refs,
			);
			row.addEventListener('click', () => this.options.openDiff({ source: 'commit', ref: commit.hash }));

			return row;
		});

		if (!rows.length) rows.push(element('div', 'empty', 'No commits yet.'));
		if (body?.length === 50)
			rows.push(button('Older commits', () => this.renderHistory({ more: true }), { className: 'more' }));
		this.body.replaceChildren(...rows);
	}

	// What this branch adds to the main line, and its pull request: opened here, its checks watched here
	async renderReview() {
		const [compare, pr, reviewed, checked, ready] = await Promise.all([
			getGit(this.options.place, 'compare'),
			getGit(this.options.place, 'pr'),
			getGit(this.options.place, 'reviewed'),
			sessionOf(this.options.place) ? getVerification(this.options.place) : { response: null },
			getGit(this.options.place, 'ready'),
		]);
		const uncommitted = ready.response?.ok ? ready.body.uncommitted.length : 0;

		// The comments' way to the pull request shows once one is found, made here or since they were opened
		if (pr.body?.number) this.options.pullRequestFound?.(pr.body);
		if (this.tab !== 'review') return;

		const nodes = [
			...(checked.response?.ok && checked.body
				? [element('div', `verdict ${checked.body.state}`, checked.body.said)]
				: []),
			...this.reviewedNodes(reviewed.body),
		];

		if (compare.response?.ok) {
			const { base, commits } = compare.body;
			const head = element(
				'div',
				'section-head',
				`${commits.length} commit${commits.length === 1 ? '' : 's'} beyond ${base}${uncommitted ? `, and ${plural(uncommitted, 'file')} not committed` : ''}`,
			);

			// The work not committed reads with the rest, as what the branch would propose once it is
			if (commits.length || uncommitted)
				head.append(button('Show the changes', () => this.options.openDiff({ source: 'compare' })));
			nodes.push(
				head,
				...commits.map(commit => element('div', 'meta review-commit', `${commit.short} ${commit.subject}`)),
			);
		} else
			nodes.push(element('div', 'empty', typeof compare.body === 'string' ? compare.body : 'Nothing to compare with.'));

		nodes.push(
			element('div', 'section-head', 'Pull request'),
			...this.pullRequestNodes(pr.body, compare.body?.commits?.length, ready.response?.ok ? ready.body : null),
		);
		this.body.replaceChildren(...nodes);
	}

	// How far you've reviewed this branch, wherever you did it: what came since, and marking it read up to here
	reviewedNodes(state) {
		if (!state?.branch || !state.head) return [];

		const short = commit => commit.slice(0, 7);
		const head = element('div', 'section-head', 'Your review');
		const mark = button(`Reviewed up to ${short(state.head)}`, async () => {
			mark.disabled = true;

			const { body } = await runGit(this.options.place, 'reviewed');

			if (!body?.ok) return this.say('Could not mark it.', { error: true });
			this.renderReview();
		});
		const since = label => button(label, () => this.options.openDiff({ source: 'since', ref: state.commit }));
		const when = state.at && `${short(state.commit)}, ${relativeTime(state.at)}`;
		let line;

		mark.title = "Remember that you've read it up to what's checked out now; next time, see only what comes after";

		if (!state.commit) line = element('div', 'meta', `You haven't marked ${state.branch} reviewed yet.`);
		else if (state.missing)
			line = element('div', 'meta', `You reviewed up to ${when}, but that commit isn't here. Fetch, or read it whole.`);
		else if (state.rewritten) {
			line = element('div', 'meta', `Rewritten since you reviewed up to ${when} (a rebase or a force push).`);
			head.append(since('Show how it differs'));
		} else if (state.count) {
			line = element(
				'div',
				'meta',
				`${state.count} commit${state.count === 1 ? '' : 's'} since you reviewed up to ${when}.`,
			);
			head.append(since("Show what's new"));
		} else line = element('div', 'meta', `Reviewed up to ${when}: nothing new since.`);

		if (state.commit !== state.head) head.append(mark);

		return [head, line];
	}

	checkLine(check) {
		const passed = ['success', 'neutral', 'skipped'].includes(check.state);
		const failed = ['failure', 'error', 'cancelled', 'timed_out', 'action_required'].includes(check.state);
		const state = (passed && 'ok') || (failed && 'failed') || 'running';
		const line = element('div', 'branch-row check');

		line.append(
			icon({ ok: 'circle-check', failed: 'circle-xmark', running: 'circle-dot' }[state]),
			element('span', `name outcome ${state}`, check.name),
		);
		if (check.url) line.addEventListener('click', () => window.open(check.url, '_blank', 'noopener'));

		return line;
	}

	pullRequestNodes(pr, ahead, ready) {
		if (pr?.unavailable) return [element('div', 'empty', pr.unavailable)];

		if (pr) {
			const row = element('div', 'branch-row share');
			const link = element('a', 'name', `#${pr.number} ${pr.title}`);
			const state = pr.isDraft ? 'draft' : pr.state.toLowerCase();

			Object.assign(link, { href: pr.url, target: '_blank', rel: 'noopener' });
			row.append(link, element('span', `meta outcome ${state === 'open' ? 'ok' : ''}`, state));

			return [
				row,
				...(pr.checks.length
					? pr.checks.map(check => this.checkLine(check))
					: [element('div', 'empty', 'No checks reported.')]),
				button('Refresh', () => this.renderReview(), { className: 'more' }),
			];
		}

		if (!ahead)
			return [
				element(
					'div',
					'empty',
					ready?.uncommitted.length
						? 'Nothing committed on this branch to propose yet; commit what you have first.'
						: 'Nothing on this branch to propose yet.',
				),
			];
		if (!canType()) return [element('div', 'empty', 'None open for this branch.')];

		return [...this.readyNodes(ready), this.pullRequestForm()];
	}

	// What to know before proposing it, each a line marked done or not, with a way to see to what isn't: work not
	// committed (left out of the pull request), comments still open, and tests not passing since the last change
	readyNodes(ready) {
		if (!ready) return [];

		const line = (done, text, action) => {
			const row = element('div', `ready-item ${done ? 'done' : 'todo'}`);

			row.append(icon(done ? 'circle-check' : 'circle-exclamation'), element('span', 'text', text));
			if (!done && action) row.append(action);

			return row;
		};
		const { uncommitted, comments, tests } = ready;
		const named = uncommitted.slice(0, NAMED_FILES).join(', ') + (uncommitted.length > NAMED_FILES ? ', …' : '');

		return [
			element('div', 'meta', 'Before you open it'),
			line(
				!uncommitted.length,
				uncommitted.length
					? `${plural(uncommitted.length, 'file')} changed and not committed, which it leaves out: ${named}`
					: 'Everything is committed.',
				button('Commit', () => this.showTab('changes')),
			),
			// Comments and test runs are a session's; a project's page has neither to tell
			...(sessionOf(this.options.place)
				? [
						line(
							!comments,
							comments ? `${plural(comments, 'comment')} still open.` : 'No comments open.',
							this.options.showComments && button('Show them', () => this.options.showComments()),
						),
						line(!tests || tests.state === 'current', tests?.said ?? 'No changes or test runs in this session.'),
					]
				: []),
		];
	}

	pullRequestForm() {
		const form = element('div', 'commit-box');
		const title = element('input');
		const body = element('textarea');
		const draft = element('label', 'amend');
		const drafting = checkbox(false);
		const options = element('div', 'commit-options');
		const write = button('Claude, write it', async () => {
			write.disabled = true;
			write.textContent = 'Writing…';

			const { body: written } = await runGit(this.options.place, 'pr-draft');

			write.disabled = false;
			write.textContent = 'Claude, write it';
			if (!written?.ok) return this.say(written?.output ?? 'Claude could not write one.', { error: true });
			title.value = written.title;
			body.value = written.body;
		});
		const open = button(
			'Open it',
			async () => {
				open.disabled = true;

				const { body: opened } = await runGit(this.options.place, 'pr', {
					title: title.value,
					body: body.value,
					draft: drafting.checked,
				});

				open.disabled = false;
				if (!opened?.ok) return this.say(opened?.output ?? 'Could not open it.', { error: true });
				this.renderReview();
			},
			{ className: 'primary' },
		);

		title.placeholder = 'Title';
		body.placeholder = 'What it changes, and why';
		body.rows = 6;
		draft.append(drafting, ' As a draft');
		options.append(draft, write, open);
		form.append(title, body, options);

		return form;
	}

	async renderBranches() {
		const { body } = await getGit(this.options.place, 'branches');

		if (this.tab !== 'branches' || !body) return;

		const nodes = [];

		if (canType()) {
			const form = element('form', 'new-branch');
			const name = element('input');

			name.placeholder = 'New branch from here';
			form.append(
				name,
				button('Create', () => {}, { className: 'primary' }),
			);
			form.addEventListener('submit', event => {
				event.preventDefault();
				if (name.value.trim())
					this.act('createBranch', { name: name.value.trim() }, { done: `On ${name.value.trim()}` });
			});
			nodes.push(form);
		}

		nodes.push(element('div', 'section-head', 'Local'));
		for (const branch of body.local) {
			const row = element('div', `branch-row${branch.name === body.current ? ' current' : ''}`);
			const tracking = [
				branch.ahead && `↑${branch.ahead}`,
				branch.behind && `↓${branch.behind}`,
				branch.gone && 'remote gone',
			]
				.filter(Boolean)
				.join(' ');

			row.append(
				element('span', 'name', branch.name),
				element('span', 'tracking', tracking),
				element('span', 'meta', relativeTime(Date.parse(branch.date))),
			);
			if (canType() && branch.name !== body.current) {
				row.append(
					button('Switch', () => this.act('switch', { branch: branch.name }, { done: `On ${branch.name}` })),
					iconButton(
						'trash-can',
						'Delete (only once its work is merged)',
						async () => {
							const confirmed = await confirmDialog({
								header: `Delete ${branch.name}?`,
								body: 'git keeps it if its commits are not merged anywhere, and says so.',
								confirmLabel: 'Delete',
							});

							if (confirmed) this.act('deleteBranch', { name: branch.name }, { done: `Deleted ${branch.name}` });
						},
						'danger',
					),
				);
			}
			nodes.push(row);
		}

		const remote = body.remote.filter(name => !body.local.some(({ upstream }) => upstream === name));

		if (remote.length) {
			nodes.push(element('div', 'section-head', 'Remote'));
			for (const name of remote) {
				const row = element('div', 'branch-row');
				const local = name.slice(name.indexOf('/') + 1);

				row.append(element('span', 'name', name));
				if (canType())
					row.append(button('Check out', () => this.act('switch', { branch: local }, { done: `On ${local}` })));
				nodes.push(row);
			}
		}

		this.body.replaceChildren(...nodes);
	}

	async renderStashes() {
		const { body } = await getGit(this.options.place, 'stashes');

		if (this.tab !== 'stashes') return;

		const nodes = [];

		if (canType()) {
			const form = element('form', 'new-branch');
			const message = element('input');

			message.placeholder = 'Stash the changes as…';
			form.append(
				message,
				button('Stash', () => {}, { className: 'primary' }),
			);
			form.addEventListener('submit', event => {
				event.preventDefault();
				this.act('stash', { message: message.value.trim() }, { done: 'Stashed' });
			});
			nodes.push(form);
		}

		for (const stash of body ?? []) {
			const row = element('div', 'branch-row');

			row.append(element('span', 'name', stash.subject), element('span', 'meta', relativeTime(Date.parse(stash.date))));
			if (canType())
				row.append(
					button('Apply', () => this.act('unstash', { ref: stash.ref }, { done: 'Applied' })),
					iconButton(
						'trash-can',
						'Drop it',
						async () => {
							if (await confirmDialog({ header: 'Drop this stash?', body: stash.subject, confirmLabel: 'Drop' }))
								this.act('dropStash', { ref: stash.ref }, { done: 'Dropped' });
						},
						'danger',
					),
				);
			nodes.push(row);
		}

		if (!body?.length) nodes.push(element('div', 'empty', 'No stashes.'));
		this.body.replaceChildren(...nodes);
	}
}
