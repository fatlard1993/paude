import { Notify } from '@vanilla-bean/components';

import { button, closeButton, element, icon } from '../dom';
import { canNote } from '../identity';
import relativeTime from '../../shared/relativeTime';
import Panel from './GitPanel.styles';

const KINDS = [
	['all', 'All'],
	['docs', 'Docs'],
	['ticket', 'Tickets'],
	['repo', 'Repos'],
	['server', 'Servers'],
	['reference', 'Other'],
];
const DESCRIBING_MS = 4000;
const KIND_ICONS = { docs: 'book', ticket: 'ticket', repo: 'code-branch', server: 'server', reference: 'globe' };

// A link as it reads best: its host and path, without the scheme or a trailing slash
const shortened = url => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

// The links that came up, gathered: docs, tickets, repos, servers and other references, each described (by Haiku,
// from what was said around it; the clearest words said until then) and who brought it up. Pinned ones stay on top; noise can be hidden. What only a command printed
// is left out unless asked for. A session's own, or a project's across its sessions (each link naming the sessions
// it came up in): `load()` and `mark(url, change)` say whose, and `close` gives it a close button.
export default class LinksPanel extends Panel {
	// Set here rather than as class fields: VBC runs build() from its own constructor, before subclass fields exist
	build() {
		this.kind = 'all';
		this.withOutput = false;
		this.links = [];
		this.bar = element('div', 'bar');
		this.filters = element('div', 'tabs links-filters');
		this.search = element('input', 'link-search');
		this.body = element('div', 'body');
		this.search.placeholder = 'Find a link';
		this.search.addEventListener('input', () => this.renderLinks());
		this.bar.append(
			element('span', 'branch', 'Links'),
			element('span', 'spacer'),
			...(this.options.close ? [closeButton(() => this.options.close())] : []),
		);
		this.elem.tabIndex = -1;
		this.elem.append(this.bar, this.filters, this.search, this.body);
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape' || event.target === this.search) return;

			event.stopPropagation();
			this.options.close();
		});
	}

	async refresh() {
		const { body, response } = await this.options.load();

		if (!response?.ok) {
			this.body.replaceChildren(element('div', 'empty', 'Could not gather the links.'));

			return;
		}

		this.links = body;
		this.renderLinks();
		// Haiku is still writing some: look again shortly, while the panel is showing
		clearTimeout(this.again);
		if (body.some(link => link.describing))
			this.again = setTimeout(() => this.showing() && this.refresh(), DESCRIBING_MS);
	}

	// On the page, and open when it's a panel that closes
	showing() {
		return this.elem.isConnected && (!this.options.close || this.elem.classList.contains('open'));
	}

	// Mentioned by someone (you, Claude, the chat) or fetched, rather than only printed by a command
	mentioned(link) {
		return this.withOutput || link.pinned || link.by.some(by => by !== 'output');
	}

	renderLinks() {
		const query = this.search.value.trim().toLowerCase();
		const shown = this.links.filter(link => this.mentioned(link));
		const counts = Object.fromEntries(
			KINDS.map(([kind]) => [kind, shown.filter(link => kind === 'all' || link.kind === kind).length]),
		);
		const outputOnly =
			this.links.length - this.links.filter(link => link.pinned || link.by.some(by => by !== 'output')).length;

		this.filters.replaceChildren(
			...KINDS.filter(([kind]) => kind === 'all' || counts[kind]).map(([kind, label]) => {
				const filter = button(`${label} ${counts[kind]}`, () => {
					this.kind = kind;
					this.renderLinks();
				});

				filter.classList.toggle('active', kind === this.kind);

				return filter;
			}),
		);

		const list = shown.filter(
			link =>
				(this.kind === 'all' || link.kind === this.kind) &&
				(!query || [link.url, link.title, link.description, link.context].some(text => text?.toLowerCase().includes(query))),
		);
		const toggle = button(
			this.withOutput ? 'Leave out what only commands printed' : `Include what only commands printed (${outputOnly})`,
			() => {
				this.withOutput = !this.withOutput;
				this.renderLinks();
			},
			{ className: 'more' },
		);

		this.body.replaceChildren(
			...(list.length ? list.map(link => this.row(link)) : [element('div', 'empty', 'No links yet.')]),
			...(outputOnly ? [toggle] : []),
		);
	}

	row(link) {
		const row = element('div', `link${link.pinned ? ' pinned' : ''}`);
		const head = element('div', 'link-head');
		const anchor = element('a', 'name', link.title || shortened(link.url));
		const who = [...new Set(link.by.map(by => (by === 'output' ? 'a command' : by)))].join(', ');

		Object.assign(anchor, { href: link.url, target: '_blank', rel: 'noopener noreferrer', title: link.url });
		head.append(icon(KIND_ICONS[link.kind]), anchor);
		head.append(
			button(
				'',
				async () => {
					await navigator.clipboard.writeText(link.url).catch(() => null);
					new Notify({ type: 'success', content: 'Link copied', timeout: 1500 });
				},
				{ icon: 'copy', title: 'Copy it', className: 'icon-only' },
			),
		);
		if (canNote())
			head.append(
				button('', () => this.mark(link, { pinned: !link.pinned }), {
					icon: 'thumbtack',
					title: link.pinned ? 'Unpin it' : 'Pin it to the top',
					className: `icon-only${link.pinned ? ' on' : ''}`,
				}),
				button('', () => this.mark(link, { hidden: true }), {
					icon: 'eye-slash',
					title: 'Hide it: noise',
					className: 'icon-only',
				}),
			);

		row.append(
			head,
			...(link.title ? [element('div', 'link-address', shortened(link.url))] : []),
			...this.describe(link),
			...(link.sessions ? [this.sessionsOf(link)] : []),
			element(
				'div',
				'meta',
				[who, link.count > 1 && `${link.count}×`, link.lastAt && relativeTime(Date.parse(link.lastAt))]
					.filter(Boolean)
					.join(' · '),
			),
		);

		return row;
	}

	// What Haiku wrote of it; until then, the clearest thing said about it
	describe(link) {
		if (link.description) return [element('div', 'link-context', link.description)];

		return link.context ? [this.contextOf(link)] : [];
	}

	// The clearest thing said about it, and who said it
	contextOf(link) {
		const line = element('div', 'link-context');
		const said = { you: 'You', fetched: 'Read for' }[link.contextBy] ?? link.contextBy;

		line.append(element('span', 'said-by', `${said}: `), link.context);

		return line;
	}

	// Where in the project it came up: the sessions, to open
	sessionsOf(link) {
		const line = element('div', 'meta link-sessions', 'in ');

		link.sessions.slice(0, 3).forEach((session, index) => {
			const open = element('a', '', session.title || 'a session');

			open.href = `#/sessions/${session.id}`;
			line.append(...(index ? [', '] : []), open);
		});
		if (link.sessions.length > 3) line.append(` and ${link.sessions.length - 3} more`);

		return line;
	}

	async mark(link, change) {
		await this.options.mark(link.url, change);
		await this.refresh();
	}
}
