import { Notify } from '@vanilla-bean/components';

import relativeTime from '../../shared/relativeTime';
import { button, closeButton, element, icon } from '../dom';
import Panel from './GitPanel.styles';

const KINDS = [
	['all', 'All'],
	['image', 'Images'],
	['page', 'Pages'],
	['script', 'Scripts'],
	['data', 'Data'],
	['doc', 'Docs'],
	['media', 'Media'],
	['archive', 'Archives'],
];
const KIND_ICONS = {
	image: 'image',
	page: 'window-maximize',
	script: 'scroll',
	data: 'table',
	doc: 'file-lines',
	media: 'film',
	archive: 'box-archive',
};
const MADE_BY = {
	written: 'Claude wrote it',
	viewed: 'Claude looked at it',
	command: 'a command made it',
	output: 'a command made it',
};

const sizeOf = bytes =>
	bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

export const artifactUrl = (sessionId, file, { download = false } = {}) =>
	`/api/sessions/${encodeURIComponent(sessionId)}/artifact?path=${encodeURIComponent(file)}${download ? '&download=1' : ''}`;

// The things sessions made along the way, wherever they landed (a scratchpad, /tmp, an ignored folder): screenshots,
// pages, scripts, data. Each opens as it is (a page in a sandbox), and says what it was for and when it was made. A
// session's own, or a project's across its sessions (each naming the session that made it): `load()` says whose,
// and `close` gives it a close button.
export default class ArtifactsPanel extends Panel {
	// Set here rather than as class fields: VBC runs build() from its own constructor, before subclass fields exist
	build() {
		this.kind = 'all';
		this.artifacts = [];
		this.bar = element('div', 'bar');
		this.filters = element('div', 'tabs links-filters');
		this.search = element('input', 'link-search');
		this.body = element('div', 'body');
		this.search.placeholder = 'Find something made here';
		this.search.addEventListener('input', () => this.renderArtifacts());
		this.bar.append(
			element('span', 'branch', 'Artifacts'),
			element('span', 'spacer'),
			...(this.options.close ? [closeButton(() => this.options.close())] : []),
		);
		this.elem.tabIndex = -1;
		this.elem.append(this.bar, this.filters, this.search, this.body);
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape' || event.target === this.search || !this.options.close) return;

			event.stopPropagation();
			this.options.close();
		});
	}

	async refresh() {
		const { body, response } = await this.options.load();

		if (!response?.ok) {
			this.body.replaceChildren(element('div', 'empty', 'Could not gather what was made.'));

			return;
		}

		this.artifacts = body;
		this.renderArtifacts();
	}

	renderArtifacts() {
		const query = this.search.value.trim().toLowerCase();
		const counts = Object.fromEntries(
			KINDS.map(([kind]) => [kind, this.artifacts.filter(made => kind === 'all' || made.kind === kind).length]),
		);

		this.filters.replaceChildren(
			...KINDS.filter(([kind]) => kind === 'all' || counts[kind]).map(([kind, label]) => {
				const filter = button(`${label} ${counts[kind]}`, () => {
					this.kind = kind;
					this.renderArtifacts();
				});

				filter.classList.toggle('active', kind === this.kind);

				return filter;
			}),
		);

		const list = this.artifacts.filter(
			made =>
				(this.kind === 'all' || made.kind === this.kind) &&
				(!query || [made.path, made.why, made.turn].some(text => text?.toLowerCase().includes(query))),
		);

		this.body.replaceChildren(
			...(list.length
				? list.map(made => this.row(made))
				: [element('div', 'empty', 'Nothing made here yet: screenshots, pages and scripts show up as they are.')]),
		);
	}

	row(made) {
		const sessionId = made.session?.id ?? this.options.sessionId;
		const url = artifactUrl(sessionId, made.path);
		const row = element('div', 'link artifact');
		const head = element('div', 'link-head');
		const open = element('a', 'name', made.name);

		Object.assign(open, { href: url, target: '_blank', rel: 'noopener noreferrer', title: made.path });
		head.append(
			icon(KIND_ICONS[made.kind] ?? 'file'),
			open,
			button(
				'',
				async () => {
					await navigator.clipboard.writeText(made.path).catch(() => null);
					new Notify({ type: 'success', content: 'Path copied', timeout: 1500 });
				},
				{ icon: 'copy', title: 'Copy its path', className: 'icon-only' },
			),
		);

		const download = element('a', 'icon-only download');

		Object.assign(download, { href: artifactUrl(sessionId, made.path, { download: true }), title: 'Download it' });
		download.append(icon('download'));
		head.append(download);
		row.append(head);

		if (made.kind === 'image') {
			const preview = element('a', 'artifact-preview');
			const image = element('img');

			Object.assign(preview, { href: url, target: '_blank', rel: 'noopener noreferrer' });
			Object.assign(image, { src: url, loading: 'lazy', alt: made.name });
			preview.append(image);
			row.append(preview);
		}

		row.append(
			element('div', 'link-address', made.shown ?? made.path),
			...(made.why || made.turn ? [element('div', 'link-context', made.why || `While: ${made.turn}`)] : []),
			...(made.session ? [this.sessionOf(made.session)] : []),
			element(
				'div',
				'meta',
				[MADE_BY[made.by], sizeOf(made.size), relativeTime(made.modifiedAt)].filter(Boolean).join(' · '),
			),
		);

		return row;
	}

	sessionOf(session) {
		const line = element('div', 'meta link-sessions', 'in ');
		const open = element('a', '', session.title || 'a session');

		open.href = `#/sessions/${session.id}`;
		line.append(open);

		return line;
	}
}
