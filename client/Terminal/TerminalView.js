import { Button, Elem, Notify, View, styled } from '@vanilla-bean/components';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import {
	attachFile,
	deleteSession,
	forkSession,
	getSession,
	getLinks,
	getTurns,
	listFiles,
	markLink,
	nameSession,
	getArtifacts,
	getAsking,
	getMeter,
	setKeepWarm,
	setWatching,
} from '../api';
import confirmDialog, { confirmDeleteSession, nameDialog } from '../confirmDialog';
import { canBrowse, canNote, canType, identity } from '../identity';
import DONE_MARKER from '../../shared/doneMarker';
import findFilePaths, { pathResolver } from '../../shared/filePaths';
import { tintsOf } from '../../shared/hues';
import tokens from '../../shared/tokenCount';
import findUrls from '../../shared/terminalLinks';
import withoutPointerReporting from '../../shared/pointerReporting';
import { NOTE_TYPES } from '../../shared/protocol';
import { showNotification } from '../notify';
import { recall, remember } from '../storage';
import { button, dragHandle, element } from '../dom';
import { breadcrumbs } from '../Breadcrumbs';
import { closeMenu, openMenu } from '../menu';
import { AskingCard, showAsking, showLimit } from '../Asking';
import attach from './attach';
import { startCatchUp, trackLastSeen } from './catchUp';
import KeyBar from './KeyBar';
import selectLinesByTap from './lineSelect';
import xtermOptions, { loadSymbolsFor, redrawWhenSymbolsLoad } from './xtermOptions';
import FilesPanel from './FilesPanel';
import GitPanel from './GitPanel';
import SharesPanel from './SharesPanel';
import ActivityPanel from './ActivityPanel';
import TasksPanel from './TasksPanel';
import LinksPanel from './LinksPanel';
import ArtifactsPanel from './ArtifactsPanel';
import NotesPanel from './NotesPanel';
import SideShell from './SideShell';
import { Body, NARROW, Presence, SelectHint, SelectionActions, TopBar } from './TerminalView.styles';

const BACKGROUND = '#1b1b1b';
// How far a finger can wander and still be tapping rather than scrolling
const TAP_SLOP = 8;
// How far above and below a row to look for the rest of a URL Claude broke across rows
const URL_ROWS = 6;
// Room kept for the new-session button after a done line, in cells
// Between the selection and its buttons, and the buttons and the edges
const GAP = 6;
// Command with these does what a Mac terminal makes it do: clears the line back to its start, or goes to either end.
// Option with these deletes a word or jumps one, sent here rather than left to the browser, which may take them for
// its own editing.
const MAC_LINE_KEYS = { Backspace: '\x15', ArrowLeft: '\x01', ArrowRight: '\x05' };
const MAC_WORD_KEYS = { Backspace: '\x1b\x7f', ArrowLeft: '\x1bb', ArrowRight: '\x1bf' };

const ghostButton = (appendTo, { icon, label, title, onPress, className = '' }) => {
	const node = button(label, onPress, { icon, title: title ?? '', className: `ghost ${className}` });

	appendTo.elem.append(node);

	return node;
};

const Screen = styled.Component`
	flex: 1;
	min-height: 0;
	overflow: hidden;
	padding: 0 4px;
	background: var(--session-background, ${BACKGROUND});
	/* xterm's own layers (the GPU renderer's link canvas among them) stack in here, under the buttons over the screen */
	isolation: isolate;

	.xterm {
		transform-origin: top left;
	}

	&.selecting {
		outline: 2px dashed hsl(29, 55%, 62%);
		outline-offset: -2px;
	}

	&.dropping {
		outline: 2px dashed var(--session-accent, hsl(29, 55%, 62%));
		outline-offset: -2px;
	}
`;

const ICONS = { web: 'globe', terminal: 'terminal' };
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software/i;

const hardwareWebgl = () => {
	const context = document.createElement('canvas').getContext('webgl2');

	if (!context) return false;

	const info = context.getExtension('WEBGL_debug_renderer_info');
	const renderer = info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER);

	context.getExtension('WEBGL_lose_context')?.loseContext();

	return !SOFTWARE_GL.test(String(renderer));
};
const NOTES_OPEN_KEY = 'paude.notesOpen';
const NOTES_WIDTH_KEY = 'paude.notesWidth';
const FILES_WIDTH_KEY = 'paude.filesWidth';
const MIN_PANEL_WIDTH = 260;
const SHELL_HEIGHT_KEY = 'paude.shellHeight';
const MIN_PANEL_HEIGHT = 140;
const ROLE_LABELS = { owner: 'owner', drive: 'can type', comment: 'can chat and comment', watch: 'viewing' };

const bufferLines = terminal => {
	const buffer = terminal.buffer.active;
	const lines = [];

	for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) ?? '');

	return lines;
};

const METER_AFTER_TURN_MS = 4000;
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
					await fetch('/api/logout', { method: 'POST' });
					window.location.reload();
				},
			});
		}

		const title = new Elem({ addClass: 'title' });

		this.stateDot = new Elem({ appendTo: title, addClass: 'state' });
		this.titleLabel = new Elem({ appendTo: title, addClass: 'name' });
		if (identity()?.owner) {
			// The project's crumb is filled in once the session says which it is
			const { links } = breadcrumbs({
				appendTo: header,
				trail: [{ label: '', href: '#/' }],
				current: title,
				sessionId: this.options.id,
				addCleanup: (name, stop) => this.addCleanup(name, stop),
			});

			[this.projectCrumb] = links;
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

		const body = new Body({ appendTo: this });

		if (canBrowse()) {
			this.filesButton = ghostButton(header, {
				icon: 'folder-tree',
				title: 'Project files',
				className: 'tool',
				onPress: () => this.toggleFiles(),
			});
			this.activityButton = ghostButton(header, {
				icon: 'clock-rotate-left',
				title: 'Activity: what Claude did, turn by turn',
				className: 'tool',
				onPress: () => this.toggleActivity(),
			});
			this.tasksButton = ghostButton(header, {
				icon: 'list-check',
				title: "Tasks: the project's checks and tests, problems, and what's running",
				className: 'tool',
				onPress: () => this.toggleTasks(),
			});
			this.linksButton = ghostButton(header, {
				icon: 'link',
				title: 'Links: the docs, tickets, repos and servers that came up',
				className: 'tool',
				onPress: () => this.toggleLinks(),
			});
			this.artifactsButton = ghostButton(header, {
				icon: 'shapes',
				title: 'Artifacts: the screenshots, pages, scripts and data made along the way',
				className: 'tool',
				onPress: () => this.toggleArtifacts(),
			});
			this.gitButton = ghostButton(header, {
				icon: 'code-branch',
				title: 'Git: changes, history, branches',
				className: 'tool',
				onPress: () => this.toggleGit(),
			});
		}
		if (canType()) {
			this.shellButton = ghostButton(header, {
				icon: 'terminal',
				title: 'Terminal: a shell in this folder that ends when you close it',
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
			this.warmButton = ghostButton(header, {
				icon: 'mug-hot',
				title: 'Keep warm',
				className: 'tool',
				onPress: () => this.toggleKeepWarm(),
			});
			this.showKeepWarm(null);
		}
		this.sharesButton = ghostButton(header, {
			icon: 'share-nodes',
			title: 'Shared: services this session runs, files and sites',
			className: 'tool',
			onPress: () => this.toggleShares(),
		});
		this.sharedCount = Object.assign(document.createElement('span'), { className: 'count' });
		this.sharedCount.style.display = 'none';
		this.sharesButton.append(this.sharedCount);
		this.notesToggle = ghostButton(header, {
			icon: 'comments',
			title: 'Chat and comments',
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

		selectionButton({ textContent: '📋 Copy' }, () => this.copySelection());
		if (canType())
			selectionButton(
				{
					icon: 'terminal',
					textContent: 'Terminal',
					attributes: { title: "Put it on the terminal's command line" },
				},
				() => this.sendSelectionToShell(),
			);
		if (canNote()) selectionButton({ textContent: '💬 Comment' }, () => this.commentOnSelection());
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
			sessionId: this.options.id,
			close: () => this.toggleFiles(false),
			setFullscreen: on => this.files.elem.classList.toggle('fullscreen', on),
			attach: text => {
				if (this.attachToPrompt(text)) this.toggleFiles(false);
			},
		});
		if (canBrowse()) {
			this.git = new GitPanel({
				appendTo: body,
				addClass: 'git',
				sessionId: this.options.id,
				close: () => this.toggleGit(false),
				// A file's change or a whole commit, in the files panel's diff view
				openDiff: source => {
					// A phone has room for one panel, and the diff is what was asked for
					if (window.matchMedia(NARROW).matches) this.toggleGit(false);
					this.toggleFiles(true);
					this.files.openDiffSet(source);
				},
				changed: () => this.files.changesMayHaveChanged(),
			});
			this.addResizeHandle(this.git.elem, { variable: '--notes-width', key: NOTES_WIDTH_KEY, edge: 'left' });
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
			this.addResizeHandle(this.activity.elem, { variable: '--notes-width', key: NOTES_WIDTH_KEY, edge: 'left' });
			this.tasks = new TasksPanel({
				appendTo: body,
				addClass: 'tasks',
				sessionId: this.options.id,
				close: () => this.toggleTasks(false),
				openFile: (path, line) => {
					if (window.matchMedia(NARROW).matches) this.toggleTasks(false);
					this.toggleFiles(true);
					this.files.open(path, line);
				},
				attach: text => this.attachToPrompt(text),
			});
			this.addResizeHandle(this.tasks.elem, { variable: '--notes-width', key: NOTES_WIDTH_KEY, edge: 'left' });
			this.links = new LinksPanel({
				appendTo: body,
				addClass: 'links',
				load: () => getLinks(this.options.id),
				mark: (url, change) => markLink(this.options.id, url, change),
				close: () => this.toggleLinks(false),
			});
			this.addResizeHandle(this.links.elem, { variable: '--notes-width', key: NOTES_WIDTH_KEY, edge: 'left' });
			this.artifacts = new ArtifactsPanel({
				appendTo: body,
				addClass: 'links',
				sessionId: this.options.id,
				load: () => getArtifacts(this.options.id),
				close: () => this.toggleArtifacts(false),
			});
			this.addResizeHandle(this.artifacts.elem, { variable: '--notes-width', key: NOTES_WIDTH_KEY, edge: 'left' });
		}
		this.shares = new SharesPanel({
			appendTo: body,
			addClass: 'shares',
			sessionId: this.options.id,
			close: () => this.toggleShares(false),
		});
		this.addResizeHandle(this.shares.elem, { variable: '--notes-width', key: NOTES_WIDTH_KEY, edge: 'left' });
		if (canType()) {
			this.shell = new SideShell({
				appendTo: body,
				addClass: 'shell',
				sessionId: this.options.id,
				close: () => this.toggleShell(false),
				attach: text => this.attachToPrompt(text),
				ended: why => {
					this.toggleShell(false);
					if (why) new Notify({ type: 'warning', content: why });
				},
			});
		}
		this.notes = new NotesPanel({
			appendTo: body,
			addClass: 'notes',
			sessionId: this.options.id,
			send: message => Boolean(this.connection?.send(message)),
			jump: quote => this.jumpTo(quote),
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

		this.addResizeHandle(this.notes.elem, { variable: '--notes-width', key: NOTES_WIDTH_KEY, edge: 'left' });
		this.addResizeHandle(this.files.elem, { variable: '--files-width', key: FILES_WIDTH_KEY, edge: 'right' });
		if (this.shell) {
			this.addResizeHandle(this.shell.elem, { variable: '--shell-height', key: SHELL_HEIGHT_KEY, edge: 'top' });
		}
		if (recall(NOTES_OPEN_KEY)) this.toggleNotes(true, { focus: false });

		this.loadInfo();
	}

	async loadInfo() {
		const { body, response } = await getSession(this.options.id);

		if (!response?.ok) return;

		this.project = body.project;
		this.paint(body.hue);
		this.showWatching(body.watching);
		this.showKeepWarm(body.warmUntil);
		this.loadMeter();
		if (this.projectCrumb) {
			this.projectCrumb.textContent = body.project;
			this.projectCrumb.href = `#/projects/${encodeURIComponent(body.project)}`;
			this.projectCrumb.style.display = '';
			this.projectCrumb.previousSibling.style.display = '';
		}
		if (!this.titleLabel.elem.textContent) this.titleLabel.elem.textContent = body.title || body.project;
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

		// A cleanup, not onDisconnected: the router destroys the view, and a destroyed view never hears its removal
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
		this.useGpuRenderer();
		redrawWhenSymbolsLoad(this.terminal);
		if (identity()?.owner) this.markDoneLines();
		this.linkUrls();
		if (canType()) this.acceptFiles();
		if (canBrowse()) this.linkFilePaths();
		this.terminal.onData(data => this.sendInput(data));
		this.scrollClaudeWithWheel();
		this.terminal.onSelectionChange(() => this.placeSelectionActions());
		// Output scrolls the selection, and the buttons with it, except from under a pointer reaching for them
		this.terminal.onScroll(() => {
			if (!this.selectionActions.elem.matches(':hover')) this.placeSelectionActions();
		});
		// Ctrl+C copies what's selected, as in a Windows terminal; with nothing selected it still interrupts Claude
		this.terminal.attachCustomKeyEventHandler(event => {
			const lineKey =
				(event.metaKey && !event.ctrlKey && !event.altKey && MAC_LINE_KEYS[event.key]) ||
				(event.altKey && !event.ctrlKey && !event.metaKey && MAC_WORD_KEYS[event.key]);

			if (lineKey) {
				event.preventDefault();
				if (event.type === 'keydown' && canType()) this.sendInput(lineKey);

				return false;
			}

			const copy =
				event.type === 'keydown' &&
				event.ctrlKey &&
				!event.altKey &&
				!event.metaKey &&
				event.key.toLowerCase() === 'c' &&
				this.terminal.hasSelection();

			if (copy) {
				event.preventDefault();
				this.copySelection();
			}

			return !copy;
		});

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

	// The default renderer builds every cell as page elements, so a large session (scaled to fit, at that) costs a
	// full layout and paint on each of Claude's redraws. WebGL draws the whole grid on the GPU, but only on a real
	// one: software WebGL (llvmpipe and the like) is slower than the DOM renderer it would replace.
	useGpuRenderer() {
		if (!hardwareWebgl()) return;

		try {
			const gpu = new WebglAddon();

			gpu.onContextLoss(() => gpu.dispose());
			this.terminal.loadAddon(gpu);
		} catch {
			// No WebGL here after all; the DOM renderer it was created with stays in use
		}
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
			new Notify({ type: 'error', content: `This session won't start: ${reason}`, timeout: 0 });
		}

		this.renderPresence(this.lastPresence ?? { clients: [] });
	}

	handleMessage(message) {
		if (message.type === 'snapshot') {
			this.terminal.reset();
			this.terminal.resize(message.cols, message.rows);
			this.decoder = new TextDecoder();
			this.pointerModes.clear();
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
			new Notify({ type: 'warning', content: message.text });
		} else if (NOTE_TYPES.includes(message.type)) {
			this.notes.receive(message);
		}
	}

	renderPresence(presence) {
		const { busy, waiting, title, clients, you } = presence;

		// Claude waiting, or done, is when a proposal appears or a turn's changes (and new files) land
		if (this.lastPresence && (waiting !== this.lastPresence.waiting || busy !== this.lastPresence.busy)) {
			this.files?.changesMayHaveChanged();
			if (this.git?.elem.classList.contains('open')) this.git.refresh();
			this.activity?.busy(busy);
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
		this.notes.myName = clients[you]?.name;
		if (title && this.connectionState !== 'ended') this.titleLabel.elem.textContent = title;

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
			await new Promise(done => setTimeout(done, wait));
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

	// A side panel's inner edge drags its width; the side terminal's top edge drags its height
	addResizeHandle(panel, { variable, key, edge }) {
		const handle = document.createElement('div');
		const vertical = edge === 'top';
		const setWidth = size => {
			const [min, max] = vertical
				? [MIN_PANEL_HEIGHT, window.innerHeight * 0.85]
				: [MIN_PANEL_WIDTH, window.innerWidth * 0.9];
			const clamped = Math.round(Math.min(Math.max(size, min), max));

			panel.style.setProperty(variable, `${clamped}px`);

			return clamped;
		};

		handle.className = 'resize';
		panel.append(handle);

		if (Number(recall(key))) setWidth(Number(recall(key)));

		let bounds;
		const widthAt = event => {
			if (vertical) return bounds.bottom - event.clientY;

			return edge === 'left' ? bounds.right - event.clientX : event.clientX - bounds.left;
		};

		dragHandle(handle, {
			onStart: () => {
				bounds = panel.getBoundingClientRect();
				panel.classList.add('resizing');
			},
			onMove: event => setWidth(widthAt(event)),
			onDone: event => {
				remember(key, String(setWidth(widthAt(event))));
				panel.classList.remove('resizing');
			},
		});
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
				type: 'info',
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
			new Notify({ type: 'warning', content: 'Not attached: reconnecting. Try again in a moment.' });

			return false;
		}

		this.terminal.focus();
		new Notify({ type: 'success', content: 'Added to the prompt', timeout: 1500 });

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

		if (!this.notesOpen || this.notes.tab !== tab) new Notify({ type: 'info', content: what, timeout: 6000 });
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

	// One here opens here; one on another server, through a link that logs this browser in there
	async copySelection() {
		const text = this.terminal.getSelection();

		if (!text) return;

		try {
			await navigator.clipboard.writeText(text);
			this.terminal.clearSelection();
			new Notify({ type: 'success', content: 'Copied', timeout: 1500 });
		} catch {
			new Notify({ type: 'error', content: "The browser wouldn't let paude copy; its own Copy still works." });
		}
	}

	sendSelectionToShell() {
		const text = this.terminal.getSelection().replace(/\s+$/, '');

		if (!text) return;

		this.toggleShell(true);
		this.shell.paste(text);
		this.terminal.clearSelection();
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
		this.pointerModes = new Set();
		this.trackPointerMode = (mode, on) => (on ? this.pointerModes.add(mode) : this.pointerModes.delete(mode));

		const tracking = () => ['1000', '1002', '1003'].some(mode => this.pointerModes.has(mode));

		this.terminal.attachCustomWheelEventHandler(event => {
			// Not asked for: xterm scrolls its own scrollback, which the alternate screen doesn't have
			if (!tracking()) return this.terminal.buffer.active.type !== 'alternate';
			if (!canType() || !event.deltaY) return false;

			// A touchpad sends many small deltas; a notch of a wheel is about 100
			this.sendWheel(event.deltaY < 0, event, Math.max(1, Math.round(Math.abs(event.deltaY) / 100)));

			return false;
		});

		this.scrollClaudeWithTouch(tracking);
		this.clickClaude(tracking);
	}

	// xterm would scroll its own empty scrollback under the finger; every two rows dragged is a notch of the wheel
	// instead, down to see earlier. Taps pass through, so a tap still brings up the keyboard.
	scrollClaudeWithTouch(tracking) {
		const screen = this.screen.elem;
		let start = null;
		let last = null;

		screen.addEventListener('touchstart', event => {
			start = last = event.touches.length === 1 ? event.touches[0].clientY : null;
		});
		screen.addEventListener(
			'touchmove',
			event => {
				if (last === null || this.endLineSelect) return;

				const touch = event.touches[0];

				if (Math.abs(touch.clientY - start) < TAP_SLOP) return;

				const step = (this.terminal.element.getBoundingClientRect().height / this.terminal.rows) * 2;
				const notches = Math.trunc((touch.clientY - last) / step);

				event.preventDefault();
				event.stopPropagation();
				if (!notches) return;

				last += notches * step;
				if (!tracking()) {
					if (this.terminal.buffer.active.type !== 'alternate') this.terminal.scrollLines(-notches * 2);
				} else if (canType()) this.sendWheel(notches > 0, touch, Math.abs(notches));
			},
			{ capture: true, passive: false },
		);
		screen.addEventListener('touchend', () => {
			last = null;
		});
	}

	// The terminal cell under a point, 1-based, as mouse reports count them
	cellAt({ clientX, clientY }) {
		// The screen, not the terminal element: scaled down, the element keeps its full-size width and the screen spills out
		const bounds = this.terminal.element.querySelector('.xterm-screen').getBoundingClientRect();
		const clamp = (value, most) => Math.min(Math.max(Math.ceil(value), 1), most);

		return {
			column: clamp(((clientX - bounds.left) / bounds.width) * this.terminal.cols, this.terminal.cols),
			row: clamp(((clientY - bounds.top) / bounds.height) * this.terminal.rows, this.terminal.rows),
		};
	}

	// A mouse report in the encoding Claude asked for; the legacy one has no button for a release, only 3
	mouseReport(button, point, { release = false } = {}) {
		const { column, row } = this.cellAt(point);

		if (this.pointerModes.has('1006')) return `\x1b[<${button};${column};${row}${release ? 'm' : 'M'}`;

		return `\x1b[M${String.fromCharCode(32 + (release ? 3 : button), 32 + column, 32 + row)}`;
	}

	// Wheel notches up or down at a point on the terminal
	sendWheel(up, point, notches) {
		this.sendInput(this.mouseReport(up ? 64 : 65, point).repeat(notches));
	}

	// A file dropped or pasted onto the terminal is saved on the server and its path put in the prompt, where Claude
	// reads it (an image's path becomes an attached image); a text paste still goes through as typing
	acceptFiles() {
		const screen = this.screen.elem;
		const carriesFiles = event => event.dataTransfer?.types.includes('Files');

		screen.addEventListener('dragover', event => {
			if (!carriesFiles(event)) return;
			event.preventDefault();
			screen.classList.add('dropping');
		});
		screen.addEventListener('dragleave', () => screen.classList.remove('dropping'));
		screen.addEventListener('drop', event => {
			screen.classList.remove('dropping');
			if (!carriesFiles(event)) return;
			event.preventDefault();
			this.attachFiles([...event.dataTransfer.files]);
		});
		screen.addEventListener(
			'paste',
			event => {
				const files = [...(event.clipboardData?.files ?? [])];

				if (!files.length) return;
				event.preventDefault();
				event.stopPropagation();
				this.attachFiles(files);
			},
			true,
		);
	}

	async attachFiles(files) {
		const paths = [];

		for (const file of files) {
			const { response, body } = await attachFile(this.options.id, file);

			if (response.ok) paths.push(body.path);
			else new Notify({ type: 'warning', content: `${file.name || 'The file'} wasn't attached: ${body}` });
		}
		if (paths.length) this.attachToPrompt(`${paths.join(' ')} `);
	}

	// A click or tap that selected nothing goes to Claude, which moves its cursor there; a drag still selects
	clickClaude(tracking) {
		this.screen.elem.addEventListener('click', event => {
			if (
				event.button !== 0 ||
				!tracking() ||
				!canType() ||
				this.endLineSelect ||
				this.overLink ||
				this.terminal.hasSelection()
			)
				return;

			this.sendInput(this.mouseReport(0, event) + this.mouseReport(0, event, { release: true }));
		});
	}

	// Every "done" line Claude prints after a turn gets a button after it that starts a new session from that point.
	// Drawn by paude over the rows on screen, redrawn with them: xterm's own decorations hide on the alternate screen,
	// which Claude draws on.
	markDoneLines() {
		let pending = false;
		const queue = () => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => {
				pending = false;
				this.placeForkButtons();
			});
		};

		this.forkLayer = element('div', 'fork-layer');
		this.screen.elem.after(this.forkLayer);
		this.terminal.onRender(queue);
		this.terminal.onScroll(queue);
	}

	placeForkButtons() {
		const { rows, cols } = this.terminal;
		const buffer = this.terminal.buffer.active;
		const screen = this.terminal.element.querySelector('.xterm-screen').getBoundingClientRect();
		const column = this.forkLayer.parentElement.getBoundingClientRect();
		const cellWidth = screen.width / cols;
		const cellHeight = screen.height / rows;
		const spare = [...this.forkLayer.children];
		let used = 0;

		for (let row = 0; row < rows; row++) {
			const { text, columns } = this.bufferCells(buffer.viewportY + row);
			const found = DONE_MARKER.exec(text);

			if (!found) continue;

			const fork = spare[used++] ?? this.forkButton();
			const after = columns[found.index + found[0].length - 1] + 1;

			fork.dataset.line = buffer.viewportY + row;
			Object.assign(fork.style, { height: `${cellHeight}px`, fontSize: `${cellHeight * 0.65}px` });
			// Its words when they fit after the line, its icon alone when they'd cover it (a phone's narrow rows)
			fork.classList.remove('compact');
			fork.classList.toggle('compact', fork.offsetWidth > (cols - after) * cellWidth);

			const x = Math.min(after, cols - Math.ceil(fork.offsetWidth / cellWidth));

			Object.assign(fork.style, {
				left: `${screen.left - column.left + x * cellWidth}px`,
				top: `${screen.top - column.top + row * cellHeight}px`,
			});
		}

		spare.slice(used).forEach(fork => fork.remove());
	}

	forkButton() {
		const fork = button('', () => this.forkFromMarker(Number(fork.dataset.line)), {
			icon: 'code-branch',
			title: 'Start a new session holding the conversation up to this turn',
			className: 'fork-here',
		});

		fork.append(element('span', 'words', 'New session from here'));
		fork.setAttribute('aria-label', 'New session from here');
		this.forkLayer.append(fork);

		return fork;
	}

	// Plain URLs open in a new tab, one Claude broke across rows included; the rows around each one are searched so a
	// broken URL is the same link from any of its rows
	linkUrls() {
		this.terminal.registerLinkProvider({
			provideLinks: (lineNumber, callback) => {
				const first = Math.max(lineNumber - 1 - URL_ROWS, 0);
				const rows = [];

				for (let index = first; index <= lineNumber - 1 + URL_ROWS; index++) rows.push(this.bufferCells(index));

				const links = findUrls(
					rows.map(({ text }) => text),
					this.terminal.cols,
				)
					.filter(({ parts }) => parts.some(({ row }) => first + row === lineNumber - 1))
					.map(({ url, parts }) => {
						const [start, end] = [parts[0], parts.at(-1)];

						return {
							range: {
								start: { x: rows[start.row].columns[start.from], y: first + start.row + 1 },
								end: { x: rows[end.row].columns[end.to - 1], y: first + end.row + 1 },
							},
							text: url,
							decorations: { pointerCursor: true, underline: true },
							hover: () => (this.overLink = true),
							leave: () => (this.overLink = false),
							activate: () => window.open(url, '_blank', 'noopener,noreferrer'),
						};
					});

				callback(links.length ? links : undefined);
			},
		});
	}

	// The project's files Claude names open in the files panel, at the lines named
	linkFilePaths() {
		this.terminal.registerLinkProvider({
			provideLinks: async (lineNumber, callback) => {
				this.resolvePath ??= listFiles(this.options.id).then(({ body, response }) =>
					pathResolver(response?.ok ? body : []),
				);

				const { text, columns } = this.bufferCells(lineNumber - 1);
				const links = findFilePaths(text, await this.resolvePath).map(({ path, line, lastLine, from, to }) => ({
					range: { start: { x: columns[from], y: lineNumber }, end: { x: columns[to - 1], y: lineNumber } },
					text: path,
					decorations: { pointerCursor: true, underline: true },
					hover: () => (this.overLink = true),
					leave: () => (this.overLink = false),
					activate: () => {
						this.toggleFiles(true);
						this.files.open(path, line, lastLine);
					},
				}));

				callback(links.length ? links : undefined);
			},
		});
	}

	// Beside the selection rather than in a corner, which a panel can cover: above its first row, clear of the text,
	// or below its last when there's no room above
	placeSelectionActions() {
		const actions = this.selectionActions.elem;
		const position = this.terminal.hasSelection() && this.terminal.getSelectionPosition();

		actions.style.display = position ? '' : 'none';
		if (!position) return;

		const screen = this.terminal.element.querySelector('.xterm-screen').getBoundingClientRect();
		const column = actions.parentElement.getBoundingClientRect();
		const cellWidth = screen.width / this.terminal.cols;
		const cellHeight = screen.height / this.terminal.rows;
		const rowTop = row => screen.top - column.top + (row - this.terminal.buffer.active.viewportY) * cellHeight;
		const clamp = (value, room) => Math.min(Math.max(value, GAP), room - GAP);
		let top = rowTop(position.start.y) - actions.offsetHeight - GAP;

		if (top < GAP) top = rowTop(position.end.y + 1) + GAP;

		actions.style.top = `${clamp(top, column.height - actions.offsetHeight)}px`;
		actions.style.left = `${clamp(screen.left - column.left + position.start.x * cellWidth, column.width - actions.offsetWidth)}px`;
	}

	// A row's text and, for each character of it, the 1-based column it's drawn in (a wide character takes two)
	bufferCells(index) {
		const line = this.terminal.buffer.active.getLine(index);
		const columns = [];
		let text = '';

		for (let x = 0; line && x < this.terminal.cols; x++) {
			const cell = line.getCell(x);

			if (!cell || cell.getWidth() === 0) continue;

			const chars = cell.getChars() || ' ';

			text += chars;
			for (let unit = 0; unit < chars.length; unit++) columns.push(x + 1);
		}

		return { text: text.trimEnd(), columns };
	}

	bufferLine(index) {
		return this.terminal.buffer.active.getLine(index)?.translateToString(true) ?? '';
	}

	// The screen only shows text, so the marker is matched to a turn by position: the nth marker from the bottom
	// is the nth completed turn from the end, which holds even when older scrollback is gone. The confirmation
	// shows that turn's prompt, so a mismatch is visible before anything is created.
	async forkFromMarker(markerLine) {
		let markersBelow = 0;

		for (let index = markerLine + 1; index < this.terminal.buffer.active.length; index++) {
			if (DONE_MARKER.test(this.bufferLine(index))) markersBelow += 1;
		}

		const { body, response } = await getTurns(this.options.id);

		if (!response?.ok) return new Notify({ type: 'error', content: "Could not read this session's history." });

		// A turn still in progress has replies but no marker yet
		const turns = body.busy && body.turns.at(-1)?.last ? body.turns.slice(0, -1) : body.turns;
		const turn = turns[turns.length - 1 - markersBelow];

		if (!turn) return new Notify({ type: 'warning', content: 'Could not match that line to a turn in the history.' });

		const confirmed = await confirmDialog({
			header: 'New session from here?',
			body: `It will hold this conversation up to and including the turn that began: "${turn.prompt}"`,
			confirmLabel: 'Start it',
		});

		if (!confirmed) return;

		const forked = await forkSession(this.options.id, turn.endUuid);

		if (!forked.response?.ok) return new Notify({ type: 'error', content: 'Could not start the new session.' });

		window.location.hash = `#/sessions/${forked.body.id}`;
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
		if (body && 'warmUntil' in body) this.showKeepWarm(body.warmUntil);
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
		const state = left > 0 ? `warm ${Math.ceil(left / 60_000)}m` : 'cold';

		this.meterText.textContent = ` ${tokens(meter.context)} · ${state}`;
		this.meterButton.classList.toggle('cold', left <= 0);
		this.meterButton.dataset.menuLabel = `Cache: ${tokens(meter.context)}, ${state}`;
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
						: `cache let go at ${new Date(meter.warmUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
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
				label: this.warmUntil ? 'Stop keeping warm' : 'Keep warm',
				detail: this.warmUntil ? 'pinged while you are away' : 'ping it while you are away, 12 hours',
				onPress: () => this.toggleKeepWarm(),
			},
		]);
	}

	showKeepWarm(until) {
		if (!this.warmButton) return;
		this.warmUntil = until ?? null;

		const time = until && new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

		this.warmButton.classList.toggle('active', Boolean(until));
		this.warmButton.dataset.menuLabel = until ? 'Stop keeping warm' : 'Keep warm';
		if (until) this.warmButton.dataset.menuDetail = `until ${time}`;
		else delete this.warmButton.dataset.menuDetail;
		this.warmButton.title = until
			? `Kept warm until ${time}: once Claude has been quiet 50 minutes, paude pings it, so coming back finds the whole conversation still cached and not compacted. Click to stop.`
			: 'Keep warm: while you are away, ping Claude before its prompt cache expires and the conversation is compacted (12 hours, a cached read of the conversation each 50 minutes)';
	}

	async toggleKeepWarm() {
		const { body, response } = await setKeepWarm(this.options.id, this.warmUntil ? 0 : 12);

		if (response?.ok) this.showKeepWarm(body.until);
		else new Notify({ type: 'error', content: "Couldn't keep this session warm (only a running session can be)" });
	}

	async rename() {
		const { body } = await getSession(this.options.id);
		const name = await nameDialog({ current: body?.title, pinned: body?.pinned });

		if (name === null) return;

		const { response } = await nameSession(this.options.id, name);

		if (!response?.ok) return new Notify({ type: 'error', content: 'Could not rename it.' });

		// A session that isn't running has no presence to bring the new name, so the page fetches it
		const { body: renamed } = await getSession(this.options.id);

		if (renamed?.title) this.titleLabel.elem.textContent = renamed.title;
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

		new Notify({ type: 'warning', content: 'That text is no longer in the terminal history.' });
	}
}
