import os from 'os';

import { CLOSED, NOTE_TYPES, applyNote } from '../shared/protocol';
import notifier from './notify';
import outputFilter from './outputFilter';
import { overlayKey, renderOverlay } from './overlay';
import readSelection from './selection';
import {
	CLEAR,
	CLEAR_SCROLLBACK,
	ENTER_ALT_SCREEN,
	LEAVE_ALT_SCREEN,
	MOUSE_OFF,
	RESET_MODES,
	rawInput,
	size,
	write,
} from './screen';

// Ctrl+] arrives as a plain byte, or as a CSI u sequence once Claude Code has switched on the kitty keyboard protocol
const OVERLAY_KEYS = ['\x1d', '\x1b[93;5u'];

const NOTE_ACTIONS = ['chat', 'comment', 'reply', 'resolve'];

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

		const redraw = () => {
			if (overlay) write(renderOverlay(state));
		};

		const openOverlay = () => {
			overlay = true;
			state.draft = null;
			state.thread = null;
			state.hint = null;
			write(`${ENTER_ALT_SCREEN}${MOUSE_OFF}`);
			redraw();
		};

		const closeOverlay = () => {
			overlay = false;
			write(LEAVE_ALT_SCREEN);
			send({ type: 'refresh' });
		};

		const finish = outcome => {
			if (done) return;

			done = true;
			clearTimeout(retry);
			stopInput();
			process.stdout.off('resize', onResize);
			if (overlay) write(LEAVE_ALT_SCREEN);
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

			redraw();
		});

		const onResize = () => {
			send({ type: 'resize', ...size() });
			redraw();
		};

		process.stdout.on('resize', onResize);

		const handleMessage = message => {
			if (message.type === 'snapshot') {
				if (!overlay) write(`${CLEAR}${CLEAR_SCROLLBACK}${message.data}`);
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
					if (!overlay) write(filter(new Uint8Array(data)));

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
