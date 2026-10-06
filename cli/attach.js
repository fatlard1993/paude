import os from 'os';

import { CLOSED, NOTE_TYPES, applyNote } from '../shared/protocol';
import notifier from './notify';
import outputFilter, { filterText } from './outputFilter';
import { composeFrame, createMirror } from './compositor';
import { createBrowser, openFile } from './fileBrowser';
import { IMAGE_EXTENSIONS, place, pngSize, removeImage, showsImages, toPng, transmit } from './graphics';
import { overlayKey, overlayBox } from './overlay';
import { loadPrefs, savePrefs } from './prefs';
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
const OVERLAY_KEYS = ['\x1d', '\x1b[93;5u', '\x1b[93;5:1u', '\x1b[27;5;93~'];

const NOTE_ACTIONS = ['chat', 'comment', 'reply', 'resolve', 'react'];
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

// Resolves to 'detach' | 'switch' | 'ended' | 'unauthorized'
const attachSession = (server, id, { canSwitch = true, role = 'owner', showKeyHint = false } = {}) =>
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
		let warnedOffline = false;
		const notify = notifier();

		const send = message => {
			if (socket?.readyState !== WebSocket.OPEN) return false;
			socket.send(JSON.stringify(message));

			return true;
		};

		const mirror = createMirror();
		let drawTimer = null;

		const redraw = () => {
			clearTimeout(drawTimer);
			drawTimer = null;
			if (!overlay) return;

			const { cols, rows } = size();
			const box = overlayBox(state, cols, rows);

			write(composeFrame({ mirror, cols, rows, box }));
			showImage(box);
		};

		// Sent to the terminal once and moved only when the box moves, so redrawing behind it costs nothing
		let sentImage = null;
		let placement = null;

		const hideImage = () => {
			if (sentImage) write(removeImage());
			sentImage = null;
			placement = null;
		};

		const showImage = box => {
			const image = overlay ? state.files?.open?.image : null;

			if (!image?.cells) return hideImage();
			if (sentImage !== image) {
				write(transmit(image.png));
				sentImage = image;
				placement = null;
			}

			const where = { x: box.x + 3, y: box.y + 3, ...image.cells };
			const key = JSON.stringify(where);

			if (key !== placement) write(place(where));
			placement = key;
		};

		const redrawSoon = () => {
			if (overlay && !drawTimer) drawTimer = setTimeout(redraw, FRAME_MS);
		};

		const api = path =>
			fetch(`${server.url}/api/sessions/${id}/${path}`, { headers: { authorization: `Bearer ${server.token}` } });

		const openFiles = async () => {
			try {
				const response = await api('files');

				if (!response.ok)
					throw new Error(response.status === 403 ? 'Your invite does not include files.' : 'Could not list files.');

				const paths = await response.json();

				state.files = state.browserState
					? Object.assign(state.browserState, { paths })
					: createBrowser(paths, await loadPrefs());
				state.browserState = state.files;
			} catch (error) {
				state.hint = error.message;
			}

			redraw();
		};

		const readImage = async path => {
			const response = await api(`raw?path=${encodeURIComponent(path)}`).catch(() => null);
			const png = response?.ok ? await toPng(new Uint8Array(await response.arrayBuffer())) : null;

			if (!state.files) return;
			state.files.open = png
				? { path, image: { png, ...pngSize(png) } }
				: { path, error: response?.ok ? 'This image needs ImageMagick to show here.' : 'Could not open it.' };
			redraw();
		};

		const searchFiles = async () => {
			const { search, prefs } = state.files;
			const query = search.query.trim();
			const parameters = new URLSearchParams({
				q: query,
				case: prefs.search.caseSensitive ? '1' : '',
				word: prefs.search.wholeWord ? '1' : '',
				regex: prefs.search.regex ? '1' : '',
				include: prefs.search.include,
				exclude: prefs.search.exclude,
			});

			Object.assign(search, { running: true, error: null });
			redraw();

			const response = await api(`search?${parameters}`).catch(() => null);
			const body = response ? await response.text() : 'Could not reach the server.';

			Object.assign(search, { running: false, typing: false, cursor: 0, lastQuery: query });
			if (response?.ok) search.results = JSON.parse(body);
			else Object.assign(search, { results: null, typing: true, error: body || 'Search failed.' });
			redraw();
		};

		const readFile = async (path, line) => {
			if (showsImages() && IMAGE_EXTENSIONS.has(path.split('.').at(-1).toLowerCase())) return readImage(path);

			const response = await api(`file?path=${encodeURIComponent(path)}`).catch(() => null);
			const text = response ? await response.text() : 'Could not reach the server.';

			if (!state.files) return;
			state.files.open = response?.ok ? openFile(path, text, line) : { path, error: text || 'Could not open it.' };
			redraw();
		};

		const openOverlay = () => {
			overlay = true;
			state.draft = null;
			state.thread = null;
			state.reacting = false;
			state.files = null;
			state.hint = null;
			write(`${MOUSE_OFF}${PLAIN_KEYS}${HIDE_CURSOR}`);
			redraw();
		};

		const closeOverlay = () => {
			overlay = false;
			clearTimeout(drawTimer);
			drawTimer = null;
			hideImage();
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
			hideImage();
			if (overlay) write(RESTORE_KEYS);
			write(`${RESET_MODES}\r\n`);
			socket?.close();
			resolve(outcome);
		};

		const stopInput = rawInput(key => {
			if (!overlay) {
				// The key itself, not a paste that happens to contain its byte
				if (OVERLAY_KEYS.includes(key)) return openOverlay();
				if (!send({ type: 'input', data: key }) && !warnedOffline) {
					warnedOffline = true;
					notify('paude', 'Reconnecting: what you type is lost until it is back');
				}

				return;
			}

			let action;

			try {
				action = overlayKey(state, key, { readSelection });
			} catch (error) {
				state.hint = `That key hit a paude bug: ${error.message}`;

				return redraw();
			}

			if (action.type === 'detach' || action.type === 'switch') return finish(action.type);
			if (action.type === 'close') return closeOverlay();
			if (action.type === 'ignore') return;
			if (NOTE_ACTIONS.includes(action.type) && !send(action)) {
				if (action.text) state.draft = { kind: action.type === 'chat' ? 'chat' : action.type, ...action };
				state.hint = 'Not sent: reconnecting. Press Enter again once it is back.';
			}
			if (action.type === 'files') return openFiles();
			if (action.type === 'readFile') return readFile(action.path, action.line);
			if (action.type === 'search') return searchFiles();
			if (action.type === 'savePrefs') savePrefs(state.files.prefs);
			// OSC 52 puts text on this person's own clipboard, through their terminal
			if (action.type === 'copy') {
				write(`\x1b]52;c;${Buffer.from(action.text).toString('base64')}\x07`);
				state.hint = `Sent ${action.what} to your clipboard, if your terminal allows it`;
			}
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
				if (!overlay) write(`${CLEAR}${CLEAR_SCROLLBACK}${filterText(message.data)}`);
			} else if (message.type === 'size') {
				mirror.resize(message.cols, message.rows);
				redrawSoon();
			} else if (message.type === 'presence') {
				state.presence = message;
				redraw();
			} else if (NOTE_TYPES.includes(message.type)) {
				const arrived = applyNote(state.notes, message);

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
				warnedOffline = false;
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

		if (showKeyHint) {
			write(`\r\n  \x1b[2mCtrl+] opens paude's box: chat, comments, files, switch or detach\x1b[0m\r\n`);
			setTimeout(connect, 1500);
		} else connect();
	});

export default attachSession;
