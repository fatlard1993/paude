import { Button, Elem, Notify, View, delay, styled, theme } from '@vanilla-bean/components';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import {
	deleteSession,
	getGit,
	getSession,
	getLinks,
	logout,
	markLink,
	nameSession,
	getArtifacts,
	getDecisions,
	dismissDecision,
	writeDownDecision,
	answerDecision,
	getAsking,
	getMeter,
	setLifetime,
	setWatching,
	findToOpen,
} from '../api';
import { confirmDeleteSession, nameDialog } from '../confirmDialog';
import { canBrowse, canNote, canType, identity } from '../identity';
import { tintsOf } from '../../shared/hues';
import tokens from '../../shared/tokenCount';
import withoutPointerReporting from '../../shared/pointerReporting';
import { NOTE_TYPES } from '../../shared/protocol';
import { showNotification } from '../notify';
import { recall, remember } from '../storage';
import { button, element } from '../dom';
import { breadcrumbs } from '../Breadcrumbs';
import { closeMenu, openMenu } from '../menu';
import { AskingCard, showAsking, showLimit } from '../Asking';
import { ghostButton } from '../Bar';
import { LIFETIMES, WARM_LIFETIMES, clockTime } from '../../shared/lifetimes';
import { updateTabTitle } from '../tabTitle';
import {
	besideSelection,
	clickToClaude,
	forkButtons,
	forkFromMarker,
	gpuRenderer,
	touchToClaude,
} from './claudeTerminal';
import claudeKeys from './claudeKeys';
import { claudePointer, wheelToClaude } from './claudePointer';
import { acceptFiles } from './fileDrop';
import { linkFilePaths, linkUrls } from './linkProviders';
import attach from './attach';
import { PANELS, panelTitle } from './panels';
import { startCatchUp, trackLastSeen } from './catchUp';
import KeyBar from './KeyBar';
import { copyAsSelected, copySelection, selectedText } from './copySelection';
import selectLinesByTap from './lineSelect';
import xtermOptions, { loadSymbolsFor, redrawWhenSymbolsLoad } from './xtermOptions';
import FilesPanel, { quickOpenMode } from './FilesPanel';
import GitPanel from './GitPanel';
import SharesPanel from './SharesPanel';
import ActivityPanel from './ActivityPanel';
import TasksPanel from './TasksPanel';
import LinksPanel from './LinksPanel';
import ArtifactsPanel from './ArtifactsPanel';
import DecisionsPanel from './DecisionsPanel';
import NotesPanel from './NotesPanel';
import { pullRequestActions } from './pullRequestReview';
import SideShell from './SideShell';
import { PANEL_EDGES, addResizeHandle } from './resizeHandle';
import { Body, NARROW, Presence, SelectHint, SelectionActions, TopBar } from './TerminalView.styles';

// Ctrl+Shift+L (Cmd+Shift+L) asks what to open, from the terminal too
const isAskToOpenKey = event =>
	(event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'l';
// How much of the end of the screen goes with what's asked to open, in rows
const SCREEN_ROWS = 60;
// The page's own, for xterm, which takes a color string
const BACKGROUND = theme.colors.black.toHexString();
// How far above and below a row to look for the rest of a URL Claude broke across rows
// How long after finding no pull request to look again, in ms
const PULL_REQUEST_RECHECK = 60_000;
// Room kept for the new-session button after a done line, in cells

const Screen = styled.Component`
	flex: 1;
	min-height: 0;
	overflow: hidden;
	padding: 0 ${({ space }) => space.xs};
	background: var(--session-background, ${BACKGROUND});
	/* xterm's own layers (the GPU renderer's link canvas among them) stack in here, under the buttons over the screen */
	isolation: isolate;

	.xterm {
		transform-origin: top left;
	}

	&.selecting {
		outline: 2px dashed ${({ colors }) => colors.light(colors.orange)};
		outline-offset: -2px;
	}

	&.dropping {
		outline: 2px dashed var(--session-accent, ${({ colors }) => colors.light(colors.orange)});
		outline-offset: -2px;
	}
`;

const ICONS = { web: 'globe', terminal: 'terminal', feed: 'tower-broadcast' };
const NOTES_OPEN_KEY = 'paude.notesOpen';
const ROLE_LABELS = { owner: 'owner', drive: 'can type', comment: 'can chat and comment', watch: 'viewing' };

const bufferLines = terminal => {
	const buffer = terminal.buffer.active;
	const lines = [];

	for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) ?? '');

	return lines;
};

const METER_AFTER_TURN_MS = 4000;
const REFRESH_WHILE_BUSY_MS = 3000;
// A cold conversation this big gets a word before the next message caches it all again
const COLD_WARNING_TOKENS = 50_000;

export default class TerminalView extends View {
	constructor(options) {
		super({
			...options,
			onConnected: () => this.open(),
		});
	}

	build() {
		const header = new TopBar({ appendTo: this });

		// A guest has no home or project page here to go up to: leaving is the way out
		if (!identity()?.owner) {
			ghostButton(header, {
				label: 'Leave',
				onPress: async () => {
					await logout();
					window.location.reload();
				},
			});
		}

		const title = new Elem({ addClass: 'title' });

		this.stateDot = new Elem({ appendTo: title, addClass: 'state' });
		this.titleLabel = new Elem({ appendTo: title, addClass: 'name' });
		this.addCleanup('tabTitle', () => updateTabTitle({ page: '', here: null }));
		if (identity()?.owner) {
			// The project's crumb is filled in once the session says which it is
			const { links, setProject } = breadcrumbs({
				appendTo: header,
				trail: [{ label: '', href: '#/' }],
				current: title,
				sessionId: this.options.id,
				addCleanup: (name, stop) => this.addCleanup(name, stop),
			});

			[this.projectCrumb] = links;
			this.countWaitingIn = setProject;
			this.projectCrumb.style.display = 'none';
			this.projectCrumb.previousSibling.style.display = 'none';
		} else header.elem.append(title.elem);
		if (identity()?.owner) {
			this.titleLabel.elem.title = 'Rename';
			this.titleLabel.elem.style.cursor = 'pointer';
			this.titleLabel.elem.addEventListener('click', () => this.rename());
		}
		this.presence = new Presence({ appendTo: header });
		new Elem({ appendTo: header, addClass: 'divider' });
		// The universe, flown to this session's grey (a guest's shows this session and its project alone)
		ghostButton(header, {
			icon: 'earth-americas',
			title: 'See it in the universe',
			className: 'tool',
			onPress: () => (window.location.hash = `#/universe/sessions/${encodeURIComponent(this.options.id)}`),
		});

		const body = new Body({ appendTo: this });

		if (canBrowse()) {
			this.filesButton = ghostButton(header, {
				icon: PANELS.files.icon,
				title: panelTitle('files'),
				className: 'tool',
				onPress: () => this.toggleFiles(),
			});
			ghostButton(header, {
				icon: 'magnifying-glass-arrow-right',
				title: 'Open: say what, and Haiku finds the files or changes (Ctrl+Shift+L)',
				className: 'tool',
				onPress: () => this.askToOpen(),
			});
			this.activityButton = ghostButton(header, {
				icon: PANELS.activity.icon,
				title: panelTitle('activity'),
				className: 'tool',
				onPress: () => this.toggleActivity(),
			});
			this.tasksButton = ghostButton(header, {
				icon: PANELS.tasks.icon,
				title: panelTitle('tasks'),
				className: 'tool',
				onPress: () => this.toggleTasks(),
			});
			this.linksButton = ghostButton(header, {
				icon: PANELS.links.icon,
				title: panelTitle('links'),
				className: 'tool',
				onPress: () => this.toggleLinks(),
			});
			this.artifactsButton = ghostButton(header, {
				icon: PANELS.artifacts.icon,
				title: panelTitle('artifacts'),
				className: 'tool',
				onPress: () => this.toggleArtifacts(),
			});
			this.decisionsButton = ghostButton(header, {
				icon: PANELS.decisions.icon,
				title: panelTitle('decisions'),
				className: 'tool',
				onPress: () => this.toggleDecisions(),
			});
			this.gitButton = ghostButton(header, {
				icon: PANELS.git.icon,
				title: panelTitle('git'),
				className: 'tool',
				onPress: () => this.toggleGit(),
			});
		}
		if (canType()) {
			this.shellButton = ghostButton(header, {
				icon: PANELS.shell.icon,
				title: panelTitle('shell'),
				className: 'tool',
				onPress: () => this.toggleShell(),
			});
		}
		ghostButton(header, {
			icon: 'route',
			title: 'Catch me up: a tour of what happened since you were last here',
			className: 'tool',
			onPress: () => this.catchUp(),
		});
		this.watchButton = ghostButton(header, {
			icon: 'eye',
			title: 'Watch: count what changes here while you are away',
			className: 'tool',
			onPress: () => this.toggleWatching(),
		});
		if (identity()?.owner) {
			this.meterButton = ghostButton(header, {
				icon: 'gauge',
				title: 'Cache and cost',
				className: 'tool meter',
				onPress: () => this.openMeter(),
			});
			this.meterText = element('span', 'meter-text');
			this.meterButton.append(this.meterText);
			this.lifetimeButton = ghostButton(header, {
				icon: LIFETIMES.ordinary.icon,
				title: 'How long this session lasts',
				className: 'tool lifetime',
				onPress: () => this.openLifetime(),
			});
			this.lifetimeWas = element('s', 'lifetime-was');
			this.lifetimeText = element('span', 'lifetime-text');
			this.lifetimeButton.append(this.lifetimeText, this.lifetimeWas);
			this.showLifetime('ordinary');
		}
		// For a session that is an arcade (a game a kid builds), once the session says so
		if (identity()?.owner) {
			this.arcadeButton = ghostButton(header, {
				icon: 'gamepad',
				title: 'Arcade: this session as a kid plays it, the game beside the talk, read aloud',
				onPress: () => (window.location.hash = `#/arcade/${this.options.id}`),
			});
			this.arcadeButton.style.display = 'none';
		}
		this.sharesButton = ghostButton(header, {
			icon: PANELS.shares.icon,
			title: panelTitle('shares'),
			className: 'tool',
			onPress: () => this.toggleShares(),
		});
		this.sharedCount = Object.assign(document.createElement('span'), { className: 'count' });
		this.sharedCount.style.display = 'none';
		this.sharesButton.append(this.sharedCount);
		this.notesToggle = ghostButton(header, {
			icon: PANELS.notes.icon,
			title: panelTitle('notes'),
			className: 'tool',
			onPress: () => this.toggleNotes(),
		});
		this.unread = Object.assign(document.createElement('span'), { className: 'count' });
		this.unread.style.display = 'none';
		this.notesToggle.append(this.unread);
		if (identity()?.owner) {
			ghostButton(header, {
				icon: 'trash-can',
				title: 'Delete this session',
				className: 'tool danger',
				onPress: () => this.deleteThisSession(),
			});
		}
		// A phone's bar has room for back and the session's name; everything else is in this menu
		const tools = ghostButton(header, {
			icon: 'bars',
			title: 'Menu',
			className: 'tools',
			onPress: () => this.toggleToolsMenu(tools, header),
		});

		this.toolsCount = Object.assign(document.createElement('span'), { className: 'count' });
		this.toolsCount.style.display = 'none';
		tools.append(this.toolsCount);

		const column = new Elem({ appendTo: body, addClass: 'terminal-column' });

		this.screen = new Screen({ appendTo: column });
		this.selectHint = new SelectHint({ appendTo: column, style: { display: 'none' } });
		// Kept from taking focus, so the selection is still there to act on; acting on the click rather than the press, so
		// the release can't land on whatever was under the buttons once they hide
		this.selectionActions = new SelectionActions({ appendTo: column, style: { display: 'none' } });
		this.askingCard = new AskingCard({ appendTo: column, addClass: 'asking-overlay' });
		this.limitCard = new AskingCard({ appendTo: column, addClass: 'limit-overlay' });
		this.coldCard = new AskingCard({ appendTo: column, addClass: 'limit-overlay' });
		this.tourCard = new AskingCard({ appendTo: column, addClass: ['limit-overlay', 'tour'] });
		this.seenBefore = trackLastSeen(this.options.id, (name, cleanup) => this.addCleanup(name, cleanup));
		this.selectionActions.elem.addEventListener('pointerdown', event => event.preventDefault());
		this.selectionActions.elem.addEventListener('mousedown', event => event.preventDefault());

		const selectionButton = (options, onPress) =>
			new Button({ appendTo: this.selectionActions, ...options }).elem.addEventListener('click', onPress);

		selectionButton({ icon: 'copy', textContent: 'Copy' }, () => copySelection(this.terminal, { unwrap: true }));
		if (canType())
			selectionButton(
				{
					icon: 'terminal',
					textContent: 'Shell',
					attributes: { title: "Put it on the shell's command line" },
				},
				() => this.sendSelectionToShell(),
			);
		if (canNote()) selectionButton({ icon: 'comment', textContent: 'Comment' }, () => this.commentOnSelection());
		if (canNote()) {
			new KeyBar({
				appendTo: column,
				...(canType() && { sendKey: data => this.sendInput(data) }),
				selectLines: () => this.startLineSelect(),
			});
		}

		this.files = new FilesPanel({
			appendTo: body,
			addClass: 'files',
			place: this.options.id,
			close: () => this.toggleFiles(false),
			setFullscreen: on => this.files.elem.classList.toggle('fullscreen', on),
			attach: text => {
				if (this.attachToPrompt(text)) this.toggleFiles(false);
			},
			comment: ({ quote, anchor }) => this.notes.startComment(quote, anchor),
			commentsOn: (path, options) => this.notes.commentsOn(path, options),
			showComment: commentId => this.notes.showComment(commentId),
		});
		if (canBrowse()) {
			this.git = new GitPanel({
				appendTo: body,
				addClass: 'git',
				place: this.options.id,
				close: () => this.toggleGit(false),
				// A file's change or a whole commit, in the files panel's diff view
				openDiff: source => {
					// A phone has room for one panel, and the diff is what was asked for
					if (window.matchMedia(NARROW).matches) this.toggleGit(false);
					this.toggleFiles(true);
					this.files.openDiffSet(source);
				},
				changed: () => this.files.changesMayHaveChanged(),
				pullRequestFound: pr => this.pullRequestFound(pr),
				showComments: () => {
					if (window.matchMedia(NARROW).matches) this.toggleGit(false);
					this.toggleNotes(true, { focus: false });
					this.notes?.showTab('comments');
				},
			});
			addResizeHandle(this.git.elem, PANEL_EDGES.side);
		}
		if (canBrowse()) {
			this.activity = new ActivityPanel({
				appendTo: body,
				addClass: 'activity',
				sessionId: this.options.id,
				close: () => this.toggleActivity(false),
				openDiff: source => {
					if (window.matchMedia(NARROW).matches) this.toggleActivity(false);
					this.toggleFiles(true);
					this.files.openDiffSet(source);
				},
				openFile: (path, line) => {
					if (window.matchMedia(NARROW).matches) this.toggleActivity(false);
					this.toggleFiles(true);
					this.files.open(path, line);
				},
			});
			addResizeHandle(this.activity.elem, PANEL_EDGES.side);
			this.tasks = new TasksPanel({
				appendTo: body,
				addClass: 'tasks',
				place: this.options.id,
				close: () => this.toggleTasks(false),
				openFile: (path, line) => {
					if (window.matchMedia(NARROW).matches) this.toggleTasks(false);
					this.toggleFiles(true);
					this.files.open(path, line);
				},
				attach: text => this.attachToPrompt(text),
			});
			addResizeHandle(this.tasks.elem, PANEL_EDGES.side);
			this.links = new LinksPanel({
				appendTo: body,
				addClass: 'links',
				load: () => getLinks(this.options.id),
				mark: (url, change) => markLink(this.options.id, url, change),
				close: () => this.toggleLinks(false),
			});
			addResizeHandle(this.links.elem, PANEL_EDGES.side);
			this.artifacts = new ArtifactsPanel({
				appendTo: body,
				addClass: 'links',
				sessionId: this.options.id,
				load: () => getArtifacts(this.options.id),
				close: () => this.toggleArtifacts(false),
				openFile:
					this.files &&
					((path, options) => {
						if (window.matchMedia(NARROW).matches) this.toggleArtifacts(false);
						this.toggleFiles(true);
						this.files.open(path, undefined, undefined, options);
					}),
			});
			addResizeHandle(this.artifacts.elem, PANEL_EDGES.side);
			this.decisions = new DecisionsPanel({
				appendTo: body,
				addClass: ['links', 'decisions-panel'],
				load: () => getDecisions(this.options.id),
				dismiss: id => dismissDecision(this.options.id, id),
				writeDown: id => writeDownDecision(this.options.id, id),
				answer: (id, answer) => answerDecision(this.options.id, id, answer),
				close: () => this.toggleDecisions(false),
			});
			addResizeHandle(this.decisions.elem, PANEL_EDGES.side);
		}
		this.shares = new SharesPanel({
			appendTo: body,
			addClass: 'shares',
			sessionId: this.options.id,
			close: () => this.toggleShares(false),
		});
		addResizeHandle(this.shares.elem, PANEL_EDGES.side);
		if (canType()) {
			this.shell = new SideShell({
				appendTo: body,
				addClass: 'shell',
				place: this.options.id,
				close: () => this.toggleShell(false),
				attach: text => this.attachToPrompt(text),
				ended: why => {
					this.toggleShell(false);
					if (why) new Notify({ intent: 'warning', content: why });
				},
			});
		}
		this.notes = new NotesPanel({
			appendTo: body,
			addClass: 'notes',
			sessionId: this.options.id,
			send: message => Boolean(this.connection?.send(message)),
			jump: quote => this.jumpTo(quote),
			openComment: comment => {
				if (window.matchMedia(NARROW).matches) this.toggleNotes(false);
				this.toggleFiles(true);
				this.files.openComment(comment);
			},
			attach: text => this.attachToPrompt(text),
			commentsChanged: () => this.files.commentsChanged(),
			commentActions: () => this.pullRequestActions(),
			reveal: () => this.toggleNotes(true, { focus: false }),
			close: () => this.toggleNotes(false),
			announce: arrived => this.announce(arrived),
			showUnread: count => {
				this.unread.textContent = count;
				this.unread.style.display = count ? '' : 'none';
				this.toolsCount.textContent = count;
				this.toolsCount.style.display = count ? '' : 'none';
			},
		});

		addResizeHandle(this.notes.elem, PANEL_EDGES.side);
		addResizeHandle(this.files.elem, PANEL_EDGES.files);
		if (this.shell) {
			addResizeHandle(this.shell.elem, PANEL_EDGES.shell);
		}
		if (recall(NOTES_OPEN_KEY)) this.toggleNotes(true, { focus: false });

		this.loadInfo();
	}

	async loadInfo() {
		const { body, response } = await getSession(this.options.id);

		if (!response?.ok) return;

		this.project = body.project;
		if (this.arcadeButton) this.arcadeButton.style.display = body.arcade ? '' : 'none';
		this.paint(body.hue);
		this.showWatching(body.watching);
		this.showLifetime(body.lifetime, body.warmUntil, body.switched);
		this.loadMeter();
		if (this.projectCrumb) {
			this.projectCrumb.textContent = body.project;
			this.projectCrumb.href = `#/projects/${encodeURIComponent(body.project)}`;
			this.projectCrumb.style.display = '';
			this.projectCrumb.previousSibling.style.display = '';
			this.countWaitingIn(body.project, this.projectCrumb);
		}
		// The name may have come with the session's presence first, before the project to put beside it
		this.title ??= body.title || body.project;
		if (this.titleLabel.elem.textContent) this.nameTab();
		else this.showTitle(this.title);
	}

	// The session's own color, in kitty-bg's tints: the screen, its text and cursor, and the bar's edge
	paint(hue) {
		const tints = tintsOf(hue);

		this.tints = tints;
		this.elem.classList.toggle('tinted', Boolean(tints));
		this.elem.style.setProperty('--session-accent', tints?.accent ?? '');
		this.elem.style.setProperty('--session-background', tints?.background ?? '');
		if (this.terminal) this.terminal.options.theme = this.theme();
	}

	theme() {
		const { background, foreground, accent } = this.tints ?? {};

		return this.tints
			? { background, foreground, cursor: accent, cursorAccent: background }
			: { background: BACKGROUND };
	}

	open() {
		if (this.terminal) return;

		const fileKeys = event => this.fileShortcut(event);

		document.addEventListener('keydown', fileKeys);
		this.addCleanup('fileKeys', () => document.removeEventListener('keydown', fileKeys));

		const seeNews = () => {
			if (document.hidden) return;
			this.newsWhileAway = false;
			this.markTab();
		};

		document.addEventListener('visibilitychange', seeNews);
		this.addCleanup('seeNews', () => document.removeEventListener('visibilitychange', seeNews));
		this.addCleanup('connections', () => {
			this.connection?.close();
			this.shell?.stop();
			this.resizeObserver?.disconnect();
			this.terminal?.dispose();
		});

		this.terminal = new Terminal({
			...xtermOptions,
			scrollback: 5000,
			disableStdin: !canType(),
			theme: this.theme(),
		});
		this.fitter = new FitAddon();
		this.terminal.loadAddon(this.fitter);
		this.decoder = new TextDecoder();
		this.terminal.open(this.screen.elem);
		gpuRenderer(this.terminal);
		redrawWhenSymbolsLoad(this.terminal);
		if (identity()?.owner)
			forkButtons({
				terminal: this.terminal,
				screen: this.screen.elem,
				onFork: line =>
					forkFromMarker({
						terminal: this.terminal,
						sessionId: this.options.id,
						line,
						go: id => (window.location.hash = `#/sessions/${id}`),
					}),
			});
		this.linkUrls();
		if (canType()) acceptFiles(this.screen.elem, this.options.id, text => this.attachToPrompt(text));
		if (canBrowse()) this.linkFilePaths();
		this.terminal.onData(data => this.sendInput(data));
		this.scrollClaudeWithWheel();
		this.terminal.onSelectionChange(() => besideSelection(this.terminal, this.selectionActions.elem));
		// Output scrolls the selection, and the buttons with it, except from under a pointer reaching for them
		this.terminal.onScroll(() => {
			if (!this.selectionActions.elem.matches(':hover')) besideSelection(this.terminal, this.selectionActions.elem);
		});
		// Left to the page, which asks what to open
		this.terminal.attachCustomKeyEventHandler(
			claudeKeys({
				terminal: this.terminal,
				send: data => this.sendInput(data),
				canType,
				leave: event => canBrowse() && isAskToOpenKey(event),
			}),
		);
		copyAsSelected(this.terminal, { unwrap: true });

		this.connection = attach(this.options.id, {
			hello: () => ({
				kind: 'web',
				label: /Mobi|Android/.test(navigator.userAgent) ? 'phone' : 'browser',
				...this.naturalSize(),
			}),
			onOutput: data => {
				const text = this.decoder.decode(data, { stream: true });

				loadSymbolsFor(text);
				this.terminal.write(withoutPointerReporting(text, this.trackPointerMode));
			},
			onMessage: message => this.handleMessage(message),
			onState: (state, reason) => this.showConnection(state, reason),
		});

		// Our own size only matters to the session while we drive, but the server keeps it so typing can claim it
		this.resizeObserver = new ResizeObserver(() => {
			this.connection.send({ type: 'resize', ...this.naturalSize() });
			this.fitScale();
		});
		this.resizeObserver.observe(this.screen.elem);

		this.terminal.focus();
	}

	sendInput(data) {
		return Boolean(this.connection?.send({ type: 'input', data }));
	}

	naturalSize() {
		const { cols = 80, rows = 24 } = this.fitter?.proposeDimensions() ?? {};

		return { cols: Math.max(cols, 20), rows: Math.max(rows, 8) };
	}

	// The session may be sized for someone else's bigger screen; shrink to fit rather than clip
	fitScale() {
		const { cols, rows } = this.naturalSize();
		const scale = Math.min(1, cols / this.terminal.cols, rows / this.terminal.rows);

		this.terminal.element.style.transform = scale < 1 ? `scale(${scale})` : '';
	}

	showConnection(state, reason) {
		if (state === 'unauthorized') return window.location.reload();

		// Final either way; a session that won't start says why, where the title was
		this.connectionState = state === 'failed' ? 'ended' : state;

		if (state === 'ended') this.titleLabel.elem.textContent = 'Session ended. Open it again to resume.';
		if (state === 'failed') {
			this.titleLabel.elem.textContent = `Won't start: ${reason}`;
			new Notify({ intent: 'danger', content: `This session won't start: ${reason}`, timeout: 0 });
		}

		this.renderPresence(this.lastPresence ?? { clients: [] });
	}

	handleMessage(message) {
		if (message.type === 'snapshot') {
			this.terminal.reset();
			this.terminal.resize(message.cols, message.rows);
			this.decoder = new TextDecoder();
			this.pointer.reset();
			loadSymbolsFor(message.data);
			this.terminal.write(withoutPointerReporting(message.data, this.trackPointerMode));
			this.fitScale();
		} else if (message.type === 'size') {
			this.terminal.resize(message.cols, message.rows);
			this.fitScale();
		} else if (message.type === 'presence') {
			this.renderPresence(message);
		} else if (message.type === 'runs') {
			this.showRuns(message.runs);
		} else if (message.type === 'shares') {
			this.showShares(message.shares);
		} else if (message.type === 'notice') {
			new Notify({ intent: 'warning', content: message.text });
		} else if (NOTE_TYPES.includes(message.type)) {
			this.notes.receive(message);
			// The chat brings links too
			if (this.links?.elem.classList.contains('open')) this.links.refresh();
		}
	}

	// While Claude works, what it did, linked and made grows: an open panel of them is read again until it's done, and
	// once more then
	followTurn(busy) {
		const refreshOpen = () =>
			[this.activity, this.links, this.artifacts, this.decisions]
				.filter(panel => panel?.elem.classList.contains('open'))
				.forEach(panel => panel.refresh());

		this.replaceCleanup('turnTimer', () => clearInterval(this.turnTimer));
		if (busy) this.turnTimer = setInterval(refreshOpen, REFRESH_WHILE_BUSY_MS);
		refreshOpen();
	}

	renderPresence(presence) {
		const { busy, waiting, title, clients, you } = presence;

		// Claude waiting, or done, is when a proposal appears or a turn's changes (and new files) land
		if (this.lastPresence && (waiting !== this.lastPresence.waiting || busy !== this.lastPresence.busy)) {
			this.files?.changesMayHaveChanged();
			if (this.git?.elem.classList.contains('open')) this.git.refresh();
			this.followTurn(busy);
			if (this.lastPresence.busy && !busy && document.hidden) this.newsWhileAway = true;
			// The turn's usage lands in the transcript a moment after Claude stops: read now, and again then
			if (!busy) {
				this.loadMeter();
				setTimeout(() => this.loadMeter(), METER_AFTER_TURN_MS);
			}
			this.resolvePath = null;
		}
		const offline = this.connectionState === 'reconnecting' || this.connectionState === 'ended';

		if (waiting !== Boolean(this.lastPresence?.waiting)) this.showAsking(waiting);
		// The presence that follows each change brings the next state, so the card is redrawn from each
		this.limitCard.elem.classList.toggle('shown', Boolean(presence.limit));
		if (presence.limit) showLimit(this.limitCard, this.options.id, presence.limit, { canAct: canType() });
		this.lastPresence = presence;
		this.markTab();
		this.notes.myName = clients[you]?.name;
		if (title && this.connectionState !== 'ended') this.showTitle(title);

		this.presence.empty();
		this.stateDot.elem.className = `state${busy ? ' busy' : ''}${waiting ? ' waiting' : ''}${offline ? ' offline' : ''}`;
		this.stateDot.elem.title = waiting
			? 'Claude needs you: a permission or an answer'
			: ({ reconnecting: 'Reconnecting', ended: 'Ended' }[this.connectionState] ??
				(busy ? 'Claude is working' : 'Claude is ready'));
		if (offline) {
			new Elem({
				appendTo: this.presence,
				addClass: 'status',
				textContent: { reconnecting: 'reconnecting...', ended: 'ended' }[this.connectionState],
			});
		}

		clients.forEach((client, index) => {
			new Elem({
				appendTo: this.presence,
				addClass: ['who', ...(client.sizer ? ['sizer'] : [])],
				append: [
					Object.assign(document.createElement('i'), { className: `fa-solid fa-${ICONS[client.kind] ?? 'user'}` }),
					index === you ? 'you' : client.name,
				],
				attributes: {
					title: [client.label, ROLE_LABELS[client.role], client.sizer && 'sets the terminal size']
						.filter(Boolean)
						.join(', '),
				},
			});
		});
	}

	// Claude draws its dialog around when it says it's waiting, so the screen is read again a moment later if it isn't
	// there yet
	async showAsking(waiting) {
		const shown = this.askingCard.elem.classList;

		shown.remove('shown');
		for (const wait of waiting ? [0, 400, 1500] : []) {
			await delay(wait);
			if (!this.lastPresence?.waiting) return;

			const { body } = await getAsking(this.options.id);

			if (body?.asking) {
				showAsking(this.askingCard, this.options.id, body.asking, {
					canAnswer: canType(),
					onAnswered: () => shown.remove('shown'),
				});
				shown.add('shown');

				return;
			}
		}
	}

	toggleNotes(open = !this.notes.elem.classList.contains('open'), { focus = true } = {}) {
		if (open) this.closeOthersOnTheRight('notes');
		this.notes.elem.classList.toggle('open', open);
		this.notesToggle.classList.toggle('active', open);
		remember(NOTES_OPEN_KEY, open ? 'yes' : '');
		if (open) this.notes.showTab(this.notes.tab);
		this.focusPanel(this.notes.elem, open && focus);
	}

	// An opened panel takes the keyboard, so Esc closes it rather than reaching Claude; closed, the keyboard goes back
	// to the terminal if the panel had it
	focusPanel(panel, open) {
		if (open && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
		else if (!open && panel.contains(document.activeElement)) this.terminal?.focus();
	}

	// The quick-open keys, and Ctrl+Shift+L to ask what to open
	fileShortcut(event) {
		if (canBrowse() && isAskToOpenKey(event)) {
			event.preventDefault();
			if (event.type === 'keydown' && !event.repeat) this.askToOpen();

			return;
		}
		const mode = quickOpenMode(event);

		if (!mode) return;
		event.preventDefault();
		this.toggleFiles(true);
		this.files.quickOpen(mode);
	}

	// A few words on what to open ("the test for this", "what Claude changed in the login"), found by Haiku from the
	// session's work and opened in the files panel
	async askToOpen() {
		if (this.askingToOpen) return;
		this.askingToOpen = true;

		const ask = await nameDialog({
			current: '',
			header: 'Open what?',
			placeholder: 'the test for this file, the last commit, what changed in the login...',
			confirmLabel: 'Open',
		}).finally(() => {
			this.askingToOpen = false;
		});

		if (!ask) return;

		const looking = new Notify({ intent: 'info', content: 'Haiku is looking...', timeout: 0 });
		const screen = this.terminal ? bufferLines(this.terminal).slice(-SCREEN_ROWS).join('\n') : '';
		const { body, response } = await findToOpen(this.options.id, { ask, viewing: this.files.viewing, screen });

		looking.destroy();
		if (!response?.ok)
			return new Notify({ intent: 'warning', content: typeof body === 'string' ? body : "Couldn't find it" });
		if (!body.opened.length) return new Notify({ intent: 'info', content: body.said || 'Found nothing to open.' });

		this.toggleFiles(true);
		this.files.openFound(ask, body);
	}

	toggleFiles(open = !this.files.elem.classList.contains('open')) {
		this.files.elem.classList.toggle('open', open);
		this.filesButton?.classList.toggle('active', open);
		if (open) this.files.refresh();
		this.focusPanel(this.files.elem, open);
	}

	// The chat, Git and Shared panels sit on the right: one at a time
	closeOthersOnTheRight(keep) {
		if (keep !== 'notes' && this.notes.elem.classList.contains('open')) this.toggleNotes(false);
		if (keep !== 'git' && this.git?.elem.classList.contains('open')) this.toggleGit(false);
		if (keep !== 'shares' && this.shares.elem.classList.contains('open')) this.toggleShares(false);
		if (keep !== 'activity' && this.activity?.elem.classList.contains('open')) this.toggleActivity(false);
		if (keep !== 'tasks' && this.tasks?.elem.classList.contains('open')) this.toggleTasks(false);
		if (keep !== 'links' && this.links?.elem.classList.contains('open')) this.toggleLinks(false);
		if (keep !== 'artifacts' && this.artifacts?.elem.classList.contains('open')) this.toggleArtifacts(false);
		if (keep !== 'decisions' && this.decisions?.elem.classList.contains('open')) this.toggleDecisions(false);
	}

	toggleDecisions(open = !this.decisions.elem.classList.contains('open')) {
		if (open) this.closeOthersOnTheRight('decisions');
		this.decisions.elem.classList.toggle('open', open);
		this.decisionsButton?.classList.toggle('active', open);
		if (open) this.decisions.refresh();
		this.focusPanel(this.decisions.elem, open);
	}

	toggleArtifacts(open = !this.artifacts.elem.classList.contains('open')) {
		if (open) this.closeOthersOnTheRight('artifacts');
		this.artifacts.elem.classList.toggle('open', open);
		this.artifactsButton?.classList.toggle('active', open);
		if (open) this.artifacts.refresh();
		this.focusPanel(this.artifacts.elem, open);
	}

	toggleLinks(open = !this.links.elem.classList.contains('open')) {
		if (open) this.closeOthersOnTheRight('links');
		this.links.elem.classList.toggle('open', open);
		this.linksButton?.classList.toggle('active', open);
		if (open) this.links.refresh();
		this.focusPanel(this.links.elem, open);
	}

	toggleTasks(open = !this.tasks.elem.classList.contains('open')) {
		if (open) this.closeOthersOnTheRight('tasks');
		this.tasks.elem.classList.toggle('open', open);
		this.tasksButton?.classList.toggle('active', open);
		if (open) this.tasks.refresh();
		this.focusPanel(this.tasks.elem, open);
	}

	// A run started or ended: the button shows one is going, and an open panel catches up
	showRuns(runs) {
		this.tasksButton?.classList.toggle(
			'busy',
			runs.some(run => run.code === undefined || run.code === null),
		);
		if (this.tasks?.elem.classList.contains('open')) this.tasks.refresh();
	}

	toggleActivity(open = !this.activity.elem.classList.contains('open')) {
		if (open) this.closeOthersOnTheRight('activity');
		this.activity.elem.classList.toggle('open', open);
		this.activityButton?.classList.toggle('active', open);
		if (open) this.activity.refresh();
		this.focusPanel(this.activity.elem, open);
	}

	toggleShares(open = !this.shares.elem.classList.contains('open')) {
		if (open) this.closeOthersOnTheRight('shares');
		this.shares.elem.classList.toggle('open', open);
		this.sharesButton.classList.toggle('active', open);
		if (open) this.shares.refresh();
		this.focusPanel(this.shares.elem, open);
	}

	// How many things the session shares, on the button; a service seen for the first time says so once
	showShares(shares) {
		const ports = shares.filter(share => share.kind === 'port' && share.auto);

		this.seenPorts ??= new Set(ports.map(share => share.port));
		for (const share of ports) {
			if (this.seenPorts.has(share.port)) continue;
			this.seenPorts.add(share.port);
			new Notify({
				intent: 'info',
				content: `Sharing port ${share.port} (${share.command}): open it from Shared`,
				timeout: 5000,
			});
		}
		this.sharedCount.textContent = shares.length;
		this.sharedCount.style.display = shares.length ? '' : 'none';
		if (this.shares.elem.classList.contains('open')) this.shares.refresh();
	}

	toggleGit(open = !this.git.elem.classList.contains('open')) {
		if (open) this.closeOthersOnTheRight('git');
		this.git.elem.classList.toggle('open', open);
		this.gitButton?.classList.toggle('active', open);
		if (open) this.git.refresh();
		this.focusPanel(this.git.elem, open);
	}

	toggleShell(open = !this.shell.running) {
		this.shell.elem.classList.toggle('open', open);
		this.shellButton?.classList.toggle('active', open);
		if (open) this.shell.start();
		else this.shell.stop();
	}

	// Pasted rather than typed, so a multi-line attachment lands in Claude's prompt as one paste and nothing is sent
	// until someone presses Enter
	attachToPrompt(text) {
		if (!this.sendInput(`\x1b[200~${text}\x1b[201~`)) {
			new Notify({ intent: 'warning', content: 'Not attached: reconnecting. Try again in a moment.' });

			return false;
		}

		this.terminal.focus();
		new Notify({ intent: 'success', content: 'Added to the prompt', timeout: 1500 });

		return true;
	}

	get notesOpen() {
		return this.notes.elem.classList.contains('open');
	}

	// Someone else's chat or comment: a toast when the panel isn't showing it, and a desktop notification (if
	// switched on) when this tab isn't in front
	announce({ author, text, tab }) {
		const what = `${author} ${tab === 'comments' ? 'commented' : 'says'}: ${text}`;

		if (document.hidden) {
			showNotification({ title: 'paude', body: what, tag: `paude-${this.options.id}`, url: window.location.href });

			return;
		}

		if (!this.notesOpen || this.notes.tab !== tab) new Notify({ intent: 'info', content: what, timeout: 6000 });
	}

	// The bar's buttons, as a menu: each item presses its button, and says what its badge says and whether its panel is
	// open. A button with a menu label of its own (Watch, Stop watching) already says its state, and opens no panel.
	toggleToolsMenu(anchor, header) {
		this.openMenu(
			anchor,
			[...header.elem.querySelectorAll('.ghost.tool')].map(tool => {
				const count = tool.querySelector('.count');
				const open = !tool.dataset.menuLabel && tool.classList.contains('active');

				return {
					label: tool.dataset.menuLabel ?? tool.title.split(':')[0],
					detail: [count?.style.display !== 'none' && count?.textContent, open && 'open', tool.dataset.menuDetail]
						.filter(Boolean)
						.join(' · '),
					onPress: () => tool.click(),
				};
			}),
		);
	}

	// A menu under a bar button: items ({ label, detail, accent, onPress }) and headings
	openMenu(anchor, items) {
		openMenu(anchor, items);
		this.addCleanup('menu', closeMenu);
	}

	sendSelectionToShell() {
		const text = selectedText(this.terminal, { unwrap: true }).replace(/\s+$/, '');

		if (!text) return;

		this.toggleShell(true);
		this.shell.paste(text);
		this.terminal.clearSelection();
	}

	// The comments' way to the branch's pull request, once there's known to be one: looked up when they show, again a
	// minute after none was found (one may have been opened since, or gh failed), and whenever the Git panel finds one
	pullRequestActions() {
		if (!canBrowse()) return [];
		if (!this.pullRequest && Date.now() - (this.pullRequestLookedUp ?? 0) >= PULL_REQUEST_RECHECK) {
			this.pullRequestLookedUp = Date.now();
			getGit(this.options.id, 'pr').then(({ body }) => {
				if (body?.number) this.pullRequestFound(body);
			});
		}

		return this.pullRequest ? pullRequestActions(this.options.id) : [];
	}

	pullRequestFound(pr) {
		const had = this.pullRequest;

		this.pullRequest = pr;
		if (!had) this.notes?.renderList();
	}

	commentOnSelection() {
		const quote = this.terminal.getSelection().trim();

		if (!quote) return;

		this.notes.startComment(quote);
		this.terminal.clearSelection();
	}

	startLineSelect() {
		if (this.endLineSelect) return this.endLineSelect();

		this.endLineSelect = selectLinesByTap({
			terminal: this.terminal,
			screen: this.screen.elem,
			hint: text => this.lineSelectHint(text),
			purpose: 'copy or comment on',
			onEnd: () => {
				this.endLineSelect = null;
			},
		});
	}

	// Claude scrolls its transcript itself, redrawing in place on whichever screen it uses, so the browser's own
	// scrollback has nothing in it. Mouse reporting is withheld from the browser, so the wheel, and a finger dragged
	// across the terminal, go to Claude as a wheel whenever Claude has asked for one; left to xterm on the alternate
	// screen, the wheel would become arrow keys, which Claude reads as walking through past prompts.
	scrollClaudeWithWheel() {
		this.pointer = claudePointer(this.terminal);
		this.trackPointerMode = this.pointer.track;

		wheelToClaude(this.terminal, this.pointer, data => this.sendInput(data), { allowed: canType });

		const shared = {
			terminal: this.terminal,
			screen: this.screen.elem,
			pointer: this.pointer,
			send: data => this.sendInput(data),
			canType,
		};

		touchToClaude({ ...shared, paused: () => Boolean(this.endLineSelect) });
		clickToClaude({ ...shared, paused: () => Boolean(this.endLineSelect || this.overLink) });
	}

	// Its URLs and the project's file paths in it pressable: a URL opens in a new tab, a file in the files panel
	linkUrls() {
		linkUrls(this.terminal, { over: on => (this.overLink = on) });
	}

	linkFilePaths() {
		linkFilePaths(this.terminal, this.options.id, {
			over: on => (this.overLink = on),
			open: (path, line, lastLine) => {
				this.toggleFiles(true);
				this.files.open(path, line, lastLine);
			},
		});
	}

	showWatching(watching) {
		this.watching = Boolean(watching);
		this.watchButton.classList.toggle('active', this.watching);
		this.watchButton.firstChild.className = `fa-solid fa-${this.watching ? 'eye' : 'eye-slash'}`;
		this.watchButton.dataset.menuLabel = this.watching ? 'Stop watching' : 'Watch';
		this.watchButton.title = this.watching
			? 'Watching: what changes here is counted while you are away. Click to stop.'
			: 'Not watching. Click to count what changes here while you are away.';
	}

	async toggleWatching() {
		const { response } = await setWatching(this.options.id, !this.watching);

		if (response?.ok) this.showWatching(!this.watching);
	}

	// Read again each minute (only what the transcript gained since), so the countdown and a cache warmed again by a
	// turn show as they are
	async loadMeter() {
		if (!this.meterButton) return;

		const { body } = await getMeter(this.options.id);

		this.meter = body?.meter ?? null;
		this.showMeter();
		// Kept warm (or going, or fabled) until a cutoff that each real prompt moves on, and that can pass
		if (body?.lifetime && (body.warmUntil || WARM_LIFETIMES.includes(this.lifetime)))
			this.showLifetime(body.lifetime, body.warmUntil, this.switched);
		if (!this.meterTick) {
			this.meterTick = setInterval(() => this.loadMeter(), 60_000);
			this.addCleanup('meterTick', () => clearInterval(this.meterTick));
		}
	}

	showMeter() {
		const { meter } = this;

		this.meterButton.style.display = meter ? '' : 'none';
		if (!meter) return;

		const left = meter.warmUntil - Date.now();
		const state = left > 0 ? `cached ${Math.ceil(left / 60_000)}m` : 'not cached';

		this.meterText.textContent = ` ${tokens(meter.context)} · ${state}`;
		this.meterButton.classList.toggle('cold', left <= 0);
		this.meterButton.dataset.menuLabel = `Claude's cache: ${tokens(meter.context)}, ${state}`;
		this.meterButton.title = `${tokens(meter.context)} tokens in the conversation; Claude's cache holds it ${left > 0 ? `for ${Math.ceil(left / 60_000)} more minutes` : 'no longer'}`;
		this.showCold(left <= 0);
	}

	// Coming back to a big conversation the cache has let go of: what the next message costs, and compacting first
	showCold(cold) {
		const { meter } = this;
		const shown = cold && meter.context >= COLD_WARNING_TOKENS && !this.lastPresence?.busy && !this.coldDismissed;

		this.coldCard.elem.classList.toggle('shown', Boolean(shown));
		if (!shown) return;

		const into = this.coldCard.elem;
		const answers = element('div', 'answers');

		into.replaceChildren(
			element('div', 'title', "Claude's cache has let go of this conversation"),
			element(
				'div',
				'question',
				`The next message caches all ${tokens(meter.context)} again: about ${tokens(meter.coldCost)} input-token equivalents, ${Math.round(meter.coldCost / meter.warmCost)}× a warm turn. Compacting first reads it once (about ${tokens(meter.context)}) and carries on from a summary.`,
			),
			answers,
		);
		const dismiss = () => {
			this.coldDismissed = true;
			this.coldCard.elem.classList.remove('shown');
		};

		if (canType()) answers.append(button('Compact first', () => (this.compactNow(), dismiss())));
		answers.append(button('Carry on as it is', dismiss));
	}

	catchUp() {
		startCatchUp({
			card: this.tourCard,
			sessionId: this.options.id,
			since: this.seenBefore,
			terminal: this.terminal,
			openActivity:
				this.activityButton &&
				(turnId => {
					this.toggleActivity(true);
					this.activity.focusTurn(turnId);
				}),
		});
	}

	compactNow() {
		this.sendInput('/compact');
		setTimeout(() => this.sendInput('\r'), 300);
	}

	openMeter() {
		const { meter } = this;

		if (!meter) return;

		const left = meter.warmUntil - Date.now();

		this.openMenu(this.meterButton, [
			{ heading: 'In input-token equivalents' },
			{
				label: `${tokens(meter.context)} in the conversation`,
				detail:
					left > 0
						? `cached for ${Math.ceil(left / 60_000)} more minutes`
						: `cache let go at ${clockTime(meter.warmUntil)}`,
				onPress: () => {},
			},
			{
				label: 'The next message',
				detail:
					left > 0
						? `about ${tokens(meter.warmCost)}, read from the cache`
						: `about ${tokens(meter.coldCost)}, cached again`,
				onPress: () => {},
			},
			{
				label: `${tokens(meter.spent)} spent here`,
				detail: `${(meter.hitRate * 100).toFixed(meter.hitRate >= 0.99 ? 1 : 0)}% read from the cache, over ${meter.requests} requests`,
				onPress: () => {},
			},
			...(canType()
				? [
						{
							label: 'Compact now',
							detail: 'a summary takes the place of the conversation',
							onPress: () => this.compactNow(),
						},
					]
				: []),
			{
				label: `Lifetime: ${LIFETIMES[this.lifetime].label}`,
				detail: 'ordinary, kept warm, keeps going, fabled, or short-lived',
				onPress: () => this.openLifetime(),
			},
		]);
	}

	// switched: { was, until }, the lifetime before the last switch by hand, shown struck through while it can be put back
	showLifetime(lifetime = 'ordinary', warmUntil = null, switched = null) {
		if (!this.lifetimeButton) return;
		this.lifetime = lifetime;
		this.warmUntil = warmUntil;
		this.switched = switched?.until > Date.now() ? switched : null;

		const { icon, label } = LIFETIMES[lifetime];
		const until = warmUntil && clockTime(warmUntil);
		const was = this.switched && LIFETIMES[this.switched.was];

		this.lifetimeButton.firstChild.className = `fa-solid fa-${icon}`;
		this.lifetimeText.textContent = ` ${label}`;
		this.lifetimeWas.textContent = was ? ` ${was.label}` : '';
		this.lifetimeButton.classList.toggle('active', WARM_LIFETIMES.includes(lifetime));
		this.lifetimeButton.classList.toggle('going', lifetime === 'going');
		this.lifetimeButton.classList.toggle('fabled', lifetime === 'fabled');
		this.lifetimeButton.classList.toggle('brief', lifetime === 'brief');
		this.lifetimeButton.dataset.menuLabel = `Lifetime: ${label}`;
		if (until) this.lifetimeButton.dataset.menuDetail = `until ${until}`;
		else if (was) this.lifetimeButton.dataset.menuDetail = `was ${was.label.toLowerCase()}`;
		else delete this.lifetimeButton.dataset.menuDetail;
		this.lifetimeButton.title = `Lifetime, ${label}: ${LIFETIMES[lifetime].detail}${until ? ` (until ${until})` : ''}${was ? `. Was ${was.label.toLowerCase()} until you switched it` : ''}. Click to change`;
	}

	openLifetime() {
		const was = this.switched?.until > Date.now() && this.switched.was;

		this.openMenu(this.lifetimeButton, [
			{ heading: 'How long this session lasts' },
			...(was
				? [
						{
							label: `Put back: ${LIFETIMES[was].label}`,
							icon: 'rotate-left',
							detail: `as it was before your last switch, until ${clockTime(this.switched.until)}`,
							onPress: () => this.changeLifetime(was),
						},
					]
				: []),
			...Object.entries(LIFETIMES).map(([lifetime, { label, detail }]) => ({
				label,
				...(lifetime === this.lifetime && { icon: 'check' }),
				detail,
				onPress: () => this.changeLifetime(lifetime),
			})),
		]);
	}

	async changeLifetime(lifetime) {
		const { body, response } = await setLifetime(this.options.id, lifetime);

		if (!response?.ok)
			return new Notify({
				intent: 'danger',
				content: "Couldn't change it (only a running session stays warm, keeps going or is fabled)",
			});
		this.showLifetime(body.lifetime, body.warmUntil, body.switched);
	}

	async rename() {
		const { body } = await getSession(this.options.id);
		const name = await nameDialog({ current: body?.title, pinned: body?.pinned });

		if (name === null) return;

		const { response } = await nameSession(this.options.id, name);

		if (!response?.ok) return new Notify({ intent: 'danger', content: 'Could not rename it.' });

		// A session that isn't running has no presence to bring the new name, so the page fetches it
		const { body: renamed } = await getSession(this.options.id);

		if (renamed?.title) this.showTitle(renamed.title);
	}

	showTitle(title) {
		this.title = title;
		this.titleLabel.elem.textContent = title;
		this.nameTab();
	}

	nameTab() {
		updateTabTitle({
			page: this.title === this.project ? this.title : [this.title, this.project].filter(Boolean).join(' · '),
		});
	}

	markTab() {
		updateTabTitle({
			here: { id: this.options.id, asking: Boolean(this.lastPresence?.waiting), news: this.newsWhileAway },
		});
	}

	async deleteThisSession() {
		const { body } = await getSession(this.options.id);

		if (await confirmDeleteSession({ id: this.options.id, title: body?.title }, deleteSession)) {
			window.location.hash = this.project ? `#/projects/${this.project}` : '#/';
		}
	}

	lineSelectHint(text) {
		this.selectHint.elem.textContent = text ?? '';
		this.selectHint.elem.style.display = text ? '' : 'none';
	}

	jumpTo(quote) {
		const quoteLines = quote.split('\n').map(line => line.trim());
		const anchor = quoteLines.find(Boolean);

		if (!anchor) return;

		const lines = bufferLines(this.terminal);

		for (let index = lines.length - 1; index >= 0; index--) {
			if (!lines[index].includes(anchor)) continue;

			const start = index - quoteLines.indexOf(anchor);

			this.terminal.scrollToLine(Math.max(0, start - 2));
			this.terminal.selectLines(Math.max(0, start), Math.max(0, start) + quoteLines.length - 1);
			if (window.matchMedia(NARROW).matches) this.toggleNotes(false);

			return;
		}

		new Notify({ intent: 'warning', content: 'That text is no longer in the terminal history.' });
	}
}
