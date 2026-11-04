import { Notify, View } from '@vanilla-bean/components';
import { relativeTime } from '@vanilla-bean/components/utils/date';

import { getRemotes, getRemoteUniverse, getUniverse, markRemoteSeen, markSeen, openRemote } from '../api';
import { Bar } from '../Bar';
import { breadcrumbs } from '../Breadcrumbs';
import { button, element } from '../dom';
import { LOCAL, assignShip, hiddenNow, shipsAssigned, shipsOf, shownOf, toggleHidden } from './shown';
import { identity, serverName } from '../identity';
import { hueOf, onServersChange, setServers } from '../servers';
import { openMenu } from '../menu';
import { sessionMenu } from '../sessionActions';
import olderPaude from './olderPaude';
import { VERBS, dockCard } from './dock';
import {
	ROOMS,
	STATUS,
	cargoWords,
	doing,
	flyoutOf,
	limitWords,
	live,
	plural,
	shipWords,
	titled,
	whereWorking,
} from './flyout';
import { enginesPane, foldersPane, listDock, projectPanes, projectsPane, sessionsPane, shownPane } from './shipDock';
import refusal from './reason';
import { logCard, manifestCard, promptCard, replyCard } from './replyCard';
import Ship, { BEAM_SECONDS, BRIDGE, LOUNGE, sessionKey, triage } from './scene';
import { UNIT } from './station';
import { FOCUS_WIDTH, Stage } from './universeStyle';

// Panels framed as void-driller frames them, corners cut by augmented-ui
const FRAME = { large: 'tl-clip tr-2-clip-x br-clip bl-2-clip-y border', small: 'tl-clip br-clip border' };

const POLL_MS = 2000;
// How far in a zoom by hand has to be for the room in the middle to have its panel
const FOCUS_ZOOM = 4;
const HOLD_MS = 550;
const REMOTES_MS = 60_000;
// How soon to ask again when the list of other paudes didn't come back
const REMOTES_RETRY_MS = 5000;
// A frame after a long pause (a hidden tab) moves things on by this much at most
const LONGEST_FRAME_S = 0.1;
const DRAG_PX = 5;
const WHEEL_ZOOM = 0.0015;

const localName = () => serverName() ?? 'this machine';

// Moved to its spot ({ elem, left, top }), touching its style only when it moves
const place = spot => {
	if (spot && spot.elem.style.left !== spot.left) spot.elem.style.left = spot.left;
	if (spot && spot.elem.style.top !== spot.top) spot.elem.style.top = spot.top;
};

// What pressing a thing selects: the worker behind anything of its session's, or the deck a deck's things are in
const selectionOf = (target, view) => {
	const worker =
		(['worker', 'monitor'].includes(target?.kind) && target.worker) ||
		(['talk', 'subagent'].includes(target?.kind) && view.workerOf(target.session)) ||
		(target?.kind === 'use' && view.workerOf(target.use.session));

	if (worker)
		return {
			worker,
			title: worker.session.title || worker.session.project || 'A new session',
			about: [worker.session.project, worker.session.engine.name, STATUS[worker.session.status]]
				.filter(Boolean)
				.join(' · '),
		};

	const bay = (target?.kind === 'bay' || target?.kind === 'cargo') && target.bay;

	if (bay)
		return {
			bay,
			title: bay.name,
			about: `${plural(bay.sessions.length, 'session')} · ${bay.engines.map(({ name }) => name).join(', ')}`,
		};
	if (target?.kind === 'bridge')
		return { place: 'bridge', title: 'Bridge', about: 'every session aboard, and the projects they work in' };
	if (target?.kind === 'cloner' || target?.kind === 'materializer')
		return { place: 'new', title: 'New sessions', about: 'a prompt, or a new project to start in' };
	if (target?.kind === 'engine')
		return { engine: target.engine, title: target.engine.name, about: target.engine.detail };

	return null;
};

// The width the docks were last dragged to, kept for this browser (where it can be: storage can be off)
const DOCK_WIDTH = 'paude-universe-dock-width';
const DOCK_LEAST = 360;

const savedDockWidth = () => {
	try {
		return Number(localStorage.getItem(DOCK_WIDTH)) || null;
	} catch {
		return null;
	}
};

// A dock dragged wider or narrower by a grip along its left edge, and opened at the width it was last left at; once
// sized by hand (`data-sized`), what's in it fits itself to that rather than sizing the dock
const resizable = card => {
	const grip = element('div', 'grip');
	const saved = savedDockWidth();

	grip.title = 'Drag to resize';
	if (saved) {
		card.style.width = `${saved}px`;
		card.dataset.sized = 'true';
	}
	grip.addEventListener('pointerdown', down => {
		down.preventDefault();
		grip.setPointerCapture(down.pointerId);

		const right = card.getBoundingClientRect().right;
		const most = card.parentElement.clientWidth - 32;
		const move = event => {
			const width = Math.round(Math.max(DOCK_LEAST, Math.min(most, right - event.clientX)));

			card.style.width = `${width}px`;
			card.dataset.sized = 'true';
		};
		const up = () => {
			grip.removeEventListener('pointermove', move);
			try {
				localStorage.setItem(DOCK_WIDTH, String(card.offsetWidth));
			} catch {
				// Kept for this visit only
			}
		};

		grip.addEventListener('pointermove', move);
		grip.addEventListener('pointerup', up, { once: true });
	});
	card.append(grip);
};

// What a selection is, to tell one from another
const selectionKey = selected =>
	(selected?.worker && `worker:${selected.worker.session.key}`) ||
	(selected?.bay && `bay:${selected.bay.name}`) ||
	(selected?.engine && `engine:${selected.engine.key}`) ||
	(selected?.place && `room:${selected.place}`) ||
	null;

// An answer, and how long it took to come
const timed = async asking => {
	const start = performance.now();
	const answer = await asking;

	return { ...answer, latency: Math.round(performance.now() - start) };
};

const NEEDS = { asking: 'needs you', unread: 'has something new' };

// A pull request's checks in a few words
const checkStatus = ({ draft, checks: { passing = 0, failing = 0, pending = 0 } = {} }) =>
	(draft && 'draft') ||
	(failing && `${failing} check${failing === 1 ? '' : 's'} failing`) ||
	(pending && 'checks running') ||
	(passing && 'checks pass') ||
	'no checks';

// The universe view: a ship for each subscription, one of them aboard and on the stage, with the cards, docks, panel
// and command bar about it
// A panel bordered, and its title colored, in a project's color when it's about a project; its own otherwise
const tone = (panel, title, hue) => {
	const color = Number.isFinite(hue) ? `hsl(${hue} 60% 68%)` : '';

	panel.style.setProperty('--aug-border-bg', color);
	title.style.color = color;
};

export default class Universe extends View {
	build() {
		const bar = new Bar({ appendTo: this });

		breadcrumbs({
			appendTo: bar,
			current: 'Universe',
			addCleanup: (name, stop) => this.addCleanup(name, stop),
		});

		this.stage = new Stage({ appendTo: this });
		this.canvas = element('canvas');
		this.tip = element('div', 'tip');
		this.tip.dataset.augmentedUi = FRAME.small;
		this.tip.style.display = 'none';
		this.focus = element('div', 'focus');
		this.focus.dataset.augmentedUi = FRAME.large;
		this.focus.style.display = 'none';
		this.command = element('div', 'command');
		this.command.dataset.augmentedUi = FRAME.small;
		this.command.style.display = 'none';
		this.stage.elem.append(this.canvas, this.focus, this.tip, this.command);
		// A ship for each subscription; `aboard` the one on the stage
		this.ships = new Map([['', this.makeShip()]]);
		this.aboard = this.ships.get('');
		this.remotes = [];
		// An engine whose universe didn't answer isn't asked again for a while
		this.sealed = new Map();
		this.calm = window.matchMedia('(prefers-reduced-motion: reduce)');

		this.watchSize();
		this.watchPointer();
		this.addCleanup(
			'servers',
			onServersChange(found => {
				if (found) this.remotes = found;
			}),
		);
		this.findRemotes();
		this.poll();

		const polling = setInterval(() => this.poll(), POLL_MS);
		const finding = setInterval(() => this.findRemotes(), REMOTES_MS);

		this.addCleanup('polling', () => {
			clearInterval(polling);
			clearInterval(finding);
			clearTimeout(this.retrying);
		});
		this.animate();
	}

	makeShip() {
		const ship = new Ship();

		ship.aside = FOCUS_WIDTH + 32;

		return ship;
	}

	// The answers, less what's hidden, a ship for each subscription, this paude's first. Ships come and go with their
	// subscriptions.
	updateShips() {
		const answers = shownOf(this.answers ?? [], hiddenNow());
		const groups = shipsOf(answers, shipsAssigned(), this.answers ?? []);

		// Everything hidden: one empty ship, so there's always one to draw
		if (!groups.size) groups.set('', []);

		const keys = [...groups.keys()];

		// The first ship is the one there from the start
		if (this.ships.has('') && keys.length) {
			const first = this.ships.get('');

			this.ships = new Map([[keys[0], first]]);
		}
		for (const key of keys) if (!this.ships.has(key)) this.ships.set(key, this.makeShip());
		for (const key of [...this.ships.keys()]) if (!groups.has(key)) this.ships.delete(key);
		this.ships = new Map(keys.map(key => [key, this.ships.get(key)]));
		if (![...this.ships.values()].includes(this.aboard)) this.aboard = this.ships.values().next().value;

		// One ship on the stage at a time, the one aboard; the rest go on out of sight, heard from by its transporter
		const { width = 0, height = 0 } = this.stageSize ?? {};

		for (const ship of this.ships.values()) ship.resize(width, height);

		// What each ship's transporter hears from the rest: set before it's laid out (whether it has a transporter at all)
		// and again once every ship has its answers
		const summary = (key, ship) => {
			const needed = triage(ship.sessions ?? [], ship.read);

			return {
				key,
				name: groups
					.get(key)
					.map(({ name }) => name)
					.join(' + '),
				needs: needed.filter(({ need }) => need === 'asking').length,
				news: needed.filter(({ need }) => need === 'unread').length,
				working: (ship.sessions ?? []).filter(({ status }) => status === 'working').length,
			};
		};
		const hear = () => {
			const all = [...this.ships].map(([key, ship]) => summary(key, ship));

			for (const [key, ship] of this.ships) ship.fleet = all.filter(other => other.key !== key);
		};

		hear();
		for (const [key, ship] of this.ships) ship.update(groups.get(key));
		hear();
	}

	// Beamed over to another ship: off this one's transporter, and on at that one's
	travel(key) {
		const ship = this.ships.get(key);

		if (!ship || ship === this.aboard) return;
		this.aboard.beamAt = this.aboard.time;
		this.closeCard();
		this.closeDock();
		this.select(null);
		clearTimeout(this.beaming);
		this.beaming = setTimeout(() => {
			// Gone while beaming (its paude hidden, say): staying put
			if (![...this.ships.values()].includes(ship)) return;
			// Anything opened on the way is left behind with the old ship
			this.closeCard();
			this.closeDock();
			this.select(null);
			this.aboard = ship;
			ship.beamAt = ship.time;
			ship.look(ship.layout.transporter ? 'transporter' : 'all');
			this.focusPainted = null;
			this.paintFocus();
		}, BEAM_SECONDS * 1000);
	}

	watchSize() {
		const observer = new ResizeObserver(() => {
			const { width, height } = this.stage.elem.getBoundingClientRect();
			// Device pixels, so every art pixel is a whole number of them however dense the screen
			const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));

			this.canvas.width = Math.max(1, Math.round(width * ratio));
			this.canvas.height = Math.max(1, Math.round(height * ratio));
			this.stageSize = { width, height };
			for (const ship of this.ships.values()) ship.resize(width, height);
		});

		observer.observe(this.stage.elem);
		this.addCleanup('size', () => observer.disconnect());
	}

	animate() {
		const ctx = this.canvas.getContext('2d');
		let last = performance.now();
		let frame;
		const tick = now => {
			const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));

			// Every ship going on, the one aboard drawn
			for (const ship of this.ships.values())
				ship.step(Math.min(LONGEST_FRAME_S, (now - last) / 1000), this.calm.matches);
			this.aboard.draw(ctx, ratio);
			last = now;
			// Everything measured, then everything moved
			for (const spot of [this.cardSpot(), this.focusSpot()]) place(spot);
			frame = requestAnimationFrame(tick);
		};

		frame = requestAnimationFrame(tick);
		this.addCleanup('frames', () => cancelAnimationFrame(frame));
	}

	watchPointer() {
		const at = event => {
			const box = this.canvas.getBoundingClientRect();

			return { x: event.clientX - box.left, y: event.clientY - box.top };
		};
		let press = null;

		this.canvas.addEventListener('pointerdown', event => {
			const point = at(event);

			press = { ...point, last: point, dragged: false };
			this.canvas.setPointerCapture(event.pointerId);
			// Held without moving, a touch opens the menu
			if (event.pointerType === 'mouse') return;

			const held = press;

			clearTimeout(this.holding);
			this.holding = setTimeout(() => {
				if (held.dragged || press !== held) return;
				held.ordered = true;
				this.openMenuAt(point, { x: event.clientX, y: event.clientY });
			}, HOLD_MS);
		});
		this.canvas.addEventListener('contextmenu', event => {
			event.preventDefault();
			this.openMenuAt(at(event), { x: event.clientX, y: event.clientY });
		});
		this.canvas.addEventListener('pointermove', event => {
			const point = at(event);

			if (!press) {
				if (event.pointerType === 'mouse') this.showTip(this.aboard.hit(point.x, point.y), point);

				return;
			}
			if (Math.hypot(point.x - press.x, point.y - press.y) > DRAG_PX) press.dragged = true;
			if (!press.dragged) return;

			this.showTip(null);
			this.canvas.classList.add('dragging');
			this.aboard.pan(point.x - press.last.x, point.y - press.last.y);
			press.last = point;
		});
		this.canvas.addEventListener('pointerleave', () => this.showTip(null));
		this.canvas.addEventListener('pointerup', event => {
			const { dragged, ordered, timer } = press ?? {};

			clearTimeout(timer);
			press = null;
			if (ordered) return;
			this.canvas.classList.remove('dragging');
			if (!dragged) this.press(at(event), event.pointerType === 'mouse');
		});
		this.canvas.addEventListener('pointercancel', () => {
			press = null;
			this.canvas.classList.remove('dragging');
		});
		this.canvas.addEventListener(
			'wheel',
			event => {
				event.preventDefault();
				this.aboard.zoom(Math.exp(-event.deltaY * WHEEL_ZOOM), at(event));
			},
			{ passive: false },
		);

		const escape = event => {
			// A live terminal's keys are Claude's (Escape interrupts it), and a docked panel handles its own
			if (event.target.closest?.('.docked-terminal .screen, .dock > .body, .xterm')) return;
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			// Typing into a box is typing, but Escape still closes the card it's in
			if (event.target.closest?.('input, textarea, [contenteditable]') && event.key !== 'Escape') return;
			// Tab is the next thing needing you only while nothing else has the keyboard; on a button it moves on as usual
			if (event.key === 'Tab') {
				if (![document.body, this.canvas].includes(document.activeElement)) return undefined;
				event.preventDefault();

				return this.nextNeed(event.shiftKey ? -1 : 1);
			}
			if (event.key !== 'Escape') return this.hotkey(event);
			if (this.card) this.closeCard();
			else if (this.dock) this.closeDock();
			else if (this.selected) this.select(null);
			else this.aboard.look('all');
		};

		window.addEventListener('keydown', escape);
		this.addCleanup('keys', () => window.removeEventListener('keydown', escape));
		// Leaving the page lets go of what's open from it, a dock's terminal and shell among them, and what's timed
		this.addCleanup('opened', () => {
			this.closeCard();
			this.closeDock();
			clearTimeout(this.beaming);
			clearTimeout(this.holding);
		});
	}

	showTip(target, { x, y } = {}) {
		this.canvas.classList.toggle(
			'pointing',
			[
				'worker',
				'monitor',
				'bay',
				'engine',
				'cloner',
				'bridge',
				'lounge',
				'system',
				'log',
				'use',
				'cargo',
				'commit',
				'subagent',
				'delivery',
				'talk',
				'processes',
				...Object.keys(ROOMS),
			].includes(target?.kind),
		);
		if (!target) {
			this.tip.style.display = 'none';

			return;
		}

		const { title, rows = [], hint, hue } = flyoutOf(target, this.aboard);
		const table = element('div', 'rows');
		const heading = element('strong', '', title);

		for (const row of rows.filter(Boolean)) table.append(element('span', 'key', row[0]), element('span', '', row[1]));
		tone(this.tip, heading, hue);
		this.tip.replaceChildren(heading, table, ...(hint ? [element('div', 'about', hint)] : []));
		this.tip.style.display = '';

		const { width, height } = this.stage.elem.getBoundingClientRect();
		const tip = this.tip.getBoundingClientRect();

		this.tip.style.left = `${Math.max(16, Math.min(width - tip.width - 16, x + 14))}px`;
		this.tip.style.top = `${Math.max(8, Math.min(height - tip.height - 8, y + 14))}px`;
	}

	// A worker opens its reply, its monitor its terminal; the materializer opens a new
	// prompt; a room is looked
	// at closely, and again to look at it all. Anywhere else closes what's open, then looks at it all.
	press(point, mouse) {
		const target = this.aboard.hit(point.x, point.y);
		const { looking } = this.aboard;

		this.showTip(null);
		this.select(selectionOf(target, this));
		if (target?.kind === 'worker') return this.openReply(target.worker, { focus: false });
		if (target?.kind === 'monitor')
			return live(target.worker.session) ? this.dockOrReply(target.worker, 'terminal') : this.openReply(target.worker);
		if (target?.kind === 'cloner') return this.newPrompt(undefined, point);
		if (target?.kind === 'log') return this.openLog(target, point);
		// The work itself opens where it's worked on: a checkout's cargo or pull request in its git, a chat in the chat, a
		// small grey in the tasks, what runs behind a seat in its ports
		if (target?.kind === 'delivery' || target?.kind === 'cargo' || target?.kind === 'commit') {
			const worker = this.workerIn(target.checkout);

			if (!worker) return this.openManifest(target.checkout, point);
			this.select(selectionOf({ kind: 'worker', worker }, this));
			const git = this.openDock(worker, 'git');

			if (target.kind === 'delivery') git.showTab('review');

			return undefined;
		}
		if (target?.kind === 'talk' && this.workerOf(target.session))
			return this.dockOrReply(this.workerOf(target.session), 'notes');
		if (target?.kind === 'subagent' && this.workerOf(target.session))
			return this.dockOrReply(this.workerOf(target.session), 'tasks');
		if (target?.kind === 'processes') return this.dockOrReply(target.worker, 'shares');
		if (target?.kind === 'use' && this.workerOf(target.use.session))
			return this.openReply(this.workerOf(target.use.session));
		if (target?.kind === 'bridge' || target?.kind === 'lounge') {
			const at = target.kind === 'bridge' ? BRIDGE : LOUNGE;

			return this.aboard.look(looking === at ? 'all' : at);
		}
		if (target?.kind === 'bay') return this.aboard.look(looking === target.bay.name ? 'all' : target.bay.name);
		if (target?.room && (target.kind === 'system' || ROOMS[target.kind]))
			return this.aboard.look(looking === target.room.name ? 'all' : target.room.name);
		if (target?.kind === 'engine') return this.aboard.look(looking === target.engine.key ? 'all' : target.engine.key);
		// No hover on a touch screen: a touch says what it landed on
		if (target && !mouse) return this.showTip(target, point);
		if (this.card) return this.closeCard();

		this.select(null);
		this.aboard.look('all');
	}

	// The menu for what's under the point: a worker's session menu, a bay's project, an engine to look at
	openMenuAt(point, at) {
		const target = this.aboard.hit(point.x, point.y);

		this.showTip(null);
		if (target?.kind === 'worker' || target?.kind === 'monitor') return openMenu(at, this.workerMenu(target.worker));
		if (target?.kind === 'bay' || (target?.kind === 'cargo' && target.bay))
			return openMenu(at, this.bayMenu(target.bay, point));
		if (target?.kind === 'engine')
			openMenu(at, [
				{ heading: target.engine.name },
				{ label: 'Look closer', onPress: () => this.aboard.look(target.engine.key) },
			]);
	}

	// A stopped session wakes when it's answered or opened, and goes by archiving or deleting it
	workerMenu(worker) {
		const { session } = worker;
		const { remote } = session.engine;
		const stopped = session.status === 'stopped';

		return [
			{ heading: session.title || session.project || 'A new session' },
			{
				label: stopped ? 'Wake with a prompt' : 'Read and answer',
				detail: stopped ? 'Read its last reply, and answering takes it back up' : '',
				onPress: () => this.openReply(worker),
			},
			...(live(session) ? [{ label: 'Live terminal', onPress: () => this.dockOrReply(worker, 'terminal') }] : []),
			{
				label: (stopped ? 'Wake and open' : 'Open session') + (remote ? ` on ${remote.name}` : ''),
				onPress: () => this.open(session),
			},
			...(remote ? [] : sessionMenu({ ...session, live: session.status !== 'stopped' }, () => this.poll())),
		];
	}

	// What's selected: a worker or a deck, ringed on the ship, its verbs along the command bar
	select(selected) {
		const same = selectionKey(selected) === selectionKey(this.selected);

		this.selected = selected;
		this.aboard.selected = selectionKey(selected);
		if (!same) this.paintCommand();
	}

	// After each answer: a selected worker that's gone is let go, and one still aboard has its bar say how it is now
	refreshSelection() {
		const worker = this.selected?.worker;

		if (!worker) return;

		const now = this.aboard.workers.get(worker.session.key);

		if (!now || now.leaving) return this.select(null);
		this.selected = selectionOf({ kind: 'worker', worker: now }, this);
		this.paintCommand();
	}

	// The command bar: what's selected and what can be done to it, each with its key
	paintCommand() {
		const selected = this.selected;

		this.focus.classList.toggle('keys-on-bar', this.barLeads());

		if (!selected) {
			this.command.style.display = 'none';
			this.commands = [];

			return;
		}

		const commands =
			(selected.worker && this.workerCommands(selected.worker)) ||
			(selected.bay && this.bayCommands(selected.bay)) ||
			(selected.engine && this.engineCommands(selected.engine)) ||
			this.placeCommands(selected.place);
		// A room's verbs are on the panel beside it while it's looked at; the bar is for a worker or an engine, or a room
		// seen from afar
		if (!this.barLeads()) {
			this.command.style.display = 'none';
			this.painted = null;

			return;
		}

		const painted = [selected.title, selected.about, ...commands.map(({ label }) => label)].join('|');

		this.commands = commands;
		// Unchanged, it's left be, so a press isn't lost to a repaint under it
		if (painted === this.painted && this.command.style.display !== 'none') return;
		this.painted = painted;

		const who = element('div', 'who');
		const named = element('strong', '', selected.title);

		tone(this.command, named, selected.bay?.hue);
		who.append(named, element('span', '', selected.about));
		this.command.replaceChildren(
			who,
			...commands.map(({ label, hotkey, run }) => {
				const press = element('button');

				press.append(element('kbd', '', hotkey), document.createTextNode(label));
				press.title = `${label} (${hotkey})`;
				press.addEventListener('click', run);

				return press;
			}),
		);
		this.command.style.display = '';
	}

	workerCommands(worker) {
		const { session } = worker;
		const { remote } = session.engine;
		const stopped = session.status === 'stopped';

		return [
			{ label: stopped ? 'Wake' : 'Reply', hotkey: 'r', run: () => this.openReply(worker) },
			...(live(session) ? [{ label: 'Terminal', hotkey: 't', run: () => this.dockOrReply(worker, 'terminal') }] : []),
			...(remote
				? []
				: VERBS.filter(({ key, allowed }) => key !== 'terminal' && allowed()).map(({ key, label, hotkey }) => ({
						label,
						hotkey,
						run: () => this.openDock(worker, key),
					}))),
			{ label: remote ? `Open on ${remote.name}` : 'Open', hotkey: 'o', run: () => this.open(session) },
		];
	}

	// A project's verbs. On more than one engine, each one that acts on one engine's copy says which: new prompts and
	// its lists are this paude's, and each other engine's copy is opened there
	bayCommands(bay) {
		const local = bay.engines.find(({ remote }) => !remote);
		const remotes = bay.engines.filter(({ remote }) => remote);
		const on = name => (bay.engines.length > 1 ? ` on ${name}` : '');
		const anchor = this.aboard.screen({ x: bay.x + bay.w / 2, y: bay.y + bay.d / 2 });

		const worker = [...this.aboard.workers.values()].find(
			({ session }) => session.project === bay.name && !session.engine.remote && session.status !== 'stopped',
		);

		return [
			{
				label: local && remotes.length ? `New prompt${on(local.name)}` : 'New prompt here',
				hotkey: 'n',
				run: () => this.newPrompt(bay.name, anchor),
			},
			...(local
				? [
						{ label: `Sessions${on(local.name)}`, hotkey: 'h', run: () => this.openProjectDock(bay.name, 'sessions') },
						{
							label: `Files${on(local.name)}`,
							hotkey: 'f',
							run: () =>
								worker
									? this.openDock(worker, 'files')
									: new Notify({
											intent: 'warning',
											content: `Files are read through a session: start one in ${bay.name} first.`,
										}),
						},
						{ label: `Links${on(local.name)}`, hotkey: 'l', run: () => this.openProjectDock(bay.name, 'links') },
						{ label: `Made${on(local.name)}`, hotkey: 'm', run: () => this.openProjectDock(bay.name, 'artifacts') },
					]
				: []),
			{ label: 'Look closer', hotkey: 'z', run: () => this.aboard.look(bay.name) },
			...(local
				? [
						{
							label: `Open project${on(local.name)}`,
							hotkey: 'o',
							run: () => (window.location.hash = `#/projects/${encodeURIComponent(bay.name)}`),
						},
					]
				: []),
			// Each other engine's copy by its number, or by o when there's no copy here
			...remotes.map((engine, index) => ({
				label: `Open on ${engine.name}`,
				hotkey: local || index ? String(index + 1) : 'o',
				run: () => this.openProject(engine, bay.name),
			})),
		];
	}

	bayMenu(bay, point) {
		const local = bay.engines.find(({ remote }) => !remote);
		const remotes = bay.engines.filter(({ remote }) => remote);
		const on = name => (bay.engines.length > 1 ? ` on ${name}` : '');

		return [
			{ heading: bay.name },
			{
				label: local && remotes.length ? `New prompt${on(local.name)}` : 'New prompt here',
				detail: 'paude finds the session it carries on, or starts one in this project',
				onPress: () => this.newPrompt(bay.name, point),
			},
			{ label: 'Look closer', onPress: () => this.aboard.look(bay.name) },
			...(local
				? [
						{
							label: `Open project${on(local.name)}`,
							onPress: () => (window.location.hash = `#/projects/${encodeURIComponent(bay.name)}`),
						},
					]
				: []),
			...remotes.map(engine => ({
				label: `Open project on ${engine.name}`,
				onPress: () => this.openProject(engine, bay.name),
			})),
		];
	}

	engineCommands(engine) {
		const remote = this.remotes.find(({ url }) => url === engine.key);

		return [
			{ label: 'Look closer', hotkey: 'z', run: () => this.aboard.look(engine.key) },
			...(remote
				? [
						{ label: 'Sessions', hotkey: 'h', run: () => this.openShipDock('sessions', [remote], engine.name) },
						{ label: `Open ${engine.name}`, hotkey: 'o', run: () => this.openEngine(remote) },
					]
				: [{ label: 'Sessions', hotkey: 'h', run: () => this.openShipDock('sessions', [], engine.name) }]),
		];
	}

	placeCommands(place) {
		const prompt = { label: 'New prompt', hotkey: 'n', run: () => this.newPrompt() };
		const folder = { label: 'Add a folder', hotkey: 'a', run: () => this.openShipDock('folders') };

		if (place === 'new') return [prompt, folder];

		return [
			{ label: 'All sessions', hotkey: 'h', run: () => this.openShipDock('sessions') },
			folder,
			prompt,
			{ label: 'Look closer', hotkey: 'z', run: () => this.aboard.look(BRIDGE) },
		];
	}

	// Opened from a session's page or a project's, the first answer that has it goes to it: the session's grey, flown to
	// and picked, or the project's machine, looked at with its panel
	focusOpened() {
		const { session, project } = this.options ?? {};

		if (this.focusedOpen || (!session && !project)) return;
		// On whichever ship has it, that ship then the one played
		for (const ship of this.ships.values()) {
			if (project) {
				const bay = ship.bays.find(({ name }) => name === decodeURIComponent(project));

				if (!bay) continue;
				this.focusedOpen = true;
				this.aboard = ship;
				this.select(selectionOf({ kind: 'bay', bay }, this));
				ship.look(bay.name);

				return;
			}

			const id = decodeURIComponent(session);
			const worker = [...ship.workers.values()].find(({ session: { id: other } }) => other === id);

			if (!worker?.seat) continue;
			this.focusedOpen = true;
			this.aboard = ship;
			this.select(selectionOf({ kind: 'worker', worker }, this));
			ship.lookAt(worker.seat);

			return;
		}
	}

	// Which engines and projects the ship shows, each toggled; every one listed, those hidden too
	openShown() {
		this.openListDock('shown', {
			title: 'Show and hide',
			about: 'which engines and projects are aboard, kept for this browser',
			entries: [
				shownPane({
					answers: () => this.answers ?? [],
					toggle: (kind, key) => {
						toggleHidden(kind, key);
						this.updateShips();
						this.paintFocus();
					},
					assign: (key, aboard) => {
						assignShip(key, aboard);
						this.updateShips();
						this.paintFocus();
					},
				}),
			],
		});
	}

	// A dock for the whole ship, or one engine: its sessions to find, read and wake, and folders to add as projects
	openShipDock(open, remotes = this.remotes, only) {
		const withLocal = !only || only === localName();

		this.openListDock(`ship:${only ?? 'all'}`, {
			title: only ? `Sessions on ${only}` : 'Sessions and projects',
			about: only ? 'newest first' : 'on every paude you use: find, wake or start one',
			entries: [
				sessionsPane({
					remotes,
					local: withLocal,
					onPick: session => this.pick(session),
					changed: () => this.poll(),
				}),
				...(withLocal
					? [
							projectsPane({
								remotes: only ? [] : remotes,
								onStart: project => (this.closeDock(), this.newPrompt(project)),
								onOpenThere: (remote, project) => this.openProject({ name: remote.name, remote }, project),
							}),
							foldersPane({ onAdded: names => this.added(names) }),
							enginesPane({
								remotes: this.remotes,
								localName: localName(),
								onConnected: () => (this.closeDock(), this.findRemotes().then(() => this.poll())),
							}),
						]
					: []),
			],
			open,
		});
	}

	// A project's dock: its sessions, and what they brought up and made
	openProjectDock(project, open) {
		this.openListDock(`project:${project}`, {
			title: project,
			about: 'every session in it, and what they brought up and made',
			entries: [
				sessionsPane({ project, onPick: session => this.pick(session), changed: () => this.poll() }),
				...projectPanes(project),
			],
			open,
		});
	}

	openListDock(key, options) {
		if (this.dock?.key === key) return this.dock.card.show(options.open);

		this.closeDock();
		this.closeCard();

		const card = listDock({ ...options, onClose: () => this.closeDock() });

		resizable(card);
		this.dock = { card, key };
		this.stage.elem.append(card);

		return card.opened();
	}

	// A session picked from a list: its worker if it's aboard, selected and its reply open; otherwise a card to read
	// what's known of it and wake it with a prompt
	pick(session) {
		const key = sessionKey(session.remote ? session.remote.url : LOCAL, session.id);
		const worker = this.aboard.workers.get(key);

		if (worker?.seat) {
			this.closeDock();
			this.select(selectionOf({ kind: 'worker', worker }, this));
			this.aboard.lookAt(worker.seat);

			return requestAnimationFrame(() => this.openReply(worker));
		}

		const engine = session.remote
			? { key: session.remote.url, name: session.remote.name, remote: session.remote }
			: { key: LOCAL, name: localName() };
		const known = { ...session, engine, status: 'stopped', reply: null };

		this.closeDock();
		this.openCard(
			replyCard({
				session: known,
				note: 'Not running: a prompt here wakes it and carries on where it left off.',
				onOpen: () => this.open(known),
				onClose: () => this.closeCard(),
			}),
			{
				x: this.stage.elem.clientWidth / 2,
				y: this.stage.elem.clientHeight / 3,
			},
		);
	}

	// Folders just added: their projects show aboard at the next answer, and a prompt to start the first of them
	added(names) {
		this.closeDock();
		this.poll();
		if (names.length === 1) this.newPrompt(names[0]);
	}

	async openEngine(remote) {
		const { body, response } = await openRemote(remote.url, { home: true });

		if (response?.ok) window.location.href = body.link;
		else
			new Notify({
				intent: 'danger',
				content: refusal(`Could not reach ${remote.name}`, body),
			});
	}

	// Whether the command bar's keys are the ones that work: for a worker or an engine selected, or anything when no room
	// is looked at; otherwise the room's panel's
	barLeads() {
		return Boolean(this.selected && (this.selected.worker || this.selected.engine || !this.focused));
	}

	hotkey(event) {
		if (event.shiftKey || event.repeat) return;

		const commands = this.barLeads() ? this.commands : this.focusCommands;
		const command = commands?.find(({ hotkey }) => hotkey === event.key.toLowerCase());

		if (!command) return;
		event.preventDefault();
		command.run();
	}

	// The next session needing you, most pressing first, selected and looked at; round again after the last
	nextNeed(direction) {
		const needed = triage(this.aboard.sessions, this.aboard.read);

		if (!needed.length) return;

		const at = needed.findIndex(({ session }) => session.key === this.selected?.worker?.session.key);
		const { session } = needed[(at + direction + needed.length) % needed.length];
		const worker = this.aboard.workers.get(session.key);

		if (!worker?.seat) return;
		this.select(selectionOf({ kind: 'worker', worker }, this));
		this.aboard.lookAt(worker.seat);
	}

	// A session's panels docked at the side, opened on `key`; the same session's dock switches to it
	openDock(worker, key) {
		const { session } = worker;

		if (this.dock?.key !== `session:${session.key}`) {
			this.closeDock();
			this.closeCard();

			const card = dockCard({
				session,
				live: live(session),
				open: key,
				onOpen: () => this.open(session),
				onClose: () => this.closeDock(),
			});

			resizable(card);
			this.dock = { card, key: `session:${session.key}` };
			this.stage.elem.append(card);

			return card.opened();
		}

		return this.dock.card.show(key);
	}

	// A panel of a session on this paude; another paude's session opens its reply
	dockOrReply(worker, key) {
		this.select(selectionOf({ kind: 'worker', worker }, this));
		if (worker.session.engine.remote) return this.openReply(worker);
		// Its terminal attached marks it seen on its engine; here at once
		if (key === 'terminal' && this.aboard.needs(worker.session) === 'unread') {
			this.aboard.markRead(worker.session);
			this.paintFocus();
		}

		return this.openDock(worker, key);
	}

	// A session on this paude working in a checkout, the one at work first, for its git
	workerIn(checkout) {
		const working = [...this.aboard.workers.values()].filter(
			({ session }) =>
				!session.engine.remote && session.checkout && `${session.engine.key}:${session.checkout}` === checkout.key,
		);

		return (
			working.find(({ session }) => session.status === 'working') ??
			working.find(({ session }) => session.status !== 'stopped') ??
			working[0]
		);
	}

	closeDock() {
		this.dock?.card.dispose();
		this.dock?.card.remove();
		this.dock = null;
		this.focusPainted = null;
	}

	// A prompt placed as from home: anywhere, or in `project`
	newPrompt(project, anchor) {
		this.openCard(
			promptCard({ project, onSent: () => this.aboard.charge(), onClose: () => this.closeCard() }),
			anchor ?? this.aboard.screen(this.bridgeDoor()),
		);
	}

	bridgeDoor() {
		const bridge = this.aboard.bridge;

		return bridge ? { x: bridge.x + bridge.w / 2, y: bridge.y + bridge.d } : { x: 0, y: 0 };
	}

	async openProject(engine, project) {
		const { body, response } = await openRemote(engine.remote.url, { project });

		if (response?.ok) window.location.href = body.link;
		else
			new Notify({
				intent: 'danger',
				content: refusal(`Could not reach ${engine.name}`, body),
			});
	}

	openCard(card, anchor, { focus = true } = {}) {
		this.closeCard();
		card.dataset.augmentedUi = FRAME.large;
		this.card = { card, anchor };
		this.stage.elem.append(card);
		this.placeCard();
		card.opened?.();
		if (focus) card.querySelector('textarea')?.focus({ preventScroll: true });
	}

	workerOf(session) {
		return session && this.aboard.workers.get(session.key);
	}

	// A checkout's manifest beside its cargo
	openManifest(checkout, point) {
		this.openCard(
			manifestCard({
				title: `${checkout.project}: changes`,
				about: whereWorking(checkout),
				checkout,
				onClose: () => this.closeCard(),
			}),
			point,
		);
	}

	// A system's log beside its console, each use in it opening its session's reply
	openLog({ room, system }, point) {
		this.openCard(
			logCard({
				title: `${titled(room.name)} log`,
				about: `${plural(system.uses ?? 0, 'use')} in the last ten minutes${system.failures ? `, ${system.failures} failed` : ''}`,
				log: system.log ?? [],
				onPick: use => this.workerOf(use.session) && this.openReply(this.workerOf(use.session)),
				onClose: () => this.closeCard(),
			}),
			point,
		);
	}

	// Reading it is seeing it, here and on the engine it runs on
	openReply(worker, { focus = true } = {}) {
		const { session } = worker;

		this.openCard(
			replyCard({
				session,
				onOpen: () => this.open(session),
				onLive: live(session) ? () => this.dockOrReply(worker, 'terminal') : undefined,
				onClose: () => this.closeCard(),
			}),
			worker.screen,
			{ focus },
		);
		this.card.worker = worker;
		this.seen(session);
	}

	seen(session) {
		if (this.aboard.needs(session) !== 'unread') return;

		this.aboard.markRead(session);
		this.paintFocus();
		if (session.engine.remote) markRemoteSeen(session.engine.remote.url, session.id);
		else markSeen(session.id);
	}

	closeCard() {
		this.card?.card.dispose?.();
		this.card?.card.remove();
		this.card = null;
	}

	// Beside what it came from, following it as it moves, kept inside the stage
	placeCard() {
		place(this.cardSpot());
	}

	// Where the card goes, measured before anything's moved, so a frame lays the page out once
	cardSpot() {
		if (!this.card) return null;

		const { card, worker } = this.card;
		const point = worker?.screen ?? this.card.anchor;

		if (!point) return null;

		const { width, height: stage } = this.stageSize ?? this.stage.elem.getBoundingClientRect();
		// Clear of the command bar along the bottom
		const height = stage - (this.command.style.display === 'none' ? 0 : this.command.offsetHeight + 16);
		const box = card.getBoundingClientRect();
		const above = point.y - box.height - 16;
		const top = above >= 8 ? above : Math.min(height - box.height - 8, point.y + 24);

		return {
			elem: card,
			left: `${Math.max(16, Math.min(width - box.width - 16, point.x - box.width / 2))}px`,
			top: `${Math.max(8, top)}px`,
		};
	}

	// The room looked at, whichever way it came to be; nothing while the whole ship, a worker's seat or free roaming is
	focusedRoom() {
		const { aboard } = this;
		const { looking } = aboard;

		// The whole ship has the bridge's panel, where the ship's health, what needs you and starting work are kept
		if (!looking || looking === 'all')
			return aboard.bridge ? { key: 'bridge', kind: 'bridge', room: aboard.bridge } : null;
		if (looking === 'free') return this.roomAtMiddle();

		const bay = aboard.bays.find(({ name }) => name === looking);

		if (bay) return { key: `bay:${bay.name}`, kind: 'bay', room: bay, bay };
		if (looking === BRIDGE && aboard.bridge) return { key: 'bridge', kind: 'bridge', room: aboard.bridge };
		if (looking === LOUNGE && aboard.lounge) return { key: 'lounge', kind: 'lounge', room: aboard.lounge };
		if (aboard.engines.some(({ key }) => key === looking))
			return { key: 'engineering', kind: 'engineering', room: aboard.layout.engineering };

		const room = aboard.roomOf(looking);

		return room?.kind ? { key: `room:${room.kind}:${room.name}`, kind: room.kind, room } : null;
	}

	// Zoomed in by hand, the room in the middle of the screen is the one looked at, once it's close enough to see into
	roomAtMiddle() {
		const { aboard } = this;

		if (aboard.camera.zoom < FOCUS_ZOOM) return null;

		const x = aboard.camera.x / UNIT.x;
		const y = aboard.camera.y / UNIT.y;
		const room = aboard.layout.rooms?.find(
			({ x: left, y: top, w, d }) => x >= left && x <= left + w && y >= top && y <= top + d,
		);

		if (!room) return null;

		const bay = !room.kind && aboard.bays.find(({ name }) => name === room.name);

		if (bay) return { key: `bay:${bay.name}`, kind: 'bay', room: bay, bay };
		if (room.kind === 'bridge') return { key: 'bridge', kind: 'bridge', room: aboard.bridge };
		if (room.kind === 'lounge') return { key: 'lounge', kind: 'lounge', room: aboard.lounge };

		return room.kind ? { key: `room:${room.kind}:${room.name}`, kind: room.kind, room } : null;
	}

	// What the panel beside a room says: the room's facts as its flyout has them, what's in it to pick, and its verbs
	focusOf(focus) {
		const { aboard } = this;
		const { kind, room, bay } = focus;
		const workerItem = worker => {
			const { session } = worker;
			const need = aboard.needs(session);

			return {
				label: session.title || session.project || 'A new session',
				detail: [need ? NEEDS[need] : doing(session), session.tested?.said].filter(Boolean).join(' · '),
				tone: (need === 'asking' && 'warn') || ({ working: 'busy', stopped: 'off' }[session.status] ?? ''),
				run: () => {
					this.select(selectionOf({ kind: 'worker', worker }, this));
					this.openReply(worker);
				},
			};
		};
		const workersIn = keys => keys.map(key => aboard.workers.get(key)).filter(Boolean);

		if (kind === 'bay') {
			const flyout = flyoutOf({ kind: 'bay', bay }, aboard);
			const checkouts = aboard.cargo.filter(({ project }) => project === bay.name);

			return {
				...flyout,
				items: [
					...workersIn(bay.sessions).map(workerItem),
					...checkouts.map(checkout => ({
						label: checkout.branch ?? 'no branch',
						detail: [
							cargoWords(checkout),
							checkout.pullRequest?.state === 'OPEN' &&
								`#${checkout.pullRequest.number} ${checkStatus(checkout.pullRequest)}`,
						]
							.filter(Boolean)
							.join(' · '),
						tone: checkout.pullRequest?.checks?.failing ? 'warn' : '',
						run: () => {
							const worker = this.workerIn(checkout);

							if (worker) this.dockOrReply(worker, 'git');
							else this.openManifest(checkout, this.aboard.screen(bay));
						},
					})),
				],
				commands: this.bayCommands(bay).filter(({ hotkey }) => hotkey !== 'z'),
			};
		}
		if (kind === 'system') {
			const system = aboard.systemOf(room);
			const flyout = flyoutOf({ kind: 'system', room, system }, aboard);

			return {
				...flyout,
				items: (system?.log ?? []).slice(0, 6).map(use => ({
					label: use.detail ?? use.tool,
					detail: [use.failed && 'failed', use.tool, relativeTime(Date.now() - use.ago)].filter(Boolean).join(' · '),
					tone: use.failed ? 'warn' : '',
					run: () => this.workerOf(use.session) && this.openReply(this.workerOf(use.session)),
				})),
				commands: system
					? [{ label: 'Whole log', hotkey: 'l', run: () => this.openLog({ room, system }, this.aboard.screen(room)) }]
					: [],
			};
		}
		if (kind === 'engineering')
			return {
				title: titled(room.name),
				rows: aboard.tanks.map(({ plan, level, rate }) => [
					`fuel${plan ? ` (${plan})` : ''}`,
					`${level === null ? 'size not known yet' : `${Math.round(level * 100)}% left`}, burning ${Math.round(rate / 1000)}k a minute`,
				]),
				items: aboard.engines.map(engine => ({
					label: engine.name,
					detail: [engine.detail, engine.limit && limitWords(engine.limit.resetAt)].filter(Boolean).join(' · '),
					tone: (engine.limit && 'warn') || (engine.busy && 'busy') || '',
					run: () => this.select(selectionOf({ kind: 'engine', engine }, this)),
				})),
				commands: [
					{ label: 'All sessions', hotkey: 'h', run: () => this.openShipDock('sessions') },
					{ label: 'New project', hotkey: 'p', run: () => this.openShipDock('projects') },
					...(identity()?.remotes
						? [{ label: 'Connect a device', hotkey: 'd', run: () => this.openShipDock('devices') }]
						: []),
				],
			};
		if (kind === 'lounge')
			return {
				title: 'Resting',
				rows: [['here', plural(room.sessions.length, 'resting session')]],
				items: workersIn(room.sessions).map(workerItem),
				commands: [{ label: 'All sessions', hotkey: 'h', run: () => this.openShipDock('sessions') }],
			};
		if (kind === 'bridge') {
			const flyout = flyoutOf({ kind: 'bridge', room }, aboard);
			const needed = triage(aboard.sessions, aboard.read)
				.map(({ session }) => aboard.workers.get(session.key))
				.filter(Boolean);
			const watched = aboard.screens
				.map(key => aboard.workers.get(key))
				.filter(worker => worker && !needed.includes(worker));

			return {
				...flyout,
				rows: [
					...this.healthRows(),
					...flyout.rows,
					...this.aboard.fleet.map(ship => [`${ship.name}'s ship`, shipWords(ship)]),
					...this.elsewhereRows(),
				],
				items: [...needed.map(workerItem), ...this.healthItems(), ...watched.map(workerItem)],
				commands: [
					...this.placeCommands('bridge').filter(({ hotkey }) => hotkey !== 'z'),
					{ label: 'New project', hotkey: 'p', run: () => this.openShipDock('projects') },
					{ label: 'Show and hide', hotkey: 'e', run: () => this.openShown() },
					...(this.aboard.layout?.transporter
						? [{ label: 'Transporter', hotkey: 'x', run: () => this.aboard.look('transporter') }]
						: []),
					...(identity()?.remotes
						? [{ label: 'Connect a device', hotkey: 'd', run: () => this.openShipDock('devices') }]
						: []),
				],
			};
		}

		return {
			...flyoutOf({ kind, room }, aboard),
			items:
				(kind === 'transporter' &&
					aboard.fleet.map(ship => ({
						label: `${ship.name}'s ship`,
						detail: shipWords(ship),
						tone: (ship.needs && 'warn') || (ship.working && 'busy') || '',
						run: () => this.travel(ship.key),
					}))) ||
				(kind === 'hold'
					? aboard.cargo.map(checkout => ({
							label: `${checkout.project}: ${checkout.branch ?? 'no branch'}`,
							detail: cargoWords(checkout),
							run: () => {
								const worker = this.workerIn(checkout);

								if (worker) this.dockOrReply(worker, 'git');
							},
						}))
					: []),
			commands: kind === 'materializer' ? this.placeCommands('new') : [],
		};
	}

	// The panel beside the room looked at, painted when the room or what's in it changes
	paintFocus() {
		const focus = this.dock ? null : this.focusedRoom();

		this.focused = focus;
		if (!focus) {
			this.focus.style.display = 'none';
			this.focusCommands = [];
			this.focusPainted = null;

			return;
		}

		// Too narrow a window to keep the bridge's panel beside the whole ship without shrinking it: a summary in the
		// corner, opened by pressing it, folded again from the open panel
		const whole = !this.aboard.looking || this.aboard.looking === 'all';
		const tight = whole && focus.kind === 'bridge' && this.aboard.tight;

		this.paintedTight = this.aboard.tight;
		if (tight && !this.bridgeOpen) return this.paintSummary(focus);

		const { title, rows = [], items = [], commands = [], hue } = this.focusOf(focus);
		const painted = JSON.stringify([
			tight,
			focus.key,
			title,
			rows,
			items.map(({ label, detail, tone }) => [label, detail, tone]),
			commands.map(({ label }) => label),
		]);

		this.focusCommands = commands;
		if (painted === this.focusPainted) return;
		this.focusPainted = painted;

		const table = element('div', 'rows');

		for (const row of rows.filter(Boolean)) table.append(element('span', 'key', row[0]), element('span', '', row[1]));

		const list = element('div', 'items');

		for (const { label, detail, tone, run } of items) {
			const item = element('button', `item${tone ? ` ${tone}` : ''}`);

			item.append(element('span', 'label', label), element('span', 'detail', detail || ''));
			item.addEventListener('click', run);
			list.append(item);
		}

		const verbs = element('div', 'verbs');

		for (const { label, hotkey, run } of commands) {
			const press = element('button');

			press.append(element('kbd', '', hotkey), document.createTextNode(label));
			press.addEventListener('click', run);
			verbs.append(press);
		}
		const heading = element('strong', 'title', title);

		tone(this.focus, heading, hue);
		this.focus.classList.remove('folded');

		if (tight)
			heading.append(
				button('', () => ((this.bridgeOpen = false), this.paintFocus()), {
					icon: 'compress',
					title: 'Fold to a summary',
					className: 'icon-only variant-flat fold',
				}),
			);
		this.focus.replaceChildren(heading, table, ...(items.length ? [list] : []), ...(commands.length ? [verbs] : []));
		this.focus.style.display = '';
		this.paintCommand();
	}

	// The bridge's panel folded to a line: its health at a glance, pressed to open
	paintSummary(focus) {
		const { aboard } = this;
		const needs = triage(aboard.sessions, aboard.read).length;
		const working = aboard.sessions.filter(({ status }) => status === 'working').length;
		const line = [
			...this.healthRows()
				.filter(([key]) => key === 'fuel')
				.map(([, value]) => `fuel ${value}`),
			`${working} working`,
			needs ? `${needs} need${needs === 1 ? 's' : ''} you` : 'nothing needs you',
		].join(' · ');
		const painted = JSON.stringify(['summary', focus.key, line]);

		this.focused = focus;
		this.focusCommands = [];
		if (painted === this.focusPainted) return;
		this.focusPainted = painted;

		const open = element('button', 'summary');

		open.append(element('strong', 'title', 'Bridge'), element('span', 'line', line));
		open.title = 'Open the bridge';
		open.addEventListener('click', () => ((this.bridgeOpen = true), this.paintFocus()));
		this.focus.replaceChildren(open);
		this.focus.classList.add('folded');
		this.focus.style.display = '';
	}

	// Against the room's right edge, following it as the camera moves, inside the stage
	focusSpot() {
		const focus = this.dock ? null : this.focusedRoom();

		if ((focus?.key ?? null) !== (this.focused?.key ?? null) || this.aboard.tight !== this.paintedTight)
			this.paintFocus();
		if (!this.focused) return null;

		const area = this.aboard.area(this.focused.room);
		const { width, height } = this.stageSize ?? this.stage.elem.getBoundingClientRect();
		const box = this.focus.getBoundingClientRect();
		const whole = !this.aboard.looking || this.aboard.looking === 'all';
		// For the whole ship, at the screen's right edge in the room left for it; for a room, beside it
		const left = whole ? width - box.width - 12 : Math.min(width - box.width - 12, Math.max(12, area.right + 12));
		// Folded, in the top corner, clear of the ship
		const folded = this.focus.classList.contains('folded');
		const top = Math.min(height - box.height - 12, Math.max(52, area.top));

		return { elem: this.focus, left: `${Math.round(left)}px`, top: `${Math.round(folded ? 12 : top)}px` };
	}

	// The ship's health, for the bridge's panel: fuel, what's at work, what needs you, and how far it has come
	healthRows() {
		const { aboard } = this;
		const sessions = aboard.sessions;
		const needs = triage(sessions, aboard.read).length;
		const tanks = aboard.tanks.map(
			({ level, plan, unknown, engines }) =>
				(unknown && `${engines.map(({ name }) => name).join('/')} ?`) ||
				(level === null ? `${plan ?? 'fuel'} ?` : `${Math.round(level * 100)}%`),
		);

		return [
			tanks.length && ['fuel', tanks.join(' · ')],
			['working', String(sessions.filter(({ status }) => status === 'working').length)],
			['needs you', needs ? String(needs) : 'nothing'],
			['delivered', `${aboard.journey?.distance ?? 0} (a reply 1, an artifact 2, a pushed commit 5)`],
		].filter(Boolean);
	}

	// What's failing its tests, waiting to be pushed or in review, each going where it's dealt with
	healthItems() {
		const { aboard } = this;
		const failing = aboard.bays.filter(
			bay => Ship.worstVerdict(bay.sessions.map(key => aboard.workers.get(key)?.session).filter(Boolean)) === 'failing',
		);
		const git = checkout => () => {
			const worker = this.workerIn(checkout);

			if (worker) this.dockOrReply(worker, 'git');
		};

		return [
			...failing.map(bay => ({
				label: `${bay.name}: failing tests`,
				detail: 'the latest run failed',
				tone: 'warn',
				run: () => {
					this.select(selectionOf({ kind: 'bay', bay }, this));
					this.aboard.look(bay.name);
				},
			})),
			...aboard.cargo
				.filter(({ unpushed }) => unpushed > 0)
				.map(checkout => ({
					label: `${checkout.project}: to push`,
					detail: cargoWords(checkout),
					run: git(checkout),
				})),
			...aboard.cargo
				.filter(({ pullRequest }) => pullRequest?.state === 'OPEN')
				.map(checkout => ({
					label: `${checkout.project}: in review`,
					detail: `#${checkout.pullRequest.number} ${checkout.pullRequest.title ?? ''}`.trim(),
					run: git(checkout),
				})),
		];
	}

	// The paudes logged into but out of reach, or too old to show everything
	elsewhereRows() {
		return [
			...this.aboard.unseen.map(engine => [engine.name, engine.detail]),
			...this.aboard.engines
				.filter(({ older }) => older)
				.map(engine => [engine.name, 'an older paude; update it there to see everything']),
		];
	}

	async open(session) {
		const { remote } = session.engine;

		if (!remote) {
			window.location.hash = `#/sessions/${session.id}`;

			return;
		}

		const { body, response } = await openRemote(remote.url, { sessionId: session.id });

		if (response?.ok) window.location.href = body.link;
		else
			new Notify({
				intent: 'danger',
				content: refusal(`Could not reach ${remote.name}`, body),
			});
	}

	async findRemotes() {
		// Not yet known who's looking, or a server mid-restart answering with an error: asked again shortly, waiting twice
		// as long each time it still doesn't come, up to REMOTES_MS
		const again = () => {
			if (this.retrying) return;
			this.retryMs = Math.min(REMOTES_MS, this.retryMs ? this.retryMs * 2 : REMOTES_RETRY_MS);
			this.retrying = setTimeout(() => {
				this.retrying = null;
				this.findRemotes();
			}, this.retryMs);
		};

		if (!identity()) return again();
		if (!identity().remotes) return;

		const { body } = await getRemotes().catch(() => ({}));

		if (!Array.isArray(body)) return again();
		this.retryMs = 0;
		setServers(body);
	}

	// Each engine's universe; one that can't be reached, or is too old to say, adds nothing until it answers
	async poll() {
		if (this.polling || document.hidden) return;
		this.polling = true;

		try {
			const remotes = this.remotes ?? [];
			const [local, ...elsewhere] = await Promise.all([
				getUniverse(),
				...remotes.map(remote =>
					remote.error || this.sealed.get(remote.url) > Date.now() ? null : timed(getRemoteUniverse(remote.url)),
				),
			]);

			this.answers = [
				{ key: LOCAL, ...local.body, name: localName(), hue: hueOf(localName()) },
				...remotes.map((remote, index) => {
					const asked = elsewhere[index];
					const answered = asked?.response?.ok ? asked.body : null;

					if (answered) this.sealed.delete(remote.url);
					else if (asked) this.sealed.set(remote.url, Date.now() + REMOTES_MS);

					return {
						...(answered ?? (remote.error ? {} : olderPaude(remote))),
						// After what it answered, so no answer can claim to be another paude (this one, say)
						key: remote.url,
						name: remote.name,
						hue: hueOf(remote.name),
						remote: { url: remote.url, name: remote.name },
						error: remote.error,
						latency: answered ? asked.latency : null,
					};
				}),
			];
			this.updateShips();
			this.focusOpened();
			this.refreshSelection();
			this.paintFocus();
		} finally {
			this.polling = false;
		}
	}
}
