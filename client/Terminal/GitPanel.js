import { Notify } from '@vanilla-bean/components';

import { getGit, runGit } from '../api';
import confirmDialog from '../confirmDialog';
import { button, closeButton, element } from '../dom';
import { canType } from '../identity';
import relativeTime from '../../shared/relativeTime';
import Panel from './GitPanel.styles';

const STATUS_LETTERS = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', untracked: 'U' };
const TABS = [
	['changes', 'Changes'],
	['history', 'History'],
	['branches', 'Branches'],
	['stashes', 'Stashes'],
];
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
		this.tabs = element('div', 'tabs');
		this.body = element('div', 'body');
		this.tabButtons = Object.fromEntries(
			TABS.map(([key, label]) => {
				// Read afresh: the checkout may have changed by hand, or by Claude, since
				const tab = button(label, () => {
					this.tab = key;
					this.refresh();
				});

				this.tabs.append(tab);

				return [key, tab];
			}),
		);
		this.elem.tabIndex = -1;
		this.elem.append(this.bar, this.output, this.tabs, this.body);
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape' || event.target.matches('textarea, input')) return;

			event.stopPropagation();
			this.options.close();
		});
	}

	async refresh() {
		const { body, response } = await getGit(this.options.sessionId, 'status');

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
		const { branch, detached, upstream, ahead, behind, inProgress } = this.status;
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
			where,
			tracking,
			element('span', 'spacer'),
			...actions,
			closeButton(() => this.options.close()),
		);
		this.tabButtons.changes.textContent = `Changes${this.changeCount() ? ` ${this.changeCount()}` : ''}`;
		this.tabButtons.stashes.textContent = `Stashes${this.status.stashes ? ` ${this.status.stashes}` : ''}`;
		this.output.classList.toggle('shown', Boolean(inProgress));
		if (inProgress) this.say(`${IN_PROGRESS[inProgress]} Finish or abort it in the side terminal.`, { error: true });
	}

	changeCount() {
		const { staged, unstaged, untracked, conflicted } = this.status;

		return staged.length + unstaged.length + untracked.length + conflicted.length;
	}

	async showTab(tab) {
		this.tab = tab;
		for (const [key, node] of Object.entries(this.tabButtons)) node.classList.toggle('active', key === tab);

		if (!this.status) return;
		if (tab === 'changes') return this.renderChanges();
		if (tab === 'history') return this.renderHistory();
		if (tab === 'branches') return this.renderBranches();

		return this.renderStashes();
	}

	// What git said, kept in view to read; a refusal stays until dismissed
	say(text, { error = false } = {}) {
		const dismiss = iconButton('xmark', 'Dismiss', () => this.output.classList.remove('shown'));

		this.output.replaceChildren(element('pre', '', text), dismiss);
		this.output.classList.toggle('error', error);
		this.output.classList.add('shown');
	}

	async act(action, body = {}, { done } = {}) {
		this.elem.classList.add('busy');

		const { body: result, response } = await runGit(this.options.sessionId, action, body);

		this.elem.classList.remove('busy');

		if (!response?.ok || !result?.ok) {
			this.say(result?.output || (typeof result === 'string' && result) || `git ${action} failed`, { error: true });
		} else {
			this.output.classList.remove('shown');
			new Notify({ type: 'success', content: done ?? (result.output.split('\n').at(-1) || 'Done'), timeout: 2500 });
		}

		await this.refresh();
		this.options.changed?.();

		return result?.ok;
	}

	fileRow(file, controls) {
		const row = element('div', 'file');
		const name = element('button', 'path', file.from ? `${file.from} → ${file.path}` : file.path);

		name.title = 'Show the change';
		name.addEventListener('click', () => this.options.openDiff({ source: 'changes', path: file.path }));
		row.append(element('span', `status ${file.status}`, STATUS_LETTERS[file.status] ?? ''), name, ...controls);

		return row;
	}

	section(title, files, { all, each }) {
		if (!files.length) return [];

		const head = element('div', 'section-head');

		head.append(element('span', '', `${title} ${files.length}`), ...(all && canType() ? [all] : []));

		return [head, ...files.map(file => this.fileRow(file, canType() ? each(file) : []))];
	}

	renderChanges() {
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
					iconButton('plus', 'Mark it resolved (stage it)', () => this.act('stage', { paths: [file.path] })),
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
		if (canType()) nodes.push(this.commitBox());

		this.body.replaceChildren(...nodes);
	}

	commitBox() {
		const box = element('div', 'commit-box');
		const options = element('div', 'commit-options');
		const message = element('textarea');
		const amend = element('label', 'amend');
		const amending = element('input');
		const commit = button('Commit', async () => {
			const ok = await this.act(
				'commit',
				{ message: message.value, amend: amending.checked },
				{ done: amending.checked ? 'Amended' : 'Committed' },
			);

			if (ok) this.draft = '';
		});

		message.placeholder = 'Commit message';
		message.rows = 3;
		message.value = this.draft ?? '';
		message.addEventListener('input', () => (this.draft = message.value));
		// Ctrl/Cmd+Enter commits, as in an editor's commit box
		message.addEventListener('keydown', event => {
			if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) commit.click();
		});
		amending.type = 'checkbox';
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

				const { body } = await runGit(this.options.sessionId, 'message');

				write.disabled = false;
				write.textContent = 'Claude, write it';
				if (!body?.ok) return this.say(body?.output ?? 'Claude could not write one.', { error: true });

				message.value = body.message;
				this.draft = body.message;
				message.focus();
			},
			{ title: 'Claude reads the staged changes and writes a message for you to edit' },
		);

		write.disabled = !this.status.staged.length;
		options.append(amend, write, commit);
		box.append(message, options);

		return box;
	}

	async renderHistory({ more = false } = {}) {
		const { body } = await getGit(this.options.sessionId, 'log', { skip: more ? this.history.length : 0 });

		this.history = more ? [...this.history, ...(body ?? [])] : (body ?? []);
		if (this.tab !== 'history') return;

		const rows = this.history.map(commit => {
			const row = element('button', 'history-item');
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

	async renderBranches() {
		const { body } = await getGit(this.options.sessionId, 'branches');

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
		const { body } = await getGit(this.options.sessionId, 'stashes');

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
