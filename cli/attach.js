import os from 'os';

import { CLOSED, NOTE_TYPES, applyNote } from '../shared/protocol';
import notifier from './notify';
import outputFilter from './outputFilter';
import { composeFrame, createMirror } from './compositor';
import { createBrowser } from './fileBrowser';
import { overlayKey, overlayBox } from './overlay';
import readSelection from './selection';
import {
	CLEAR,
	CLEAR_SCROLLBACK,
	HIDE_CURSOR,
	MOUSE_OFF,
	PLAIN_KEYS,
	RESET_MODES,
	RESTORE_KEYS,
	rawInput,
	size,
	write,
} from './screen';

// Ctrl+] arrives as a plain byte, or as a CSI u sequence once Claude Code has switched on the kitty keyboard protocol
const OVERLAY_KEYS = ['\x1d', '\x1b[93;5u'];

const NOTE_ACTIONS = ['chat', 'comment', 'reply', 'resolve'];
const FRAME_MS = 33;

const displayName = () => process.env.PAUDE_NAME || os.userInfo().username;

// A refused upgrade only shows up as an abnormal close; the server says why when asked directly
const whyRefused = async ({ url, token }, id) => {
	try {
		const { status } = await fetch(`${url}/api/sessions/${id}`, { headers: { authorization: `Bearer ${token}` } });

		if (status === 401) return 'unauthorized';
		if (status === 404) return 'ended';
	} catch {
		// Unreachable: the server or the network is down, so keep retrying
	}

	return null;
};

// Puts this terminal on a shared session until the user detaches or switches, or the session or login ends.
// Resolves to 'detach' | 'switch' | 'ended' | 'unauthorized'.
const attachSession = (server, id, { canSwitch = true, role = 'owner' } = {}) =>
	new Promise(resolve => {
		const state = {
			id,
			canSwitch,
			role,
			presence: { clients: [] },
			notes: { chat: [], comments: [] },
			draft: null,
			thread: null,
			hint: null,
		};
		let socket;
		let overlay = false;
		let done = false;
		let retry;
		let retryDelay = 1000;
		let filter = outputFilter();
		const notify = notifier();

		const send = message => {
			if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
		};

		const mirror = createMirror();
		let drawTimer = null;

		const redraw = () => {
			clearTimeout(drawTimer);
			drawTimer = null;
			if (!overlay) return;

			const { cols, rows } = size();

			write(composeFrame({ mirror, cols, rows, box: overlayBox(state, cols, rows) }));
		};

		// Claude can stream many chunks a second; the frame behind the box catches up at most every few frames
		const redrawSoon = () => {
			if (overlay && !drawTimer) drawTimer = setTimeout(redraw, FRAME_MS);
		};

		const api = path =>
			fetch(`${server.url}/api/sessions/${id}/${path}`, { headers: { authorization: `Bearer ${server.token}` } });

		// The browser keeps its place between visits; only the list of files is fetched again
		const openFiles = async () => {
			try {
				const response = await api('files');

				if (!response.ok)
					throw new Error(response.status === 403 ? 'Your invite does not include files.' : 'Could not list files.');

				const paths = await response.json();

				state.files = state.lastFiles ? Object.assign(state.lastFiles, { paths }) : createBrowser(paths);
				state.lastFiles = state.files;
			} catch (error) {
				state.hint = error.message;
			}

			redraw();
		};

		const readFile = async path => {
			const response = await api(`file?path=${encodeURIComponent(path)}`).catch(() => null);
			const text = response ? await response.text() : 'Could not reach the server.';

			if (!state.files) return;
			state.files.open = response?.ok
				? { path, lines: text.replace(/\n$/, '').split('\n'), cursor: 0, anchor: null }
				: { path, error: text || 'Could not open it.' };
			redraw();
		};

		const openOverlay = () => {
			overlay = true;
			state.draft = null;
			state.thread = null;
			state.files = null;
			state.hint = null;
			write(`${MOUSE_OFF}${PLAIN_KEYS}${HIDE_CURSOR}`);
			redraw();
		};

		const closeOverlay = () => {
			overlay = false;
			clearTimeout(drawTimer);
			drawTimer = null;
			write(RESTORE_KEYS);
			// The fresh snapshot repaints Claude's screen, cursor and modes where the box was
			send({ type: 'refresh' });
		};

		const finish = outcome => {
			if (done) return;

			done = true;
			clearTimeout(retry);
			stopInput();
			process.stdout.off('resize', onResize);
			clearTimeout(drawTimer);
			if (overlay) write(RESTORE_KEYS);
			write(`${RESET_MODES}\r\n`);
			socket?.close();
			resolve(outcome);
		};

		const stopInput = rawInput(key => {
			if (!overlay) {
				if (OVERLAY_KEYS.some(sequence => key.includes(sequence))) return openOverlay();

				return send({ type: 'input', data: key });
			}

			const action = overlayKey(state, key, { readSelection });

			if (action.type === 'detach' || action.type === 'switch') return finish(action.type);
			if (action.type === 'close') return closeOverlay();
			if (action.type === 'ignore') return;
			if (NOTE_ACTIONS.includes(action.type)) send(action);
			if (action.type === 'files') return openFiles();
			if (action.type === 'readFile') return readFile(action.path);
			// Pasted, so a multi-line attachment is one paste in Claude's prompt and nothing is sent until Enter
			if (action.type === 'attach') {
				send({ type: 'input', data: `\x1b[200~${action.text}\x1b[201~` });

				return closeOverlay();
			}

			redraw();
		});

		const onResize = () => {
			send({ type: 'resize', ...size() });
			redraw();
		};

		process.stdout.on('resize', onResize);

		const handleMessage = message => {
			if (message.type === 'snapshot') {
				mirror.reset();
				mirror.resize(message.cols, message.rows);
				mirror.write(message.data, redrawSoon);
				if (!overlay) write(`${CLEAR}${CLEAR_SCROLLBACK}${message.data}`);
			} else if (message.type === 'size') {
				mirror.resize(message.cols, message.rows);
				redrawSoon();
			} else if (message.type === 'presence') {
				state.presence = message;
				redraw();
			} else if (NOTE_TYPES.includes(message.type)) {
				const arrived = applyNote(state.notes, message);

				// Someone else's words, while this person is looking at Claude rather than the overlay
				if (arrived && !overlay && arrived.author !== displayName()) notify(`paude · ${arrived.author}`, arrived.text);

				redraw();
			} else if (message.type === 'notice') notify('paude', message.text);
			else if (message.type === 'exit') finish('ended');
		};

		// A dropped connection (laptop sleep, network change) reconnects; the fresh snapshot redraws the screen
		const connect = () => {
			if (done) return;

			filter = outputFilter();
			socket = new WebSocket(`${server.url.replace(/^http/, 'ws')}/api/sessions/${id}/attach`, {
				headers: { authorization: `Bearer ${server.token}` },
			});
			socket.binaryType = 'arraybuffer';

			socket.addEventListener('open', () => {
				retryDelay = 1000;
				send({ type: 'hello', kind: 'terminal', label: os.hostname(), name: displayName(), ...size() });
			});

			socket.addEventListener('message', ({ data }) => {
				if (typeof data !== 'string') {
					const bytes = new Uint8Array(data);

					mirror.write(bytes, redrawSoon);
					if (!overlay) write(filter(bytes));

					return;
				}

				handleMessage(JSON.parse(data));
			});

			socket.addEventListener('close', async ({ code }) => {
				if (done) return;
				if (code === CLOSED.unauthorized) return finish('unauthorized');
				if (code === CLOSED.ended) return finish('ended');

				const refused = await whyRefused(server, id);

				if (refused) return finish(refused);

				retry = setTimeout(connect, retryDelay);
				retryDelay = Math.min(retryDelay * 2, 10_000);
			});
		};

		connect();
	});

export default attachSession;
