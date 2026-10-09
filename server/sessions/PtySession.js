import xtermHeadless from '@xterm/headless';
import serializeAddon from '@xterm/addon-serialize';

import { sessionHue } from '../../shared/hues';
import inputKind, { FOCUS_IN } from '../../shared/inputKind';
import { setStatus, statusOf } from '../activity';
import { hookSettings } from '../hookSettings';
import { warmUntil } from '../keepWarm';
import { pinnedName } from '../names';
import parseTitle from './claudeTitle';
import readDialog from './dialog';
import readPromptDraft from './promptBox';
import { endHeld, heldCommand, releaseHeld } from './holder';

const { Terminal } = xtermHeadless;
const { SerializeAddon } = serializeAddon;

const ESC = '\x1b';

// Nobody attached for this long: the prompt cache has expired anyway, so an idle process holds nothing worth keeping
// (unless it's kept warm)
const IDLE_EXIT_MS = 60 * 60 * 1000;
// A session still working or kept warm at that point gets this much longer, again and again, until it isn't
const BUSY_RECHECK_MS = 10 * 60 * 1000;
// How long the size is off by a row when a session taken back is asked to redraw, and how soon after
const REDRAW_NUDGE_MS = 300;
const SCROLLBACK_LINES = 5000;
const SIZE_LIMITS = { cols: [20, 500], rows: [5, 200] };

// Markers a Claude Code process sets for its children, and a multiplexer's own markers. Passed on, they make each
// session think it's a subprocess of the paude's parent (and stop saving its transcript), or nested in tmux
// (where its title stops showing whether it's busy).
const INHERITED_MARKER =
	/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_(CHILD_SESSION|ENTRYPOINT|EXECPATH|MESSAGING_\w+|SESSION_\w+)|TMUX|TMUX_PANE|STY|COLUMNS|LINES)$/;

// Terminal modes the serializer doesn't carry, replayed after each snapshot so a joiner's terminal matches
// (mouse encoding, focus reports, bracketed paste, cursor keys and visibility)
const TRACKED_MODES = new Set(['1', '25', '1000', '1002', '1003', '1004', '1006', '2004']);
const MODE_CHANGE = new RegExp(`${ESC}\\[\\?([\\d;]+)([hl])`, 'g');

export const sessionEnvironment = () =>
	Object.fromEntries(Object.entries(process.env).filter(([name]) => !INHERITED_MARKER.test(name)));

const clientName = (name, fallback) =>
	String(name ?? '')
		.trim()
		.slice(0, 40) || fallback;

const clampSize = (value, [min, max]) => {
	const number = Math.round(Number(value));

	return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : null;
};

const canDrive = client => client.role === 'owner' || client.role === 'drive';

const send = (socket, message) => socket.send(typeof message === 'string' ? message : JSON.stringify(message));

// One real Claude Code process per session, in a PTY. Every attached client (browser or terminal) sees the same
// screen; whoever typed last sets its size. A headless xterm mirrors the screen so late joiners start in sync.
export default class PtySession {
	clients = new Set();
	// The client whose size the session takes (the last to type), not the Drive role
	driver = null;
	busy = false;
	title = '';
	modes = new Map();
	ended = false;
	startedAt = Date.now();

	constructor({ id, cwd, resume, prompt, claudePath, onExit, adopt = false, title = '' }) {
		this.id = id;
		this.cwd = cwd;
		// What it was called when saved, until Claude names it again (it does only when the name changes)
		this.title = title;
		this.onExit = onExit;
		this.cols = 100;
		this.rows = 30;
		this.decoder = new TextDecoder();

		this.mirror = new Terminal({
			cols: this.cols,
			rows: this.rows,
			scrollback: SCROLLBACK_LINES,
			allowProposedApi: true,
		});
		this.serializer = new SerializeAddon();
		this.mirror.loadAddon(this.serializer);
		this.mirror.onTitleChange(terminalTitle => {
			const { busy, title } = parseTitle(terminalTitle);

			// The glyph alternates every second while busy; only a change in state or title is news
			if (busy === this.busy && title === this.title) return;

			this.busy = busy;
			this.title = title;
			this.broadcastPresence();
		});

		const settings = hookSettings();
		// `--` keeps a prompt that starts with a dash from being read as an option
		const args = [
			...(settings ? ['--settings', settings] : []),
			...(resume ? ['--resume', id] : ['--session-id', id, ...(prompt ? ['--', prompt] : [])]),
		];

		const env = { ...sessionEnvironment(), TERM: 'xterm-256color', COLORTERM: 'truecolor', PAUDE_SESSION: id };
		const command = heldCommand({ id, cwd, env, command: [claudePath, ...args] }) ?? [claudePath, ...args];

		// Taken back after a restart, it's in whatever state it was left in
		if (!adopt) setStatus(id, 'ready');

		this.process = Bun.spawn(command, {
			cwd,
			env,
			terminal: {
				cols: this.cols,
				rows: this.rows,
				data: (terminal, data) => this.output(data),
			},
		});

		this.process.exited.then(() => this.exited());
		this.resetIdle();
		if (adopt) this.redrawSoon();
	}

	// Taken back after a restart, Claude has drawn nothing for this server to show, and the redraw dtach asks for on
	// attaching doesn't come (its size didn't change). A size that really changes, for a moment, has it draw it all.
	redrawSoon() {
		setTimeout(() => {
			if (this.ended) return;
			this.process.terminal.resize(this.cols, this.rows - 1);
			setTimeout(() => !this.ended && this.process.terminal.resize(this.cols, this.rows), REDRAW_NUDGE_MS);
		}, REDRAW_NUDGE_MS);
	}

	// Clients first: the mirror and the mode tracking only matter to the next joiner, so they wait behind delivery
	output(data) {
		for (const client of this.clients) {
			if (client.pending) client.pending.push(data);
			else client.socket.send(data);
		}

		this.mirror.write(data);
		this.trackModes(data);
	}

	trackModes(data) {
		const text = this.decoder.decode(data, { stream: true });

		for (const [, list, action] of text.matchAll(MODE_CHANGE)) {
			for (const mode of list.split(';')) if (TRACKED_MODES.has(mode)) this.modes.set(mode, action);
		}
	}

	attach(socket, { kind, label, name, role, cols, rows }) {
		const device = String(label ?? '').slice(0, 40) || 'someone';
		const client = {
			socket,
			kind: kind === 'terminal' ? 'terminal' : 'web',
			label: device,
			name: clientName(name, device),
			role,
			cols: clampSize(cols, SIZE_LIMITS.cols),
			rows: clampSize(rows, SIZE_LIMITS.rows),
		};

		this.clients.add(client);
		clearTimeout(this.idleTimer);

		if (!this.driver && canDrive(client)) this.drive(client);
		else if (client.kind === 'terminal' && canDrive(client)) this.fitSize();

		this.sendSnapshot(client);
		this.broadcastPresence();

		return client;
	}

	// The mirror parses asynchronously; output still queued when the snapshot is taken would be missing from it.
	// So the snapshot waits for the mirror to catch up, and output arriving meanwhile is held for this client.
	sendSnapshot(client) {
		client.pending = [];

		this.mirror.write('', () => {
			if (!this.clients.has(client)) return;

			const modes = [...this.modes].map(([mode, action]) => `${ESC}[?${mode}${action}`).join('');

			send(client.socket, {
				type: 'snapshot',
				cols: this.cols,
				rows: this.rows,
				data: this.serializer.serialize() + modes,
			});

			for (const data of client.pending) client.socket.send(data);
			client.pending = null;
		});
	}

	broadcast(message) {
		for (const { socket } of this.clients) send(socket, message);
	}

	detach(client) {
		this.clients.delete(client);

		if (this.ended) return;

		if (this.driver === client) this.driver = [...this.clients].findLast(canDrive) ?? null;
		this.fitSize();
		if (!this.clients.size) this.resetIdle();

		this.broadcastPresence();
	}

	// Every attached terminal answers Claude's queries; if answers claimed the size, two clients would take turns
	// resizing forever. Only the driver's answers reach Claude, and no answer or pointer report claims the size.
	// A terminal's focus-in does: that person just switched to it.
	input(client, data) {
		const kind = inputKind(data);
		const driving = this.driver === client;

		if (kind === 'reply' && !driving) return;

		if (!driving && (kind === 'typing' || (client.kind === 'terminal' && data.includes(FOCUS_IN)))) {
			this.drive(client);
		}

		// Someone answered the question (or pressed Esc on it); hooks and the title say what follows
		if (kind === 'typing' && statusOf(this.id) === 'waiting') setStatus(this.id, 'working');

		this.process.terminal.write(data);
	}

	// Typed in by paude itself (a message from chat or comments), not by anyone attached
	typeIn(data) {
		this.process.terminal.write(data);
	}

	// What's typed in Claude's prompt box now, from the screen paude keeps ('' for nothing, null for no box)
	promptDraft() {
		return readPromptDraft(this.mirror.buffer.active);
	}

	// What Claude is asking, while it waits on someone: its dialog, read from the screen (null for nothing asked)
	asking() {
		if (statusOf(this.id) !== 'waiting' || this.promptDraft() !== null) return null;

		return readDialog(this.mirror.buffer.active, this.cols);
	}

	// One of the dialog's numbered answers, pressed for someone who chose it elsewhere; refused when the screen no
	// longer asks that question with that answer, so an answer never lands on whatever was asked next
	answer(question, key) {
		const asked = this.asking();

		if (asked?.question !== question || !asked.options.some(option => option.key === key)) return false;

		setStatus(this.id, 'working');
		this.process.terminal.write(key);

		return true;
	}

	resize(client, cols, rows) {
		client.cols = clampSize(cols, SIZE_LIMITS.cols);
		client.rows = clampSize(rows, SIZE_LIMITS.rows);

		if (canDrive(client)) this.fitSize();
	}

	drive(client) {
		this.driver = client;
		this.fitSize();
		this.broadcastPresence();
	}

	// The driver's size, but never bigger than an attached terminal: a browser scales a large session down to fit,
	// a terminal can't, and would show it garbled
	fitSize() {
		if (!this.driver) return;

		// Only someone who may type gets a say; a watcher's small terminal shows the session cut off instead
		const terminals = [...this.clients].filter(
			client => client.kind === 'terminal' && canDrive(client) && client.cols && client.rows,
		);
		const cols = Math.min(this.driver.cols, ...terminals.map(client => client.cols));
		const rows = Math.min(this.driver.rows, ...terminals.map(client => client.rows));

		this.applySize(cols, rows);
	}

	applySize(cols, rows) {
		if (!cols || !rows || (cols === this.cols && rows === this.rows)) return;

		this.cols = cols;
		this.rows = rows;
		this.process.terminal.resize(cols, rows);
		this.mirror.resize(cols, rows);
		this.broadcast({ type: 'size', cols, rows });
	}

	broadcastPresence() {
		const clients = [...this.clients].map(client => ({
			kind: client.kind,
			label: client.label,
			name: client.name,
			role: client.role,
			sizer: client === this.driver,
		}));

		[...this.clients].forEach((client, index) => {
			send(client.socket, {
				type: 'presence',
				busy: this.busy,
				waiting: statusOf(this.id) === 'waiting',
				title: pinnedName(this.id) || this.title,
				hue: sessionHue(this.id),
				clients,
				you: index,
			});
		});
	}

	resetIdle(delay = IDLE_EXIT_MS) {
		clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			if (this.busy || statusOf(this.id) === 'working' || warmUntil(this.id)) this.resetIdle(BUSY_RECHECK_MS);
			else this.end();
		}, delay);
		this.idleTimer.unref?.();
	}

	// Ends Claude, wherever it runs; the session closes for everyone once it's gone
	end() {
		if (!endHeld(this.id)) this.process.kill();
	}

	exited() {
		this.ended = true;
		clearTimeout(this.idleTimer);

		for (const { socket } of this.clients) {
			send(socket, { type: 'exit' });
			socket.close();
		}

		this.clients.clear();
		this.mirror.dispose();
		releaseHeld(this.id);
		this.onExit?.(this);
	}
}
