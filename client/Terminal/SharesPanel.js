import { Notify } from '@vanilla-bean/components';

import { addShare, getShares, renameShare, stopShare } from '../api';
import { nameDialog } from '../confirmDialog';
import { button, closeButton, element, icon } from '../dom';
import { canType } from '../identity';
import Panel from './GitPanel.styles';

const KIND_ICONS = { port: 'plug', file: 'file-arrow-down', folder: 'file-zipper', site: 'globe' };

const labelOf = share => {
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
		const open = element('a', 'name', labelOf(share));
		const copy = button(
			'',
			async () => {
				await navigator.clipboard.writeText(share.url).catch(() => null);
				new Notify({ type: 'success', content: 'Link copied', timeout: 1500 });
			},
			{ icon: 'link', title: 'Copy the link', className: 'icon-only' },
		);

		open.href = share.url;
		open.target = '_blank';
		open.rel = 'noopener';
		open.title = share.url;
		row.append(icon(KIND_ICONS[share.kind]), open, copy);
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
