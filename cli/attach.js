import os from 'os';

import { attachOutputText } from '../shared/attachText';
import { NOTE_TYPES, applyNote } from '../shared/protocol';
import sessionSocket from '../shared/sessionSocket';
import notifier from './notify';
import outputFilter, { filterText } from './outputFilter';
import { composeFrame, createMirror } from './compositor';
import editCommand from './editCommand';
import { createBrowser, openDiffSet } from './fileBrowser';
import { place, removeImage, transmit } from './graphics';
import { overlayKey, overlayBox } from './overlay';
import { loadPrefs, savePrefs } from './prefs';
import readSelection from './selection';
import sessionFiles from './sessionFiles';
import openSideShell, { LEAVE_SHELL } from './sideShell';
import {
	CLEAR,
	CLEAR_SCROLLBACK,
	HIDE_CURSOR,
	MOUSE_OFF,
	PLAIN_KEYS,
	RESET_MODES,
	RESTORE_KEYS,
	SHOW_CURSOR,
	rawInput,
	size,
	write,
	OVERLAY_KEY,
} from './screen';

// Ctrl+] arrives as a plain byte, or as a CSI u sequence once Claude Code has switched on the kitty keyboard protocol;
// Cmd+] (super) only as the sequence, from a terminal that passes it on rather than keeping it for itself
const OVERLAY_KEYS = [
	'\x1d',
	'\x1b[93;5u',
	'\x1b[93;5:1u',
	'\x1b[27;5;93~',
	'\x1b[93;9u',
	'\x1b[93;9:1u',
	'\x1b[27;9;93~',
];

// Cmd+] needs a terminal that passes it on; Ctrl+] works in any
const OVERLAY_KEY_HINT = OVERLAY_KEY === 'Ctrl+]' ? OVERLAY_KEY : `${OVERLAY_KEY} (or Ctrl+])`;

const NOTE_ACTIONS = ['chat', 'comment', 'reply', 'resolve', 'react', 'delete', 'ask'];
const FRAME_MS = 33;

const displayName = () => process.env.PAUDE_NAME || os.userInfo().username;

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
		let overlay = false;
		let done = false;
		let filter = outputFilter();
		let warnedOffline = false;
		const notify = notifier();

		const send = message => connection?.send(message) ?? false;

		const mirror = createMirror();
		let drawTimer = null;

		const redraw = () => {
			clearTimeout(drawTimer);
			drawTimer = null;
			if (!overlay) return;

			const { cols, rows } = size();
			const box = overlayBox(state, cols, rows);

			write(composeFrame({ mirror: state.shell?.mirror ?? mirror, cols, rows, box }));
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

		const files = sessionFiles(server, id);

		const openFiles = async () => {
			try {
				const [paths, changes] = await Promise.all([files.list(), files.changes()]);

				state.files = state.browserState
					? Object.assign(state.browserState, { paths, changes })
					: Object.assign(createBrowser(paths, await loadPrefs()), { changes });
				state.browserState = state.files;
			} catch (error) {
				state.hint = error.message;
			}

			redraw();
		};

		// What changed since the last commit, what Claude proposes, and what each turn changed
		const loadChanges = async () => {
			const [changes, turns, proposal] = await Promise.all([
				files.changes(),
				files.turns(),
				files.diffSet({ source: 'proposal' }),
			]);

			if (!state.files) return;
			Object.assign(state.files, {
				changes,
				turns,
				proposal: proposal.set?.files.length ? proposal.set : null,
				showChanges: true,
				filter: null,
				cursor: 0,
			});
			redraw();
		};

		const readDiffSet = async source => {
			const { set, error } = await files.diffSet(source);

			if (!state.files) return;
			state.files.open = error ? { path: source.path ?? 'changes', error } : openDiffSet(set, source);
			redraw();
		};

		// The person's own editor, in the side terminal; quitting it comes back here with the file as it now is
		const editFile = ({ path }) =>
			openShell({
				command: editCommand(path),
				afterwards: async () => {
					state.files.changes = await files.changes();
					await readFile(path, (state.files.open?.cursor ?? 0) + 1);
				},
			});

		const readFile = async (path, line) => {
			const opened = await files.read(path, line);

			if (!state.files) return;
			state.files.open = opened;
			redraw();
		};

		const searchFiles = async () => {
			const { search, prefs } = state.files;
			const query = search.query.trim();

			Object.assign(search, { running: true, error: null });
			redraw();

			const { results, error } = await files.search(query, prefs.search);

			Object.assign(search, { running: false, typing: false, cursor: 0, lastQuery: query });
			if (error) Object.assign(search, { results: null, typing: true, error });
			else search.results = results;
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

		// The side terminal takes the screen from the box; the box's plain keys stay pushed while it's up
		// `command` runs instead of a shell; `afterwards`, when the shell ends of its own accord, returns to the box
		const openShell = ({ command, afterwards } = {}) => {
			const shell = openSideShell(server, id, {
				size: size(),
				command,
				onOutput: text => {
					if (overlay) redrawSoon();
					else write(text);
				},
				onEnd: why => {
					if (state.shell !== shell) return;

					state.shell = null;
					write(LEAVE_SHELL);
					if (overlay) {
						write(RESTORE_KEYS);
						state.hint = why ?? 'The side terminal ended.';
						redraw();
					} else if (why) {
						overlay = true;
						state.hint = why;
						write(`${MOUSE_OFF}${HIDE_CURSOR}`);
						redraw();
					} else if (afterwards) {
						overlay = true;
						write(`${MOUSE_OFF}${HIDE_CURSOR}`);
						afterwards();
					} else {
						write(RESTORE_KEYS);
						send({ type: 'refresh' });
					}
				},
			});

			state.shell = shell;
			overlay = false;
			clearTimeout(drawTimer);
			drawTimer = null;
			hideImage();
			write(`${CLEAR}${SHOW_CURSOR}`);
		};

		const backToShell = () => {
			overlay = false;
			clearTimeout(drawTimer);
			drawTimer = null;
			write(`${RESTORE_KEYS}${CLEAR}${state.shell.screen()}${SHOW_CURSOR}`);
		};

		const endShell = () => {
			const { shell } = state;

			state.shell = null;
			shell?.close();
			write(`${LEAVE_SHELL}${RESTORE_KEYS}`);
			closeOverlay();
		};

		const finish = outcome => {
			if (done) return;

			done = true;
			if (state.shell) {
				state.shell.close();
				state.shell = null;
				write(LEAVE_SHELL);
			}
			stopInput();
			process.stdout.off('resize', onResize);
			clearTimeout(drawTimer);
			hideImage();
			if (overlay) write(RESTORE_KEYS);
			write(`${RESET_MODES}\r\n`);
			connection?.close();
			resolve(outcome);
		};

		const OVERLAY_ACTIONS = {
			detach: () => finish('detach'),
			switch: () => finish('switch'),
			close: closeOverlay,
			ignore: () => {},
			shell: () => openShell(),
			loadChanges,
			readDiffSet: ({ source }) => readDiffSet(source),
			editFile,
			backToShell,
			endShell,
			attachOutput: ({ text }) => {
				send({ type: 'input', data: `\x1b[200~${attachOutputText(text)}\x1b[201~` });
				endShell();
			},
			files: openFiles,
			readFile: ({ path, line }) => readFile(path, line),
			search: searchFiles,
			savePrefs: () => {
				savePrefs(state.files.prefs);
				redraw();
			},
			// OSC 52 puts text on this person's own clipboard, through their terminal
			copy: ({ text, what }) => {
				write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
				state.hint = `Sent ${what} to your clipboard, if your terminal allows it`;
				redraw();
			},
			// Pasted, so a multi-line attachment is one paste in Claude's prompt and nothing is sent until Enter
			attach: ({ text }) => {
				send({ type: 'input', data: `\x1b[200~${text}\x1b[201~` });
				closeOverlay();
			},
		};

		const stopInput = rawInput(key => {
			if (!overlay) {
				// The key itself, not a paste that happens to contain its byte
				if (OVERLAY_KEYS.includes(key)) return openOverlay();
				if (state.shell) return state.shell.input(key);
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

			if (NOTE_ACTIONS.includes(action.type)) {
				if (!send(action)) {
					if (action.text) state.draft = { kind: action.type, ...action };
					state.hint = 'Not sent: reconnecting. Press Enter again once it is back.';
				}

				return redraw();
			}

			(OVERLAY_ACTIONS[action.type] ?? redraw)(action);
		});

		const onResize = () => {
			send({ type: 'resize', ...size() });
			state.shell?.resize(size());
			redraw();
		};

		process.stdout.on('resize', onResize);

		const handleMessage = message => {
			if (message.type === 'snapshot') {
				mirror.reset();
				mirror.resize(message.cols, message.rows);
				mirror.write(message.data, redrawSoon);
				if (!overlay && !state.shell) write(`${CLEAR}${CLEAR_SCROLLBACK}${filterText(message.data)}`);
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
		};

		// The one key that matters shows for a moment before Claude's screen takes over
		if (showKeyHint)
			write(`\r\n  \x1b[2m${OVERLAY_KEY_HINT} opens paude's box: chat, comments, files, switch or detach\x1b[0m\r\n`);

		// A dropped connection (laptop sleep, network change) reconnects; the fresh snapshot redraws the screen
		const connection = sessionSocket({
			url: server.url,
			sessionId: id,
			headers: { authorization: `Bearer ${server.token}` },
			startAfter: showKeyHint ? 1500 : 0,
			hello: () => ({ kind: 'terminal', label: os.hostname(), name: displayName(), ...size() }),
			onOutput: bytes => {
				mirror.write(bytes, redrawSoon);
				if (!overlay && !state.shell) write(filter(bytes));
			},
			onMessage: handleMessage,
			onState: connectionState => {
				if (connectionState === 'connected') {
					filter = outputFilter();
					warnedOffline = false;
				} else if (connectionState !== 'reconnecting') finish(connectionState);
			},
		});
	});

export default attachSession;
