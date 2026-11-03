import { Elem, Notify, View, styled } from '@vanilla-bean/components';
import { relativeTime } from '@vanilla-bean/components/utils/date';

import { getRemotes, getRemoteUniverse, getUniverse, markRemoteSeen, markSeen, openRemote } from '../api';
import { Bar } from '../Bar';
import { breadcrumbs } from '../Breadcrumbs';
import { button, element } from '../dom';
import { assignShip, hiddenNow, shipsAssigned, shipsOf, shownOf, toggleHidden } from './shown';
import { identity, serverName } from '../identity';
import { hueOf, onServersChange, setServers } from '../servers';
import { facilitiesFor, facilityOf } from '../../shared/facilities';
import { openMenu } from '../menu';
import { sessionMenu } from '../sessionActions';
import olderPaude from './olderPaude';
import { VERBS, dockCard } from './dock';
import { devicesPane, foldersPane, listDock, projectPanes, projectsPane, sessionsPane, shownPane } from './shipDock';
import refusal from './reason';
import { logCard, manifestCard, promptCard, replyCard } from './replyCard';
import Scene, { BEAM_SECONDS, BRIDGE, LOUNGE, triage } from './scene';
import { UNIT } from './station';

// Panels framed as void-driller frames them, corners cut by augmented-ui
const FRAME = { large: 'tl-clip tr-2-clip-x br-clip bl-2-clip-y border', small: 'tl-clip br-clip border' };

const POLL_MS = 2000;
// How wide the panel beside a room looked at is, in screen pixels
const FOCUS_WIDTH = 320;
// How far in a zoom by hand has to be for the room in the middle to have its panel
const FOCUS_ZOOM = 4;
const HOLD_MS = 550;
const REMOTES_MS = 60_000;
// How soon to ask again when the list of other paudes didn't come back
const REMOTES_RETRY_MS = 5000;
// A frame after a long pause (a hidden tab) moves things on by this much at most
const LONGEST_FRAME_S = 0.1;
// Moved further than this between press and release, the press was a drag
const DRAG_PX = 5;
const WHEEL_ZOOM = 0.0015;

const STATUS = { working: 'working', waiting: 'needs you', ready: 'ready for a prompt', stopped: 'stopped' };

const Stage = styled(
	Elem,
	({ colors, space, radius }) => `
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		background: #07090f;

		canvas {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			touch-action: none;
			image-rendering: pixelated;
		}

		canvas.dragging {
			cursor: grabbing;
		}

		canvas.pointing {
			cursor: pointer;
		}

		.tip {
			position: absolute;
			z-index: 1;
			max-width: min(320px, calc(100% - 32px));
			padding: ${space.sm} ${space.md};
			background: ${colors.alpha(colors.black, 0.9)};
			--aug-tl1: 6px;
			--aug-br1: 6px;
			--aug-border-all: 2px;
			--aug-border-bg: ${colors.light(colors.teal)};
			pointer-events: none;
			font-size: 0.85em;
		}

		.tip .rows {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: 0 ${space.sm};
			margin: 2px 0;
		}

		.tip .key {
			color: ${colors.light(colors.teal)};
			text-transform: uppercase;
			font-size: 0.85em;
		}

		.tip .about {
			color: ${colors.muted};
		}

		.reply-card {
			position: absolute;
			z-index: 2;
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
			width: min(380px, calc(100% - 32px));
			max-height: min(60%, 520px);
			/* Clear of the cut corners */
			padding: calc(14px + ${space.xs}) calc(14px + ${space.sm});
			border: none;
			border-radius: 0;
			background: ${colors.surface};
			--aug-tl1: 14px;
			--aug-tr1: 14px;
			--aug-tr2: 14px;
			--aug-br1: 14px;
			--aug-bl1: 14px;
			--aug-bl2: 14px;
			--aug-border-all: 2px;
			--aug-border-bg: ${colors.light(colors.teal)};
		}

		.reply-card .head {
			display: flex;
			align-items: flex-start;
			gap: ${space.sm};
		}

		.reply-card .titles {
			flex: 1;
			min-width: 0;
		}

		.reply-card .titles strong {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.reply-card .about {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.reply-card .asked {
			padding-left: ${space.sm};
			border-left: 2px solid ${colors.teal};
			color: ${colors.muted};
			font-size: 0.85em;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.reply-card .reply {
			flex: 1 1 auto;
			min-height: 0;
			overflow: auto;
			overflow-wrap: anywhere;
			font-size: 0.9em;
		}

		.reply-card .reply pre {
			overflow: auto;
		}

		.reply-card .answer {
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
		}

		.reply-card textarea {
			resize: vertical;
			font: inherit;
		}

		.reply-card .actions {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			gap: ${space.sm};
		}

		.docked-terminal {
			display: flex;
			flex-direction: column;
			gap: ${space.xs};
		}

		.docked-terminal .about {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		/* The terminal see-through over a tint dark enough to read it by, the glass showing past its rows; sized to fit,
		   so no scrollbars */
		.docked-terminal .screen {
			flex: 1;
			min-height: 0;
			overflow: hidden;
			padding: 2px;
		}

		.docked-terminal .xterm {
			background: ${colors.alpha(colors.black, 0.5)};
		}

		.docked-terminal .xterm-viewport {
			background-color: transparent !important;
			scrollbar-width: none;
		}

		.docked-terminal .xterm-viewport::-webkit-scrollbar {
			display: none;
		}

		/* As wide as the session's columns draw, in the flow of the screen that scrolls it: held to a box of its own it
		   drew a narrow strip of the session's lines */
		.dock .docked-terminal .screen > .xterm {
			position: relative;
			display: block;
			width: max-content;
			height: max-content;
		}

		.reply-card .log {
			display: grid;
			gap: 2px;
			max-height: 50vh;
			overflow-y: auto;
		}

		.reply-card .log .use {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			column-gap: ${space.sm};
			padding: ${space.xs} ${space.sm};
			border: 0;
			border-left: 2px solid transparent;
			background: none;
			color: inherit;
			font: inherit;
			text-align: left;
			cursor: pointer;
		}

		.reply-card .log .use:hover:not(:disabled) {
			background: ${colors.alpha(colors.white, 0.06)};
		}

		.reply-card .log .use:disabled {
			cursor: default;
		}

		.reply-card .log .use.failed {
			border-left-color: ${colors.danger};
		}

		.reply-card .log .when {
			color: ${colors.muted};
			white-space: nowrap;
		}

		.reply-card .log .what {
			grid-column: 1 / -1;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: ${colors.muted};
		}

		.dock {
			position: absolute;
			z-index: 3;
			top: 12px;
			right: 16px;
			bottom: 72px;
			display: flex;
			flex-direction: column;
			gap: ${space.xs};
			width: min(620px, calc(100% - 32px));
			/* A width chosen on a wider window still leaves the grip on screen */
			max-width: calc(100% - 32px);
			padding: ${space.md} ${space.md} ${space.sm};
			box-sizing: border-box;
			/* Glass over the ship, as the session page's panels float over its terminal */
			border: 1px solid ${colors.border};
			border-radius: ${radius.lg};
			/* Light enough to see the stars and the ship through, blurred only a little */
			background: ${colors.alpha(colors.black, 0.18)};
			backdrop-filter: blur(3px) saturate(140%);
			-webkit-backdrop-filter: blur(3px) saturate(140%);
			box-shadow: 0 8px 32px ${colors.alpha(colors.vantablack, 0.45)};
			overflow: hidden;
		}

		.dock > .grip {
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			width: 7px;
			cursor: ew-resize;
			touch-action: none;
		}

		.dock > .grip:hover {
			background: ${colors.alpha(colors.light(colors.teal), 0.25)};
		}

		.dock > .head {
			display: flex;
			align-items: flex-start;
			gap: ${space.sm};
		}

		.dock > .head .titles {
			flex: 1;
			min-width: 0;
		}

		.dock > .head .titles strong {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.dock > .head .about {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.dock > .tabs {
			display: flex;
			flex-wrap: wrap;
			gap: 2px;
		}

		.dock > .tabs button {
			padding: 2px ${space.sm};
			font-size: 0.85em;
		}

		.dock > .tabs button.active {
			background: ${colors.alpha(colors.light(colors.teal), 0.2)};
			color: ${colors.light(colors.teal)};
		}

		.dock > .body {
			position: relative;
			flex: 1;
			min-height: 0;
		}

		.dock > .body > * {
			position: absolute;
			inset: 0;
		}

		.dock > .body > [hidden] {
			display: none;
		}

		.focus .summary {
			display: flex;
			flex-direction: column;
			gap: 2px;
			padding: 0;
			border: none;
			background: none;
			color: inherit;
			font: inherit;
			text-align: left;
			cursor: pointer;
		}

		.focus.folded {
			width: auto;
			max-width: calc(100% - 24px);
		}

		.focus .summary .line {
			white-space: nowrap;
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.focus .title .fold {
			float: right;
		}

		.focus {
			position: absolute;
			z-index: 2;
			display: flex;
			flex-direction: column;
			gap: ${space.xs};
			width: ${FOCUS_WIDTH}px;
			max-height: calc(100% - 64px);
			overflow-y: auto;
			padding: calc(12px + ${space.xs}) calc(10px + ${space.sm});
			box-sizing: border-box;
			background: #151920;
			--aug-tl1: 12px;
			--aug-tr1: 12px;
			--aug-tr2: 12px;
			--aug-br1: 12px;
			--aug-bl1: 12px;
			--aug-bl2: 12px;
			--aug-border-all: 2px;
			--aug-border-bg: ${colors.light(colors.teal)};
			font-size: 0.85em;
		}

		.focus .rows {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: 0 ${space.sm};
		}

		.focus .key {
			color: ${colors.light(colors.teal)};
			text-transform: uppercase;
			font-size: 0.85em;
		}

		.focus .items {
			display: flex;
			flex-direction: column;
			gap: 2px;
			margin-top: ${space.xs};
		}

		.focus .item {
			display: flex;
			flex-direction: column;
			padding: 2px ${space.sm};
			border: none;
			border-left: 2px solid ${colors.alpha(colors.white, 0.2)};
			background: none;
			color: inherit;
			font: inherit;
			text-align: left;
			cursor: pointer;
		}

		.focus .item:hover {
			background: ${colors.alpha(colors.white, 0.06)};
		}

		.focus .item.busy {
			border-left-color: ${colors.teal};
		}

		.focus .item.warn {
			border-left-color: ${colors.light(colors.warning)};
		}

		.focus .item.off {
			opacity: 0.7;
		}

		.focus .item .detail {
			color: ${colors.muted};
			font-size: 0.9em;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.focus .verbs {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
			margin-top: ${space.xs};
		}

		.focus .verbs button {
			display: flex;
			align-items: center;
			gap: 4px;
			padding: 2px ${space.sm};
			border: 1px solid ${colors.alpha(colors.light(colors.teal), 0.35)};
			border-radius: 0;
			background: none;
			color: inherit;
			font: inherit;
			cursor: pointer;
		}

		.focus .verbs button:hover {
			border-color: ${colors.light(colors.teal)};
		}

		.focus kbd {
			color: ${colors.light(colors.teal)};
			font: inherit;
			font-size: 0.85em;
			text-transform: uppercase;
		}

		/* While the command bar's keys are the ones that work, the panel's buttons still press, their keys dimmed */
		.focus.keys-on-bar kbd {
			opacity: 0.3;
		}

		.projects-list {
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.projects-list .project-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			column-gap: ${space.sm};
			padding: ${space.xs} ${space.sm};
			border-left: 2px solid ${colors.alpha(colors.light(colors.teal), 0.4)};
		}

		.projects-list .project-row .about {
			grid-column: 1;
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.projects-list .project-row.off strong {
			color: ${colors.muted};
			text-decoration: line-through;
		}

		.projects-list .project-row button {
			grid-column: 2;
			grid-row: 1 / span 2;
		}

		.dock > .body > .scrolling {
			overflow-y: auto;
		}

		.command {
			position: absolute;
			z-index: 2;
			left: 50%;
			bottom: 12px;
			transform: translateX(-50%);
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: center;
			gap: 4px ${space.sm};
			max-width: calc(100% - 32px);
			padding: ${space.xs} calc(10px + ${space.sm});
			background: ${colors.alpha(colors.black, 0.85)};
			--aug-tl1: 8px;
			--aug-br1: 8px;
			--aug-border-all: 1px;
			--aug-border-bg: ${colors.light(colors.teal)};
		}

		.command .who {
			display: flex;
			flex-direction: column;
			min-width: 0;
			max-width: 260px;
			margin-right: ${space.sm};
		}

		.command .who strong {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.command .who span {
			color: ${colors.muted};
			font-size: 0.8em;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.command button {
			display: flex;
			align-items: center;
			gap: 4px;
			padding: 2px ${space.sm};
			border: 1px solid ${colors.alpha(colors.light(colors.teal), 0.35)};
			border-radius: 0;
			background: none;
			color: inherit;
			font: inherit;
			font-size: 0.85em;
			cursor: pointer;
		}

		.command button:hover {
			border-color: ${colors.light(colors.teal)};
		}

		.command kbd {
			color: ${colors.light(colors.teal)};
			font: inherit;
			font-size: 0.8em;
			text-transform: uppercase;
		}
	`,
);

const hereName = () => serverName() ?? 'this machine';

// Moved to its spot ({ elem, left, top }), touching its style only when it moves
const place = spot => {
	if (spot && spot.elem.style.left !== spot.left) spot.elem.style.left = spot.left;
	if (spot && spot.elem.style.top !== spot.top) spot.elem.style.top = spot.top;
};

const titled = name => name.charAt(0).toUpperCase() + name.slice(1);

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
			about: [worker.session.project, worker.session.server.name, STATUS[worker.session.status]]
				.filter(Boolean)
				.join(' · '),
		};

	const bay = (target?.kind === 'bay' || target?.kind === 'cargo') && target.bay;

	if (bay)
		return {
			bay,
			title: bay.name,
			about: `${plural(bay.sessions.length, 'session')} · ${bay.servers.map(({ name }) => name).join(', ')}`,
		};
	if (target?.kind === 'bridge')
		return { place: 'bridge', title: 'Bridge', about: 'every session aboard, and the projects they work in' };
	if (target?.kind === 'cloner' || target?.kind === 'materializer')
		return { place: 'new', title: 'New sessions', about: 'a prompt, or a new project to start in' };
	if (target?.kind === 'machine')
		return { machine: target.machine, title: target.machine.name, about: target.machine.detail };

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
	(selected?.machine && `machine:${selected.machine.key}`) ||
	(selected?.place && `room:${selected.place}`) ||
	null;

// An answer, and how long it took to come
const timed = async asking => {
	const start = performance.now();
	const answer = await asking;

	return { ...answer, latency: Math.round(performance.now() - start) };
};

const NEEDS = { asking: 'needs you', unread: 'has something new' };

// What's going on aboard another ship, in a few words
const shipWords = ({ needs, news, working }) =>
	[needs && `${needs} need${needs === 1 ? 's' : ''} you`, news && `${news} new`, working && `${working} working`]
		.filter(Boolean)
		.join(' · ') || 'quiet';

const doing = ({ status, tool }) => {
	if (status !== 'working') return STATUS[status];
	if (!tool) return 'thinking';

	const facility = facilitiesFor([tool]).find(({ key }) => key === facilityOf(tool));

	return `${facility?.about ?? 'working'} (${tool})`;
};

const LANGUAGE_NAMES = {
	js: 'JavaScript',
	python: 'Python',
	rust: 'Rust',
	go: 'Go',
	jvm: 'Java/Kotlin',
	c: 'C/C++',
	ruby: 'Ruby',
	php: 'PHP',
	dotnet: '.NET',
	swift: 'Swift',
	shell: 'shell',
	web: 'HTML/CSS',
	docs: 'prose',
	data: 'data',
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const clock = time => new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const limitWords = resetAt => (resetAt ? `resets at ${clock(resetAt)}` : "Claude didn't say when it resets");

const lasted = age => {
	const minutes = Math.round(age / 60_000);

	return minutes < 60 ? plural(minutes, 'minute') : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const whereWorking = checkout =>
	`${checkout.branch ?? 'no branch'}${checkout.trunk ? ' (the trunk)' : ''}${checkout.worktree ? `, a worktree at ${checkout.root}` : ''}`;

// What the ship's other rooms are for, as their flyouts say
const ROOMS = {
	engineering: scene =>
		`a reactor for each machine: ${scene.machines.map(({ name, detail }) => `${name}, ${detail}`).join('; ')}`,
	materializer: scene =>
		scene.charged ? 'a new session is on its way' : 'where new sessions start; press it to write a prompt',
	hold: scene => `each checkout's changes and commits not pushed: ${plural(scene.cargo.length, 'checkout')}`,
	hangar: () => 'pushes leaving, and pull requests waiting for review',
};

const MODES = {
	plan: 'planning, changing nothing',
	acceptEdits: 'edits go ahead unasked',
	bypassPermissions: 'asks nothing before it acts',
	dontAsk: 'asks nothing before it acts',
};

const todoWords = todos => {
	const done = todos.filter(({ status }) => status === 'completed').length;
	const now = todos.find(({ status }) => status === 'in_progress');

	return `${done} of ${todos.length} done${now ? ` · now ${now.text}` : ''}`;
};

// A session whose terminal can be opened here: running, on this server
const live = session => !session.server.remote && session.status !== 'stopped' && Boolean(session.screen);

// A pull request's checks in a few words
const checkStatus = ({ draft, checks: { passing = 0, failing = 0, pending = 0 } = {} }) =>
	(draft && 'draft') ||
	(failing && `${failing} check${failing === 1 ? '' : 's'} failing`) ||
	(pending && 'checks running') ||
	(passing && 'checks pass') ||
	'no checks';

const cargoWords = ({ changed, unpushed }) =>
	[changed && `${plural(changed, 'file')} changed`, unpushed && `${plural(unpushed, 'commit')} to push`]
		.filter(Boolean)
		.join(' · ') || 'all shipped';

// What a flyout says about what's under the pointer: a title, rows of what it is, and what pressing it does
const flyoutOf = (target, scene) => {
	const looking = scene.looking;

	if (target.kind === 'transporter')
		return {
			title: 'Transporter',
			rows: scene.fleet.map(ship => [ship.name, shipWords(ship)]),
			hint: 'Hears from the other ships; press to beam over to one',
		};

	if (target.kind === 'worker') {
		const { session } = target.worker;
		const { context } = session;
		const checkout = scene.checkoutOf(session);
		const watchers = [...scene.walkers.values()]
			.filter(({ person }) => person.sessions.includes(session.key))
			.map(({ name }) => name);

		return {
			title: session.title || session.project || 'A new session',
			rows: [
				['doing', doing(session)],
				['where', [session.project, session.server.name].filter(Boolean).join(' on ')],
				context && [
					'context',
					`${Math.round(context.fill * 100)}% of ${Math.round(context.window / 1000)}k${context.fill >= 0.75 ? ', getting full' : ''}`,
				],
				session.limit && ['usage limit', limitWords(session.limit.resetAt)],
				session.todos?.length && ['todos', todoWords(session.todos)],
				session.agents && ['subagents', `${session.agents} out`],
				session.faults && ['failed', `${plural(session.faults, 'tool')} this turn`],
				MODES[session.mode] && ['mode', MODES[session.mode]],
				context?.model && ['model', context.model],
				context?.warm === false && session.status !== 'stopped' && ['cache', 'gone cold: its next turn costs more'],
				session.status === 'working' && session.turnAge && ['this turn', lasted(session.turnAge)],
				session.age && ['running', lasted(session.age)],
				checkout && ['branch', whereWorking(checkout)],
				checkout && ['changes', cargoWords(checkout)],
				session.assets && ['made', plural(session.assets, 'file')],
				watchers.length && ['watched by', watchers.join(', ')],
			],
			hint: 'Press to select and read it · its keys along the bottom · right-click or hold for orders',
		};
	}
	if (target.kind === 'monitor') {
		const { session } = target.worker;

		return {
			title: session.title || session.project || 'A new session',
			rows: [['screen', live(session) ? 'its terminal, as it is now' : 'not running here']],
			hint: live(session) ? 'Press to open its terminal here' : 'Press to read its last reply',
		};
	}
	if (target.kind === 'use') {
		const { use, room } = target;

		return {
			title: use.detail ?? use.tool,
			rows: [
				['by', use.session ? use.session.title || use.session.project : 'a session no longer aboard'],
				['tool', `${use.tool}${use.failed ? ', which failed' : ''}`],
				['when', relativeTime(Date.now() - use.ago)],
			],
			hint: use.session ? `Press to read its session · from ${room.name}` : `From ${room.name}`,
		};
	}
	if (target.kind === 'log') {
		const { system, room } = target;

		return {
			title: `${titled(room.name)} log`,
			rows: [['lately', plural(system.uses ?? 0, 'use')], system.failures && ['failed', `${system.failures} of them`]],
			hint: 'Press to see what it was used on',
		};
	}
	if (target.kind === 'link') {
		const { machine } = target;

		return {
			title: `Connection to ${machine.name}`,
			rows: [['answers in', machine.link === null ? 'no answer' : `${machine.link} ms`]],
		};
	}
	if (target.kind === 'processes') {
		const { processes = [], services = [], title, project } = target.worker.session;
		const megabytes = bytes => `${Math.round((bytes ?? 0) / 1e6)} MB`;

		return {
			title: `What ${title || project} runs`,
			rows: [
				...processes.map(({ command, cpuSeconds, memoryBytes }) => [
					command,
					`${Math.round(cpuSeconds ?? 0)}s of CPU, ${megabytes(memoryBytes)}`,
				]),
				...services.map(({ name, port }) => ['shared', `port ${port} as ${name}`]),
			],
			hint: 'Press for its ports and processes',
		};
	}
	if (target.kind === 'delivery') {
		const { pullRequest, branch } = target.checkout;
		const { passing, failing, pending } = pullRequest.checks;

		return {
			title: `#${pullRequest.number} ${pullRequest.title}`,
			rows: [
				['branch', branch],
				['state', pullRequest.draft ? 'a draft' : 'waiting for sign-off'],
				['checks', `${passing} passing, ${failing} failing, ${pending} running`],
			],
			hint: 'Press to review it',
		};
	}
	if (target.kind === 'crew') {
		const { busy, lately } = target.crew;
		const done = Object.entries(lately);

		return {
			title: "paude's own jobs",
			rows: [
				['now', busy.length ? busy.join(', ') : 'nothing'],
				['last hour', done.length ? done.map(([job, count]) => `${job} ${count}`).join(', ') : 'nothing'],
			],
			hint: "paude's own helpers, on your Claude login: they draw on the same fuel",
		};
	}
	if (target.kind === 'talk') {
		const { session } = target;

		return {
			title: `Said in ${session.title || session.project}`,
			rows: (session.talk?.lately ?? []).map(({ author, text, fromClaude, toClaude }) => [
				fromClaude ? 'Claude' : author,
				`${text}${toClaude ? ' (to Claude)' : ''}`,
			]),
			hint: 'Press for the chat',
		};
	}
	if (target.kind === 'journey') {
		const { journey } = target;

		return {
			title: `Delivered: ${journey.distance}`,
			rows: [
				[
					'delivered',
					`${journey.replies} ${journey.replies === 1 ? 'reply' : 'replies'}, ${plural(journey.commits, 'commit')} pushed, ${plural(journey.artifacts, 'artifact')}`,
				],
				['last hour', `${journey.lately} further`],
			],
			hint: 'A reply counts one, an artifact two, a pushed commit five',
		};
	}
	if (target.kind === 'inspection') {
		const { bay, sessions } = target;

		return {
			title: `${bay.name}: tested?`,
			rows: sessions.length
				? sessions.map(session => [
						session.title || session.project,
						session.tested?.said ?? 'nothing changed or tested yet',
					])
				: [['now', 'nobody at work here']],
			hint: "From each session's test runs, against when each file it changed last changed",
		};
	}
	if (target.kind === 'fuel' && target.tank.unknown)
		return {
			title: 'Fuel: not known',
			rows: [
				['feeds', target.tank.machines.map(({ name }) => name).join(', ')],
				['account', 'not said: older paudes; update them there to see which account each runs on'],
			],
			hint: "One tank for every machine that doesn't say which account it runs on",
		};
	if (target.kind === 'fuel') {
		const { tank } = target;
		const tokens = count => (count >= 1e6 ? `${(count / 1e6).toFixed(1)}M` : `${Math.round(count / 1000)}k`);

		return {
			title: tank.plan ? `Fuel: ${tank.plan}` : 'Fuel',
			rows: [
				['feeds', tank.machines.map(({ name }) => name).join(', ')],
				['burned', `${tokens(tank.burned)} in the last five hours`],
				['burning', `${tokens(tank.rate)} a minute`],
				[
					'left',
					(tank.empty && 'none: a usage limit is in force') ||
						(tank.level === null
							? 'not known until a limit is first hit, which measures the tank'
							: `about ${Math.round(tank.level * 100)}%, against the tank measured ${lasted(tank.capacityAgo)} ago`),
				],
			],
			hint: 'Tokens as input-token equivalents; the level is an estimate',
		};
	}
	if (target.kind === 'subagent') {
		const { session, task } = target;

		return {
			title: task || 'A subagent',
			rows: [['sent by', session.title || session.project]],
			hint: 'Press for its tasks',
		};
	}
	if (target.kind === 'commit') {
		const { commit, checkout } = target;

		return {
			title: commit.subject,
			rows: [
				['commit', commit.short],
				['branch', whereWorking(checkout)],
			],
			hint: 'Not pushed yet · press for its changes',
		};
	}
	if (target.kind === 'cargo') {
		const { checkout } = target;

		return {
			title: `${checkout.project}: changes`,
			rows: [
				['changed', plural(checkout.changed, 'file')],
				['to push', plural(checkout.unpushed, 'commit')],
				['branch', whereWorking(checkout)],
				['checkout', `${checkout.root} on ${checkout.server}`],
			],
			hint: 'Press for its changes, to commit and push',
		};
	}
	if (target.kind === 'person') {
		const { name, role, sessions } = target.person;

		return {
			title: name,
			rows: [
				['role', role],
				['watching', plural(sessions.length, 'session')],
			],
		};
	}
	if (target.kind === 'cloner')
		return {
			title: 'New sessions',
			rows: [
				['for', 'a new prompt: paude finds the session it carries on, or the project to start one in'],
				scene.charged && ['now', 'waiting for the new session'],
			],
			hint: 'Press to write one',
		};
	if (target.kind === 'bridge') {
		const people = [...scene.walkers.values()].map(({ name }) => name);

		return {
			title: 'Bridge',
			rows: [
				['aboard', people.join(', ') || 'nobody'],
				['watched', plural(scene.screens.length, 'session')],
			],
			hint: looking === BRIDGE ? 'Press to see everything' : 'Press to look closer',
		};
	}
	if (target.kind === 'lounge')
		return {
			title: 'Resting',
			rows: [['resting', plural(target.room.sessions.length, 'session')]],
			hint: `${looking === LOUNGE ? 'Press to see everything' : 'Press to look closer'} · each wakes, or goes, from its orders`,
		};
	if (target.kind === 'system') {
		const { system, room } = target;
		const lookHint = room && (looking === room.name ? 'Press to see everything' : 'Press to look closer');

		if (!system) return { title: titled(room.name), rows: [['now', 'not used on any machine yet']], hint: lookHint };

		return {
			title: system.key.startsWith('mcp:') ? `${system.word} (MCP)` : titled(room?.name ?? system.label),
			rows: [
				['for', system.about],
				['now', system.active ? system.users.map(({ title, project }) => title || project).join(', ') : 'not in use'],
				['lately', `${plural(system.uses, 'use')} in the last ten minutes`],
				system.machines.length > 1 && [
					'by machine',
					system.machines.map(({ name, uses }) => `${name} ${uses}`).join(', '),
				],
				system.failures && ['failed', `${system.failures} of them`],
			],
			hint: lookHint,
		};
	}
	if (ROOMS[target.kind])
		return {
			title: titled(target.room.name),
			rows: [['for', ROOMS[target.kind](scene)]],
			hint: looking === target.room.name ? 'Press to see everything' : 'Press to look closer',
		};
	if (target.kind === 'machine') {
		const { machine } = target;

		return {
			title: machine.name,
			rows: [
				['running', machine.detail],
				machine.limit && [
					'usage limit',
					`${plural(machine.limit.sessions, 'session')} waiting, ${limitWords(machine.limit.resetAt)}`,
				],
			],
			hint: looking === machine.key ? 'Press to see everything' : 'Press to look closer',
		};
	}

	const { bay } = target;
	const cargo = (bay.cargo ?? []).map(cargoWords).join('; ');
	const { language, files, since, commits } = bay.character ?? {};

	return {
		title: bay.name,
		rows: [
			['sessions', plural(bay.sessions.length, 'session')],
			['on', bay.servers.map(({ name }) => name).join(', ')],
			cargo && ['changes', cargo],
			language && ['written in', LANGUAGE_NAMES[language] ?? language],
			files && ['size', plural(files, 'file')],
			since && ['since', `${new Date(since).toLocaleDateString()}, ${plural(commits, 'commit')}`],
		],
		hint: `${looking === bay.name ? 'Press to see everything' : 'Press to look closer'} · right-click or hold for orders`,
	};
};

// Your work as one ship: the machines its engines, each with a panel of lamps lit by what its sessions are touching
// now; a bay for each project with something going on, whichever machine runs it, a worker at a desk in it for each
// session; and whoever is watching standing beside what they watch. What needs you is listed at
// the top and marked in the scene at any zoom; a worker opens its reply to read and answer, a bay starts a session.
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
		// A ship for each subscription, side by side; `scene` the one being looked at and played, the last pointed at
		this.ships = new Map([['', this.makeShip()]]);
		this.scene = this.ships.get('');
		this.remotes = [];
		// A server whose universe didn't answer isn't asked again for a while
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
		const scene = new Scene();

		scene.aside = FOCUS_WIDTH + 32;

		return scene;
	}

	// The looks, less what's hidden, a ship for each subscription: the paudes logged into one Claude account aboard one
	// ship, each that doesn't say which account it's on its own unless put aboard another's by hand; this machine's
	// first. Ships come and go with their subscriptions.
	updateShips() {
		const worlds = shownOf(this.worlds ?? [], hiddenNow());
		const groups = shipsOf(worlds, shipsAssigned(), this.worlds ?? []);

		// Everything hidden: one empty ship, so there's always one to draw
		if (!groups.size) groups.set('', []);

		const keys = [...groups.keys()];

		// The first look's ship is the one there from the start
		if (this.ships.has('') && keys.length) {
			const first = this.ships.get('');

			this.ships = new Map([[keys[0], first]]);
		}
		for (const key of keys) if (!this.ships.has(key)) this.ships.set(key, this.makeShip());
		for (const key of [...this.ships.keys()]) if (!groups.has(key)) this.ships.delete(key);
		this.ships = new Map(keys.map(key => [key, this.ships.get(key)]));
		if (![...this.ships.values()].includes(this.scene)) this.scene = this.ships.values().next().value;

		// One ship on the stage at a time, the one aboard; the rest go on as ever, out of sight, heard from by its
		// transporter
		const { width = 0, height = 0 } = this.stageSize ?? {};

		for (const ship of this.ships.values()) ship.resize(width, height);

		// What each ship's transporter hears from the rest, as of the last look: set before it's laid out (whether it
		// has a transporter at all) and again once every look is in
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

		if (!ship || ship === this.scene) return;
		this.scene.beamAt = this.scene.time;
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
			this.scene = ship;
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
			this.scene.draw(ctx, ratio);
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
			// Held without moving, a touch asks for orders
			if (event.pointerType === 'mouse') return;

			const held = press;

			clearTimeout(this.holding);
			this.holding = setTimeout(() => {
				if (held.dragged || press !== held) return;
				held.ordered = true;
				this.orders(point, { x: event.clientX, y: event.clientY });
			}, HOLD_MS);
		});
		this.canvas.addEventListener('contextmenu', event => {
			event.preventDefault();
			this.orders(at(event), { x: event.clientX, y: event.clientY });
		});
		this.canvas.addEventListener('pointermove', event => {
			const point = at(event);

			if (!press) {
				if (event.pointerType === 'mouse') this.showTip(this.scene.hit(point.x, point.y), point);

				return;
			}
			if (Math.hypot(point.x - press.x, point.y - press.y) > DRAG_PX) press.dragged = true;
			if (!press.dragged) return;

			this.showTip(null);
			this.canvas.classList.add('dragging');
			this.scene.pan(point.x - press.last.x, point.y - press.last.y);
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
				this.scene.zoom(Math.exp(-event.deltaY * WHEEL_ZOOM), at(event));
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
			else this.scene.look('all');
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
				'machine',
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

		const { title, rows = [], hint } = flyoutOf(target, this.scene);
		const table = element('div', 'rows');

		for (const row of rows.filter(Boolean)) table.append(element('span', 'key', row[0]), element('span', '', row[1]));
		this.tip.replaceChildren(element('strong', '', title), table, ...(hint ? [element('div', 'about', hint)] : []));
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
		const target = this.scene.hit(point.x, point.y);
		const { looking } = this.scene;

		this.showTip(null);
		this.select(selectionOf(target, this));
		if (target?.kind === 'worker') return this.openReply(target.worker, { focus: false });
		if (target?.kind === 'monitor')
			return live(target.worker.session) ? this.dockOrReply(target.worker, 'terminal') : this.openReply(target.worker);
		if (target?.kind === 'cloner') return this.newPrompt(undefined, point);
		if (target?.kind === 'log') return this.openLog(target, point);
		// The work itself opens where it's worked on: a checkout's cargo or pull request in its git, a chat in the chat,
		// a small grey in the tasks, what runs behind a desk in its ports
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

			return this.scene.look(looking === at ? 'all' : at);
		}
		if (target?.kind === 'bay') return this.scene.look(looking === target.bay.name ? 'all' : target.bay.name);
		if (target?.room && (target.kind === 'system' || ROOMS[target.kind]))
			return this.scene.look(looking === target.room.name ? 'all' : target.room.name);
		if (target?.kind === 'machine') return this.scene.look(looking === target.machine.key ? 'all' : target.machine.key);
		// No hover on a touch screen: a touch says what it landed on
		if (target && !mouse) return this.showTip(target, point);
		if (this.card) return this.closeCard();

		this.select(null);
		this.scene.look('all');
	}

	// Orders for what's under the point: a worker's session menu, a bay's project, a machine to look at
	orders(point, at) {
		const target = this.scene.hit(point.x, point.y);

		this.showTip(null);
		if (target?.kind === 'worker' || target?.kind === 'monitor') return openMenu(at, this.workerOrders(target.worker));
		if (target?.kind === 'bay' || (target?.kind === 'cargo' && target.bay))
			return openMenu(at, this.bayOrders(target.bay, point));
		if (target?.kind === 'machine')
			openMenu(at, [
				{ heading: target.machine.name },
				{ label: 'Look closer', onPress: () => this.scene.look(target.machine.key) },
			]);
	}

	// A stopped session wakes when it's answered or opened, and goes by archiving or deleting it
	workerOrders(worker) {
		const { session } = worker;
		const { remote } = session.server;
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

	bayOrders(bay, point) {
		const local = bay.servers.find(({ remote }) => !remote);

		return [
			{ heading: bay.name },
			{
				label: 'New prompt here',
				detail: 'paude finds the session it carries on, or starts one in this project',
				onPress: () => this.newPrompt(bay.name, point),
			},
			{ label: 'Look closer', onPress: () => this.scene.look(bay.name) },
			local
				? {
						label: 'Open project',
						onPress: () => (window.location.hash = `#/projects/${encodeURIComponent(bay.name)}`),
					}
				: {
						label: `Open project on ${bay.servers[0]?.name}`,
						onPress: () => this.openProject(bay.servers[0], bay.name),
					},
		];
	}

	// What's selected: a worker or a deck, ringed on the ship, its verbs along the command bar
	select(selected) {
		const same = selectionKey(selected) === selectionKey(this.selected);

		this.selected = selected;
		this.scene.selected = selectionKey(selected);
		if (!same) this.paintCommand();
	}

	// After each look: a selected worker that's gone is let go, and one still aboard has its bar say how it is now
	refreshSelection() {
		const worker = this.selected?.worker;

		if (!worker) return;

		const now = this.scene.workers.get(worker.session.key);

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
			(selected.machine && this.machineCommands(selected.machine)) ||
			this.placeCommands(selected.place);
		// A room's verbs are on the panel beside it while it's looked at; the bar is for a worker or a machine, or a room
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

		who.append(element('strong', '', selected.title), element('span', '', selected.about));
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
		const { remote } = session.server;
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

	bayCommands(bay) {
		const local = bay.servers.find(({ remote }) => !remote);
		const anchor = this.scene.screen({ x: bay.x + bay.w / 2, y: bay.y + bay.d / 2 });

		const worker = [...this.scene.workers.values()].find(
			({ session }) => session.project === bay.name && !session.server.remote && session.status !== 'stopped',
		);

		return [
			{ label: 'New prompt here', hotkey: 'n', run: () => this.newPrompt(bay.name, anchor) },
			...(local
				? [
						{ label: 'Sessions', hotkey: 'h', run: () => this.openProjectDock(bay.name, 'sessions') },
						{
							label: 'Files',
							hotkey: 'f',
							run: () =>
								worker
									? this.openDock(worker, 'files')
									: new Notify({
											intent: 'warning',
											content: `Files are read through a session: start one in ${bay.name} first.`,
										}),
						},
						{ label: 'Links', hotkey: 'l', run: () => this.openProjectDock(bay.name, 'links') },
						{ label: 'Made', hotkey: 'm', run: () => this.openProjectDock(bay.name, 'artifacts') },
					]
				: []),
			{ label: 'Look closer', hotkey: 'z', run: () => this.scene.look(bay.name) },
			local
				? {
						label: 'Open project',
						hotkey: 'o',
						run: () => (window.location.hash = `#/projects/${encodeURIComponent(bay.name)}`),
					}
				: {
						label: `Open on ${bay.servers[0]?.name}`,
						hotkey: 'o',
						run: () => this.openProject(bay.servers[0], bay.name),
					},
		];
	}

	machineCommands(machine) {
		const remote = this.remotes.find(({ url }) => url === machine.key);

		return [
			{ label: 'Look closer', hotkey: 'z', run: () => this.scene.look(machine.key) },
			...(remote
				? [
						{ label: 'Sessions', hotkey: 'h', run: () => this.openShipDock('sessions', [remote], machine.name) },
						{ label: `Open ${machine.name}`, hotkey: 'o', run: () => this.openDevice(remote) },
					]
				: [{ label: 'Sessions', hotkey: 'h', run: () => this.openShipDock('sessions', [], machine.name) }]),
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
			{ label: 'Look closer', hotkey: 'z', run: () => this.scene.look(BRIDGE) },
		];
	}

	// Opened from a session's page or a project's, the first look that has it goes to it: the session's grey, flown to
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
				this.scene = ship;
				this.select(selectionOf({ kind: 'bay', bay }, this));
				ship.look(bay.name);

				return;
			}

			const id = decodeURIComponent(session);
			const worker = [...ship.workers.values()].find(({ session: { id: other } }) => other === id);

			if (!worker?.desk) continue;
			this.focusedOpen = true;
			this.scene = ship;
			this.select(selectionOf({ kind: 'worker', worker }, this));
			ship.lookAt(worker.desk);

			return;
		}
	}

	// Which engines and projects the ship shows, each toggled; every one listed, those hidden too, from the last look
	openShown() {
		this.openListDock('shown', {
			title: 'Show and hide',
			about: 'which engines and projects are aboard, kept for this browser',
			entries: [
				shownPane({
					worlds: () => this.worlds ?? [],
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

	// A dock for the whole ship, or one machine: its sessions to find, read and wake, and folders to add as projects
	openShipDock(open, remotes = this.remotes, only) {
		const here = !only || only === hereName();

		this.openListDock(`ship:${only ?? 'all'}`, {
			title: only ? `Sessions on ${only}` : 'Sessions and projects',
			about: only ? 'newest first' : 'on every paude you use: find, wake or start one',
			entries: [
				sessionsPane({
					remotes,
					local: here,
					onPick: session => this.pick(session),
					changed: () => this.poll(),
				}),
				...(here
					? [
							projectsPane({
								remotes: only ? [] : remotes,
								onStart: project => (this.closeDock(), this.newPrompt(project)),
								onOpenThere: (remote, project) => this.openProject({ name: remote.name, remote }, project),
							}),
							foldersPane({ onAdded: names => this.added(names) }),
							devicesPane({
								remotes: this.remotes,
								here: hereName(),
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
		const key = session.remote ? `${session.remote.url}/${session.id}` : `here/${session.id}`;
		const worker = this.scene.workers.get(key);

		if (worker?.desk) {
			this.closeDock();
			this.select(selectionOf({ kind: 'worker', worker }, this));
			this.scene.lookAt(worker.desk);

			return requestAnimationFrame(() => this.openReply(worker));
		}

		const server = session.remote
			? { key: session.remote.url, name: session.remote.name, remote: session.remote }
			: { key: 'here', name: hereName() };
		const known = { ...session, server, status: 'stopped', reply: null };

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

	// Folders just added: their projects show aboard at the next look, and a prompt to start the first of them
	added(names) {
		this.closeDock();
		this.poll();
		if (names.length === 1) this.newPrompt(names[0]);
	}

	async openDevice(remote) {
		const { body, response } = await openRemote(remote.url, { home: true });

		if (response?.ok) window.location.href = body.link;
		else
			new Notify({
				intent: 'danger',
				content: refusal(`Could not reach ${remote.name}`, body),
			});
	}

	// Whether the command bar's keys are the ones that work: for a worker or a machine selected, or anything when no room
	// is looked at; otherwise the room's panel's
	barLeads() {
		return Boolean(this.selected && (this.selected.worker || this.selected.machine || !this.focused));
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
		const needed = triage(this.scene.sessions, this.scene.read);

		if (!needed.length) return;

		const at = needed.findIndex(({ session }) => session.key === this.selected?.worker?.session.key);
		const { session } = needed[(at + direction + needed.length) % needed.length];
		const worker = this.scene.workers.get(session.key);

		if (!worker?.desk) return;
		this.select(selectionOf({ kind: 'worker', worker }, this));
		this.scene.lookAt(worker.desk);
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

	// A panel of a session on this machine; another machine's session opens its reply
	dockOrReply(worker, key) {
		this.select(selectionOf({ kind: 'worker', worker }, this));
		if (worker.session.server.remote) return this.openReply(worker);
		// Its terminal attached marks it seen on the server; here at once
		if (key === 'terminal' && this.scene.needs(worker.session) === 'unread') {
			this.scene.markRead(worker.session);
			this.paintFocus();
		}

		return this.openDock(worker, key);
	}

	// A session on this machine working in a checkout, the one at work first, for its git
	workerIn(checkout) {
		const working = [...this.scene.workers.values()].filter(
			({ session }) =>
				!session.server.remote && session.checkout && `${session.server.key}:${session.checkout}` === checkout.key,
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
			promptCard({ project, onSent: () => this.scene.charge(), onClose: () => this.closeCard() }),
			anchor ?? this.scene.screen(this.bridgeDoor()),
		);
	}

	bridgeDoor() {
		const bridge = this.scene.bridge;

		return bridge ? { x: bridge.x + bridge.w / 2, y: bridge.y + bridge.d } : { x: 0, y: 0 };
	}

	async openProject(server, project) {
		const { body, response } = await openRemote(server.remote.url, { project });

		if (response?.ok) window.location.href = body.link;
		else
			new Notify({
				intent: 'danger',
				content: refusal(`Could not reach ${server.name}`, body),
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
		return session && this.scene.workers.get(session.key);
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

	// Reading it is seeing it, here and on the server it runs on
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
		if (this.scene.needs(session) !== 'unread') return;

		this.scene.markRead(session);
		this.paintFocus();
		if (session.server.remote) markRemoteSeen(session.server.remote.url, session.id);
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

	// The room looked at, whichever way it came to be: a project's deck, a system, engineering, the plans station, the lounge,
	// the materializer, the hold or the hangar; nothing while the whole ship, a worker's desk or free roaming is
	focusedRoom() {
		const { scene } = this;
		const { looking } = scene;

		// The whole ship has the bridge's panel, where the ship's health, what needs you and starting work are kept
		if (!looking || looking === 'all')
			return scene.bridge ? { key: 'bridge', kind: 'bridge', room: scene.bridge } : null;
		if (looking === 'free') return this.roomAtMiddle();

		const bay = scene.bays.find(({ name }) => name === looking);

		if (bay) return { key: `bay:${bay.name}`, kind: 'bay', room: bay, bay };
		if (looking === BRIDGE && scene.bridge) return { key: 'bridge', kind: 'bridge', room: scene.bridge };
		if (looking === LOUNGE && scene.lounge) return { key: 'lounge', kind: 'lounge', room: scene.lounge };
		if (scene.machines.some(({ key }) => key === looking))
			return { key: 'engineering', kind: 'engineering', room: scene.layout.engineering };

		const room = scene.roomOf(looking);

		return room?.kind ? { key: `room:${room.kind}:${room.name}`, kind: room.kind, room } : null;
	}

	// Zoomed in by hand, the room in the middle of the screen is the one looked at, once it's close enough to see into
	roomAtMiddle() {
		const { scene } = this;

		if (scene.camera.zoom < FOCUS_ZOOM) return null;

		const x = scene.camera.x / UNIT.x;
		const y = scene.camera.y / UNIT.y;
		const room = scene.layout.rooms?.find(
			({ x: left, y: top, w, d }) => x >= left && x <= left + w && y >= top && y <= top + d,
		);

		if (!room) return null;

		const bay = !room.kind && scene.bays.find(({ name }) => name === room.name);

		if (bay) return { key: `bay:${bay.name}`, kind: 'bay', room: bay, bay };
		if (room.kind === 'bridge') return { key: 'bridge', kind: 'bridge', room: scene.bridge };
		if (room.kind === 'lounge') return { key: 'lounge', kind: 'lounge', room: scene.lounge };

		return room.kind ? { key: `room:${room.kind}:${room.name}`, kind: room.kind, room } : null;
	}

	// What the panel beside a room says: the room's facts as its flyout has them, what's in it to pick, and its verbs
	focusOf(focus) {
		const { scene } = this;
		const { kind, room, bay } = focus;
		const workerItem = worker => {
			const { session } = worker;
			const need = scene.needs(session);

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
		const workersIn = keys => keys.map(key => scene.workers.get(key)).filter(Boolean);

		if (kind === 'bay') {
			const flyout = flyoutOf({ kind: 'bay', bay }, scene);
			const checkouts = scene.cargo.filter(({ project }) => project === bay.name);

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
							else this.openManifest(checkout, this.scene.screen(bay));
						},
					})),
				],
				commands: this.bayCommands(bay).filter(({ hotkey }) => hotkey !== 'z'),
			};
		}
		if (kind === 'system') {
			const system = scene.systemOf(room);
			const flyout = flyoutOf({ kind: 'system', room, system }, scene);

			return {
				...flyout,
				items: (system?.log ?? []).slice(0, 6).map(use => ({
					label: use.detail ?? use.tool,
					detail: [use.failed && 'failed', use.tool, relativeTime(Date.now() - use.ago)].filter(Boolean).join(' · '),
					tone: use.failed ? 'warn' : '',
					run: () => this.workerOf(use.session) && this.openReply(this.workerOf(use.session)),
				})),
				commands: system
					? [{ label: 'Whole log', hotkey: 'l', run: () => this.openLog({ room, system }, this.scene.screen(room)) }]
					: [],
			};
		}
		if (kind === 'engineering')
			return {
				title: titled(room.name),
				rows: scene.tanks.map(({ plan, level, rate }) => [
					`fuel${plan ? ` (${plan})` : ''}`,
					`${level === null ? 'size not known yet' : `${Math.round(level * 100)}% left`}, burning ${Math.round(rate / 1000)}k a minute`,
				]),
				items: scene.machines.map(machine => ({
					label: machine.name,
					detail: [machine.detail, machine.limit && limitWords(machine.limit.resetAt)].filter(Boolean).join(' · '),
					tone: (machine.limit && 'warn') || (machine.busy && 'busy') || '',
					run: () => this.select(selectionOf({ kind: 'machine', machine }, this)),
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
			const flyout = flyoutOf({ kind: 'bridge', room }, scene);
			const needed = triage(scene.sessions, scene.read)
				.map(({ session }) => scene.workers.get(session.key))
				.filter(Boolean);
			const watched = scene.screens
				.map(key => scene.workers.get(key))
				.filter(worker => worker && !needed.includes(worker));

			return {
				...flyout,
				rows: [
					...this.healthRows(),
					...flyout.rows,
					...this.scene.fleet.map(ship => [`${ship.name}'s ship`, shipWords(ship)]),
					...this.elsewhereRows(),
				],
				items: [...needed.map(workerItem), ...this.healthItems(), ...watched.map(workerItem)],
				commands: [
					...this.placeCommands('bridge').filter(({ hotkey }) => hotkey !== 'z'),
					{ label: 'New project', hotkey: 'p', run: () => this.openShipDock('projects') },
					{ label: 'Show and hide', hotkey: 'e', run: () => this.openShown() },
					...(this.scene.layout?.transporter
						? [{ label: 'Transporter', hotkey: 'x', run: () => this.scene.look('transporter') }]
						: []),
					...(identity()?.remotes
						? [{ label: 'Connect a device', hotkey: 'd', run: () => this.openShipDock('devices') }]
						: []),
				],
			};
		}

		return {
			...flyoutOf({ kind, room }, scene),
			items:
				(kind === 'transporter' &&
					scene.fleet.map(ship => ({
						label: `${ship.name}'s ship`,
						detail: shipWords(ship),
						tone: (ship.needs && 'warn') || (ship.working && 'busy') || '',
						run: () => this.travel(ship.key),
					}))) ||
				(kind === 'hold'
					? scene.cargo.map(checkout => ({
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
		const whole = !this.scene.looking || this.scene.looking === 'all';
		const tight = whole && focus.kind === 'bridge' && this.scene.tight;

		this.paintedTight = this.scene.tight;
		if (tight && !this.bridgeOpen) return this.paintSummary(focus);

		const { title, rows = [], items = [], commands = [] } = this.focusOf(focus);
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
		const { scene } = this;
		const needs = triage(scene.sessions, scene.read).length;
		const working = scene.sessions.filter(({ status }) => status === 'working').length;
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

		if ((focus?.key ?? null) !== (this.focused?.key ?? null) || this.scene.tight !== this.paintedTight)
			this.paintFocus();
		if (!this.focused) return null;

		const area = this.scene.area(this.focused.room);
		const { width, height } = this.stageSize ?? this.stage.elem.getBoundingClientRect();
		const box = this.focus.getBoundingClientRect();
		const whole = !this.scene.looking || this.scene.looking === 'all';
		// For the whole ship, at the screen's right edge in the room left for it; for a room, beside it
		const left = whole ? width - box.width - 12 : Math.min(width - box.width - 12, Math.max(12, area.right + 12));
		// Folded, in the top corner, clear of the ship
		const folded = this.focus.classList.contains('folded');
		const top = Math.min(height - box.height - 12, Math.max(52, area.top));

		return { elem: this.focus, left: `${Math.round(left)}px`, top: `${Math.round(folded ? 12 : top)}px` };
	}

	// The ship's health, for the bridge's panel: fuel, what's at work, what needs you, and how far it has come
	healthRows() {
		const { scene } = this;
		const sessions = scene.sessions;
		const needs = triage(sessions, scene.read).length;
		const tanks = scene.tanks.map(
			({ level, plan, unknown, machines }) =>
				(unknown && `${machines.map(({ name }) => name).join('/')} ?`) ||
				(level === null ? `${plan ?? 'fuel'} ?` : `${Math.round(level * 100)}%`),
		);

		return [
			tanks.length && ['fuel', tanks.join(' · ')],
			['working', String(sessions.filter(({ status }) => status === 'working').length)],
			['needs you', needs ? String(needs) : 'nothing'],
			['delivered', `${scene.journey?.distance ?? 0} (a reply 1, an artifact 2, a pushed commit 5)`],
		].filter(Boolean);
	}

	// What's failing its tests, waiting to be pushed or in review, each going where it's dealt with
	healthItems() {
		const { scene } = this;
		const failing = scene.bays.filter(
			bay => Scene.worstVerdict(bay.sessions.map(key => scene.workers.get(key)?.session).filter(Boolean)) === 'failing',
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
					this.scene.look(bay.name);
				},
			})),
			...scene.cargo
				.filter(({ unpushed }) => unpushed > 0)
				.map(checkout => ({
					label: `${checkout.project}: to push`,
					detail: cargoWords(checkout),
					run: git(checkout),
				})),
			...scene.cargo
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
			...this.scene.unseen.map(machine => [machine.name, machine.detail]),
			...this.scene.machines
				.filter(({ older }) => older)
				.map(machine => [machine.name, 'an older paude; update it there to see everything']),
		];
	}

	async open(session) {
		const { remote } = session.server;

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
		// Not yet known who's looking, or a server mid-restart answering with an error rather than its list: asked
		// again shortly rather than leaving the other paudes off the ship until the next round, waiting twice as long
		// each time it still doesn't come, up to the round itself
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

	// Each server's universe; one that can't be reached, or is too old to say, adds nothing until it answers
	async poll() {
		if (this.polling || document.hidden) return;
		this.polling = true;

		try {
			const remotes = this.remotes ?? [];
			const [here, ...there] = await Promise.all([
				getUniverse(),
				...remotes.map(remote =>
					remote.error || this.sealed.get(remote.url) > Date.now() ? null : timed(getRemoteUniverse(remote.url)),
				),
			]);

			this.worlds = [
				{ key: 'here', ...here.body, name: hereName(), hue: hueOf(hereName()) },
				...remotes.map((remote, index) => {
					const asked = there[index];
					const answered = asked?.response?.ok ? asked.body : null;

					if (answered) this.sealed.delete(remote.url);
					else if (asked) this.sealed.set(remote.url, Date.now() + REMOTES_MS);

					return {
						...(answered ?? (remote.error ? {} : olderPaude(remote))),
						// After what it answered, so no answer can claim to be another paude (this machine's, say)
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
