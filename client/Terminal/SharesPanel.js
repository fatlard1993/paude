import { addShare, frameShare, getShares, renameShare, sessionRemote, stopShare } from '../api';
import { nameDialog } from '../confirmDialog';
import { button, closeButton, element, icon } from '../dom';
import { canType } from '../identity';
import Panel from './GitPanel.styles';
import { copyWithNotice } from './copySelection';

const KIND_ICONS = { port: 'plug', file: 'file-arrow-down', folder: 'file-zipper', site: 'globe' };

const NAMING_MS = 3000;

// What it is, by what it's running or where it is in the project
const detailOf = share => {
	if (share.kind === 'port')
		return share.auto ? `Port ${share.port} · ${share.command}` : `Port ${share.port}, forwarded`;
	if (share.kind === 'site') return `${share.path}, as a site`;

	return share.kind === 'folder' ? `${share.path}, zipped` : share.path;
};

// What the session shares, at addresses of their own on the preview port: ports its processes listen on (found on
// their own), ports forwarded by hand, files and folders to download, and folders served as sites. Only people
// logged in who can see the session open them.
export default class SharesPanel extends Panel {
	// Set here rather than as class fields: VBC runs build() from its own constructor, before subclass fields exist
	build() {
		this.bar = element('div', 'bar');
		this.output = element('div', 'output');
		this.body = element('div', 'body');
		this.bar.append(
			element('span', 'branch', 'Shared'),
			element('span', 'spacer'),
			closeButton(() => this.options.close()),
		);
		this.elem.tabIndex = -1;
		this.elem.append(this.bar, this.output, this.body);
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape' || event.target.matches('input')) return;

			event.stopPropagation();
			this.options.close();
		});
	}

	async refresh() {
		const { body, response } = await getShares(this.options.sessionId);

		if (!response?.ok) {
			this.body.replaceChildren(element('div', 'empty', 'Could not list what this session shares.'));

			return;
		}

		this.renderShares(body.shares);
		// A service's name is still being found (its page, or Haiku): look again shortly, while the panel shows
		clearTimeout(this.again);
		if (body.shares.some(share => share.naming))
			this.again = setTimeout(() => this.elem.isConnected && !this.elem.hidden && this.refresh(), NAMING_MS);
	}

	// A share on another paude opens on a ticket for one use, since this browser's login is this paude's, not that one's
	async openThere(share) {
		const tab = window.open('', '_blank');
		const { body, response } = await frameShare(this.options.sessionId, share.name).catch(() => ({}));

		if (!response?.ok || !body?.url) {
			tab?.close();

			return this.say(typeof body === 'string' ? body : 'Could not open it there.');
		}
		if (!tab) return window.open(body.url, '_blank', 'noopener');
		tab.opener = null;
		tab.location.href = body.url;
	}

	say(text) {
		this.output.replaceChildren(
			element('pre', '', text),
			button('', () => this.output.classList.remove('shown'), {
				icon: 'xmark',
				title: 'Dismiss',
				className: 'icon-only',
			}),
		);
		this.output.classList.add('error', 'shown');
	}

	row(share) {
		const row = element('div', 'branch-row share');
		const named = share.title ?? (share.kind === 'port' && share.named ? share.name : null);
		const open = element('a', 'name', named ?? detailOf(share));
		const copy = button(
			'',
			async () => {
				await copyWithNotice(share.url, 'Link copied');
			},
			{ icon: 'link', title: 'Copy the link', className: 'icon-only' },
		);

		open.href = share.url;
		open.target = '_blank';
		open.rel = 'noopener';
		open.title = named ? `${detailOf(share)}: ${share.url}` : share.url;
		if (sessionRemote(this.options.sessionId))
			open.addEventListener('click', event => {
				event.preventDefault();
				this.openThere(share);
			});
		row.append(icon(KIND_ICONS[share.kind]), open);
		if (named) row.append(element('span', 'detail', detailOf(share)));
		row.append(copy);
		if (canType())
			row.append(
				button(
					'',
					async () => {
						const name = await nameDialog({
							current: share.name,
							header: 'Name this share',
							placeholder: 'Its address: /s/<name>/',
						});

						if (!name || name === share.name) return;

						const { body, response } = await renameShare(this.options.sessionId, share.id, name);

						if (!response?.ok) this.say(typeof body === 'string' ? body : 'Could not rename it.');
						await this.refresh();
					},
					{ icon: 'pen', title: `Rename it (now /s/${share.name}/)`, className: 'icon-only' },
				),
				button(
					'',
					async () => {
						const { response } = await stopShare(this.options.sessionId, share.id);

						if (!response?.ok) this.say('Could not stop sharing that.');
						await this.refresh();
					},
					{
						icon: 'xmark',
						title: share.auto ? 'Stop sharing it while it listens' : 'Stop sharing it',
						className: 'icon-only danger',
					},
				),
			);

		return row;
	}

	form(placeholder, actions) {
		const form = element('form', 'new-branch');
		const input = element('input');

		input.placeholder = placeholder;
		input.setAttribute('aria-label', placeholder);
		form.append(
			input,
			...actions.map(([label, kind]) => button(label, () => (this.kind = kind), { className: 'primary' })),
		);
		form.addEventListener('submit', async event => {
			event.preventDefault();

			const value = input.value.trim();

			if (!value) return;

			const share = this.kind === 'port' ? { kind: 'port', port: Number(value) } : { kind: this.kind, path: value };
			const { body, response } = await addShare(this.options.sessionId, share);

			if (!response?.ok) return this.say(typeof body === 'string' ? body : 'Could not share that.');

			input.value = '';
			this.output.classList.remove('shown');
			await this.refresh();
		});

		return form;
	}

	renderShares(shares) {
		const ports = shares.filter(({ kind }) => kind === 'port');
		const others = shares.filter(({ kind }) => kind !== 'port');
		const nodes = [element('div', 'section-head', 'Services')];

		nodes.push(
			...(ports.length
				? ports.map(share => this.row(share))
				: [element('div', 'empty', 'Nothing yet. A server this session starts is shared here on its own.')]),
		);
		if (canType()) nodes.push(this.form('Another local port', [['Forward', 'port']]));

		nodes.push(element('div', 'section-head', 'Files and sites'));
		nodes.push(...others.map(share => this.row(share)));
		if (canType())
			nodes.push(
				this.form('Path, e.g. dist', [
					['Download', 'download'],
					['Site', 'site'],
				]),
			);

		this.body.replaceChildren(...nodes);
	}
}
