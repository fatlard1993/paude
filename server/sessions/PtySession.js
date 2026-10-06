import xtermHeadless from '@xterm/headless';
import serializeAddon from '@xterm/addon-serialize';

import inputKind, { FOCUS_IN } from './inputKind';

const { Terminal } = xtermHeadless;
const { SerializeAddon } = serializeAddon;

const ESC = '\x1b';

// Nobody attached for this long: the prompt cache has expired anyway, so an idle process holds nothing worth keeping
const IDLE_EXIT_MS = 60 * 60 * 1000;
// A session still working at that point gets this much longer, again and again, until it's done
const BUSY_RECHECK_MS = 10 * 60 * 1000;
const SCROLLBACK_LINES = 5000;
const SIZE_LIMITS = { cols: [20, 500], rows: [5, 200] };

// Markers a Claude Code process sets for its children, and a multiplexer's own markers. Passed on, they make each
// session think it's a subprocess of the paude's parent (and stop saving its transcript), or nested in tmux
// (where its title stops showing whether it's busy).
const INHERITED_MARKER =
	/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_(CHILD_SESSION|ENTRYPOINT|EXECPATH|MESSAGING_\w+|SESSION_\w+)|TMUX|TMUX_PANE|STY|COLUMNS|LINES)$/;

// The CLI titles its terminal "✳ <title>" when idle and alternates ◐ ◑ while working
const TITLE_GLYPH = /^[✳◐◑]\s+/;
const BUSY_TITLE = /^[◐◑]/;

// Terminal modes the serializer doesn't carry, replayed after each snapshot so a joiner's terminal matches
// (mouse encoding, focus reports, bracketed paste, cursor keys and visibility)
const TRACKED_MODES = new Set(['1', '25', '1000', '1002', '1003', '1004', '1006', '2004']);
const MODE_CHANGE = new RegExp(`${ESC}\\[\\?([\\d;]+)([hl])`, 'g');

const sessionEnvironment = () =>
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
	driver = null;
	busy = false;
	title = '';
	modes = new Map();
	ended = false;

	constructor({ id, cwd, resume, prompt, claudePath, onExit }) {
		this.id = id;
		this.cwd = cwd;
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
			const busy = BUSY_TITLE.test(terminalTitle);
			const title = terminalTitle.replace(TITLE_GLYPH, '');

			// The glyph alternates every second while busy; only a change in state or title is news
			if (busy === this.busy && title === this.title) return;

			this.busy = busy;
			this.title = title;
			this.broadcastPresence();
		});

		// `--` keeps a prompt that starts with a dash from being read as an option
		const args = resume ? ['--resume', id] : ['--session-id', id, ...(prompt ? ['--', prompt] : [])];

		this.process = Bun.spawn([claudePath, ...args], {
			cwd,
			env: { ...sessionEnvironment(), TERM: 'xterm-256color', COLORTERM: 'truecolor' },
			terminal: {
				cols: this.cols,
				rows: this.rows,
				data: (terminal, data) => this.output(data),
			},
		});

		this.process.exited.then(() => this.exited());
		this.resetIdle();
	}

	output(data) {
		this.mirror.write(data);
		this.trackModes(data);

		for (const client of this.clients) {
			if (client.pending) client.pending.push(data);
			else client.socket.send(data);
		}
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
		else if (client.kind === 'terminal') this.fitSize();

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

	rename(client, name) {
		client.name = clientName(name, client.label);
		this.broadcastPresence();
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

	// Every attached terminal answers Claude's queries, and an answer counted as typing claimed the size for its
	// client: two clients took turns forever, each resize prompting the redraw and queries that set off the next.
	// Only the driver's answers reach Claude, and no answer or pointer report claims anything. A terminal's
	// focus-in does: that person just switched to it.
	input(client, data) {
		const kind = inputKind(data);
		const driving = this.driver === client;

		if (kind === 'reply' && !driving) return;

		if (!driving && (kind === 'typing' || (client.kind === 'terminal' && data.includes(FOCUS_IN)))) {
			this.drive(client);
		}

		this.process.terminal.write(data);
	}

	resize(client, cols, rows) {
		client.cols = clampSize(cols, SIZE_LIMITS.cols);
		client.rows = clampSize(rows, SIZE_LIMITS.rows);

		if (this.driver === client || client.kind === 'terminal') this.fitSize();
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

		const terminals = [...this.clients].filter(client => client.kind === 'terminal' && client.cols && client.rows);
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
			driver: client === this.driver,
		}));

		[...this.clients].forEach((client, index) => {
			send(client.socket, { type: 'presence', busy: this.busy, title: this.title, clients, you: index });
		});
	}

	resetIdle(delay = IDLE_EXIT_MS) {
		clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			if (this.busy) this.resetIdle(BUSY_RECHECK_MS);
			else this.process.kill();
		}, delay);
		this.idleTimer.unref?.();
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
		this.onExit?.(this);
	}
}
