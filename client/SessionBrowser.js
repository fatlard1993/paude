import { Card, Elem, SectionLabel, Tabs, debounce, styled } from '@vanilla-bean/components';

import { relativeTime } from '@vanilla-bean/components/utils/date';
import dayGroup, { DAY_GROUPS, whenIn } from '../shared/dayGroup';
import { button, element } from './dom';
import { Empty, checkbox } from './Layout';
import { contextMenu, openMenu } from './menu';
import { recall, remember } from './storage';

const PAGE_SIZE = 25;
const PROJECT_PREVIEW = 5;
const SEARCH_DELAY_MS = 250;

const FILTERS = [
	{ name: '', label: 'All' },
	{ name: 'running', label: 'Running', title: 'Claude is running in them now' },
	{ name: 'watching', label: 'Watching', title: 'The ones you watch, or whose project you watch' },
	{ name: 'archived', label: 'Archived', title: 'Put away: out of the other lists, still found by a search' },
];

const Box = styled(
	Elem,
	({ colors, radius }) => `
		display: flex;
		flex-direction: column;
		gap: 6px;

		.search {
			width: 100%;
			box-sizing: border-box;
		}

		.toolbar {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 6px;
		}

		.toolbar .spacer {
			flex: 1;
		}

		.summary {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.cards {
			display: flex;
			flex-direction: column;
			gap: 6px;
		}

		.group {
			margin: 10px 0 0;
		}

		.group .count {
			margin-left: 6px;
			opacity: 0.7;
		}

		.more-sessions {
			align-self: center;
			margin-top: 4px;
		}

		/* Picking several: a box on each card, and the card's press picks it */
		.picking a {
			cursor: default;
		}

		.pick {
			flex-shrink: 0;
			margin: 0;
		}

		.bulk {
			position: sticky;
			bottom: 0;
			z-index: 1;
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 6px;
			padding: 8px 10px;
			border-radius: ${radius.md};
			background: ${colors.surface};
			box-shadow: 0 -4px 16px ${colors.alpha(colors.vantablack, 0.4)};
		}

		.bulk .picked {
			flex: 1;
			white-space: nowrap;
		}

		.bulk .danger {
			border-color: ${colors.alpha(colors.red, 0.6)};
			color: ${colors.light(colors.red)};
		}

		.project-group {
			display: flex;
			flex-direction: column;
			gap: 6px;
		}

		.project-head {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-top: 6px;
		}

		.project-head .chevron {
			width: 1em;
			color: ${colors.muted};
		}

		.project-head .name {
			font-weight: bold;
		}

		.project-head .about {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.project-head .running {
			color: ${colors.light(colors.green)};
		}

		.project-head .server {
			padding: 0 6px;
			border-radius: ${radius.lg};
			color: hsl(var(--server-hue) 70% 75%);
			background: hsl(var(--server-hue) 60% 50% / 0.18);
			font-size: 0.85em;
		}

		.project-body {
			display: flex;
			flex-direction: column;
			gap: 6px;
			margin-left: 14px;
		}

		.project-body .all {
			align-self: flex-start;
			font-size: 0.85em;
		}
	`,
);

// The sessions a page lists, made to be scanned and managed. Search looks through all of them; the chips narrow to
// those running, watched or archived; with neither, they're grouped by the day they last changed or, with
// `projects`, by project. Always newest first. A picking mode puts a box on each card for acting on several at once.
//
// fetchPage({ q, filter, offset, limit }) answers { sessions, total }, newest first. renderCard(session, appendTo,
// { showProject }) draws one. bulk(sessions) gives the actions on those picked. projects() gives, for grouping by
// project, [{ name, server, hue, watching, liveCount, sessionCount, lastActivity, href, onOpen, menu() }] and
// fetchProject(project, page) its sessions.
export default class SessionBrowser {
	constructor({ appendTo, key, placeholder, empty, fetchPage, renderCard, bulk, projects, fetchProject, extra = [] }) {
		Object.assign(this, { key, empty, fetchPage, renderCard, bulk, projects, fetchProject });
		this.box = new Box({ appendTo });
		this.filter = '';
		this.groupBy = projects && recall(`${key}.groupBy`) === 'project' ? 'project' : 'day';
		this.exclude = new Set();
		this.picking = false;
		this.picked = new Map();
		this.latest = 0;

		this.search = Object.assign(element('input', 'search'), { type: 'search', placeholder });
		this.search.addEventListener(
			'input',
			debounce(() => this.reload(), SEARCH_DELAY_MS),
		);

		this.chips = FILTERS.map(({ name, label, title }) => {
			const chip = button(label, () => this.setFilter(name), { title, className: 'variant-chip' });

			chip.dataset.filter = name;

			return chip;
		});
		this.switch = new Tabs({
			variant: 'segmented',
			tabs: [
				{ id: 'day', label: 'By day' },
				{ id: 'project', label: 'By project' },
			],
			selected: this.groupBy,
			onChange: name => this.setGroupBy(name),
		});
		this.pickButton = button('Select', () => this.setPicking(!this.picking), {
			className: 'variant-chip',
			title: 'Pick several to archive, watch or delete together',
		});

		const toolbar = element('div', 'toolbar');

		toolbar.append(
			...this.chips,
			element('span', 'spacer'),
			...(projects ? [this.switch.elem] : []),
			...(bulk ? [this.pickButton] : []),
		);
		this.summary = element('div', 'summary');
		this.list = element('div', 'cards');
		this.extra = element('div', 'cards');
		this.extra.append(...extra);
		this.bulkBar = element('div', 'bulk');
		this.bulkBar.style.display = 'none';
		this.box.elem.append(this.search, toolbar, this.summary, this.list, this.extra, this.bulkBar);
		this.paintToolbar();
	}

	get query() {
		return this.search.value.trim();
	}

	// Results are a flat list: whenever a chip narrows it or something is typed
	get narrowed() {
		return Boolean(this.query || this.filter);
	}

	setFilter(name) {
		this.filter = this.filter === name ? '' : name;
		this.reload();
	}

	setGroupBy(name) {
		this.groupBy = name;
		remember(`${this.key}.groupBy`, name);
		this.reload();
	}

	setPicking(on) {
		this.picking = on;
		this.picked.clear();
		this.paintBulk();
		this.paintToolbar();
		this.redraw();
	}

	redraw() {
		if (!this.narrowed && this.groupBy === 'project') return this.renderProjects();

		this.render();
	}

	paintToolbar() {
		for (const chip of this.chips) chip.classList.toggle('active', chip.dataset.filter === this.filter);
		this.switch.elem.style.display = this.narrowed ? 'none' : '';
		this.pickButton.classList.toggle('active', this.picking);
		this.pickButton.textContent = this.picking ? 'Done' : 'Select';
		this.extra.style.display = !this.narrowed && this.groupBy === 'project' ? '' : 'none';
	}

	// `exclude`: sessions the page shows above, left out until a chip or a search asks for everything
	async reload({ exclude } = {}) {
		this.exclude = exclude ?? this.exclude;
		this.loaded = [];
		this.total = Infinity;
		this.fetched = 0;
		this.picked.clear();
		this.paintBulk();
		this.paintToolbar();

		if (!this.narrowed && this.groupBy === 'project') return this.renderProjects();

		return this.more();
	}

	async more() {
		const ask = ++this.latest;
		const wanted = this.loaded.length + PAGE_SIZE;

		while (this.loaded.length < wanted && this.fetched < this.total) {
			const { sessions, total } = await this.fetchPage({
				...(this.query && { q: this.query }),
				...(this.filter && { filter: this.filter }),
				offset: this.fetched,
				limit: PAGE_SIZE,
			});

			if (ask !== this.latest) return;

			this.total = sessions.length ? total : this.fetched;
			this.fetched += sessions.length;
			this.loaded.push(...sessions.filter(session => this.narrowed || !this.exclude.has(session.id)));
		}

		this.render();
	}

	render() {
		const shown = this.loaded;
		const all = this.narrowed ? this.total : Math.max(this.total - this.exclude.size, shown.length);

		this.list.classList.toggle('picking', this.picking);
		this.list.replaceChildren();

		if (this.narrowed) {
			const what = this.filter ? FILTERS.find(({ name }) => name === this.filter).label.toLowerCase() : 'matching';

			this.summary.textContent = `${all} ${what}, newest first${this.query && !this.filter ? ' (archived ones too)' : ''}`;
		} else this.summary.textContent = '';

		if (!shown.length) {
			new Empty({ appendTo: this.list, message: this.narrowed ? 'None.' : this.empty });

			return;
		}

		for (const group of DAY_GROUPS) {
			const inGroup = shown.filter(session => dayGroup(session.lastModified ?? session.activeAt) === group);

			if (!inGroup.length) continue;

			new SectionLabel({
				appendTo: this.list,
				addClass: 'group',
				textContent: group,
				append: element('span', 'count', String(inGroup.length)),
			});
			for (const session of inGroup)
				this.card(session, this.list, { when: whenIn(group, session.lastModified ?? session.activeAt) });
		}

		if (shown.length < all) {
			const rest = button(`Show ${Math.min(PAGE_SIZE, all - shown.length)} more`, () => this.more(), {
				className: 'more-sessions',
			});

			rest.title = `${all - shown.length} not shown yet`;
			this.list.append(rest);
		}
	}

	// A session's card, with a box to pick it by while picking (this server's own only: the actions act here)
	card(session, appendTo, options = {}) {
		const card = this.renderCard(session, appendTo, options);

		if (!this.picking || session.remote) return card;

		const box = checkbox(this.picked.has(session.id));

		box.classList.add('pick');
		card.elem.prepend(box);
		card.elem.addEventListener(
			'click',
			event => {
				event.preventDefault();
				event.stopPropagation();
				if (event.target !== box) box.checked = !box.checked;
				if (box.checked) this.picked.set(session.id, session);
				else this.picked.delete(session.id);
				this.paintBulk();
			},
			true,
		);

		return card;
	}

	paintBulk() {
		this.bulkBar.style.display = this.picking ? '' : 'none';
		if (!this.picking) return;

		const picked = [...this.picked.values()];
		const pickable = this.loaded.filter(session => !session.remote);

		this.bulkBar.replaceChildren(
			element('span', 'picked', picked.length ? `${picked.length} picked` : 'Pick sessions to act on'),
			button(
				picked.length === pickable.length && picked.length ? 'Pick none' : 'Pick all shown',
				() => {
					if (picked.length === pickable.length) this.picked.clear();
					else for (const session of pickable) this.picked.set(session.id, session);
					this.paintBulk();
					this.redraw();
				},
				{ className: 'variant-chip' },
			),
			...(picked.length
				? this.bulk(picked).map(({ label, title, onPress, danger }) =>
						button(label, onPress, { title, className: `variant-chip${danger ? ' danger' : ''}` }),
					)
				: []),
			button('Done', () => this.setPicking(false), { className: 'variant-chip active' }),
		);
	}

	// Each project a heading (what it holds, how much is running, when it was last busy, and its menu) that opens to
	// its newest sessions. Open ones stay open; to begin with, the ones watched or running are.
	async renderProjects() {
		const ask = ++this.latest;
		const projects = await this.projects();

		if (ask !== this.latest) return;

		const opened = this.openedProjects();

		this.loaded = [];
		this.summary.textContent = '';
		this.list.classList.toggle('picking', this.picking);
		this.list.replaceChildren();
		if (!projects.length) new Empty({ appendTo: this.list, message: 'No projects yet. Add a folder below.' });

		for (const project of projects) {
			const id = project.server ? `${project.server}/${project.name}` : project.name;
			const open = opened[id] ?? Boolean(project.watching || project.liveCount);
			const section = element('div', 'project-group');
			const head = new Card({ accent: project.accent, interactive: true, addClass: 'project-head' }).elem;
			const body = element('div', 'project-body');
			const about = element('span', 'about');

			head.append(
				element('i', `fa-solid fa-chevron-${open ? 'down' : 'right'} chevron`),
				element('span', 'name', project.name),
			);
			if (project.server) {
				const server = element('span', 'server', project.server);

				server.style.setProperty('--server-hue', project.serverHue);
				head.append(server);
			}
			if (project.liveCount) head.append(element('span', 'running', `${project.liveCount} running`));
			about.textContent = [
				`${project.sessionCount ?? 0} session${project.sessionCount === 1 ? '' : 's'}`,
				project.lastActivity && `last ${relativeTime(project.lastActivity)}`,
			]
				.filter(Boolean)
				.join(' · ');
			head.append(about);
			if (project.watching)
				head.append(Object.assign(element('i', 'fa-solid fa-eye'), { title: 'Watching every session in it' }));

			const more = button(
				'',
				event => {
					event.stopPropagation();
					openMenu(more, project.menu());
				},
				{ icon: 'ellipsis', title: 'More', className: 'icon-only variant-flat' },
			);

			head.append(more);
			contextMenu(head, project.menu);
			head.addEventListener('click', () => {
				this.openProject(id, !open);
				this.renderProjects();
			});
			section.append(head, body);
			this.list.append(section);
			if (open) this.fillProject(project, body, ask);
		}
	}

	async fillProject(project, body, ask) {
		const { sessions, total } = await this.fetchProject(project, { offset: 0, limit: PROJECT_PREVIEW });

		if (ask !== this.latest) return;
		if (!sessions.length) return new Empty({ appendTo: body, message: 'No sessions yet.' });

		this.loaded.push(...sessions);
		for (const session of sessions) this.card(session, body, { showProject: false });
		if (total > sessions.length) {
			const all = element('a', 'all', `All ${total} sessions in ${project.name} →`);

			all.href = project.href ?? '#/';
			if (project.onOpen)
				all.addEventListener('click', event => {
					event.preventDefault();
					project.onOpen();
				});
			body.append(all);
		}
	}

	openedProjects() {
		try {
			return JSON.parse(recall(`${this.key}.openProjects`) || '{}');
		} catch {
			return {};
		}
	}

	openProject(id, open) {
		remember(`${this.key}.openProjects`, JSON.stringify({ ...this.openedProjects(), [id]: open }));
	}
}
