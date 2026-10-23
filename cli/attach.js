import { mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';

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
import openLocally from './openLocally';
import { createPanel } from './panels';
import { lastSeen, loadPrefs, markSeen, savePrefs } from './prefs';
import readSelection from './selection';
import sessionData, { commentMarks } from './sessionData';
import sessionFiles from './sessionFiles';
import openSideShell, { LEAVE_SHELL } from './sideShell';
import { UNTINT, tintFor } from './tint';
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
	printable,
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
// How soon an open decisions panel reads again while Haiku is still at it
const DECISIONS_AGAIN_MS = 4000;
// How soon after this person's own click or key a clipboard write from the session is theirs
const OWN_COPY_MS = 3000;

const displayName = () => process.env.PAUDE_NAME || os.userInfo().username;

// Resolves to 'detach' | 'switch' | 'ended' | 'unauthorized', or { failed: why it wouldn't start }
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
		// When this person last clicked or typed: Claude's copy of a selection follows right after
		let ownInputAt = 0;
		const newFilter = () => outputFilter({ mayCopy: () => Date.now() - ownInputAt < OWN_COPY_MS });
		let filter = newFilter();
		let warnedOffline = false;
		let tinted = false;
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

		// When this terminal last had the session open, for the catch-up tour; now, from here on
		lastSeen(id).then(seen => {
			state.seenBefore = seen;
			markSeen(id);
		});

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
			await loadCommentMarks(state.files.open);
			redraw();
		};

		const openCommentsOn = (path, inDiff) =>
			state.notes.comments.filter(
				comment => !comment.resolved && comment.anchor?.path === path && (inDiff || comment.anchor.side === 'new'),
			);

		const data = sessionData(server, id);
		const marks = commentMarks(data, { openOn: openCommentsOn, diffSet: files.diffSet });
		const loadCommentMarks = marks.load;

		// A comment's lines in the reader: in the diff it was written in, where they are in it now, else in the file
		const openComment = async ({ comment }) => {
			state.thread = null;
			await openFiles();
			if (!state.files) return redraw();

			const found = await marks.locate(comment);

			if (!state.files) return redraw();
			if (found.hint) state.hint = found.hint;
			if (found.diff) {
				state.files.open = found.diff;

				return redraw();
			}
			if (!found.from) return redraw();

			await readFile(comment.anchor.path, found.from);

			const opened = state.files?.open;

			if (opened?.lines && opened.path === comment.anchor.path) {
				opened.anchor = Math.min(found.from, opened.lines.length) - 1;
				opened.cursor = Math.min(found.to, opened.lines.length) - 1;
			}
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
			await loadCommentMarks(opened);
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

		// How long the session lasts, whether you watch it, and its cache: the box's own line, read as it opens
		const loadStatus = async () => {
			const [detail, metered] = await Promise.all([data.detail(), role === 'owner' ? data.meter() : { meter: null }]);

			if (detail.error) return;
			state.status = { ...detail, meter: metered.meter ?? null };
			redraw();
		};

		const LOADERS = {
			links: () => data.links(),
			artifacts: () => data.artifacts(),
			decisions: () => data.decisions(),
			activity: async () => {
				const [timeline, checked] = await Promise.all([data.timeline(), data.verification()]);

				return timeline.error ? timeline : { ...timeline, checked: checked?.said ?? null };
			},
			services: () => data.shares(),
			lifetime: () => data.detail(),
			git: async () => ({}),
		};

		const loadPanel = async ({ kind }) => {
			const panel = createPanel(kind);

			state.panel = panel;
			redraw();

			const loaded = await LOADERS[kind]();

			if (state.panel !== panel) return;
			if (loaded.error) panel.error = loaded.error;
			else panel.data = loaded;
			redraw();
			if (kind === 'git') loadGit({ what: 'status' });
			if (kind === 'decisions') followDecisions(panel);
		};

		// Haiku is still reading turns, looking for where some are recorded, or filing them: read again shortly, while
		// it's open
		const followDecisions = panel => {
			const busy =
				panel.data?.reading ||
				panel.data?.lookingBack ||
				panel.data?.decisions?.some(decision => decision.looking || decision.filing);

			if (!busy || state.panel !== panel) return;
			setTimeout(async () => {
				if (state.panel !== panel) return;
				await reloadPanel();
				followDecisions(panel);
			}, DECISIONS_AGAIN_MS);
		};

		const reloadPanel = async () => {
			const { panel } = state;
			const loaded = panel && (await LOADERS[panel.kind]());

			if (!loaded || state.panel !== panel || loaded.error) return;
			panel.data = loaded;
			redraw();
		};

		// A git tab, read when it's first shown (and again on r); no pull request reads as none
		const loadGit = async ({ what }) => {
			const { panel } = state;

			if (panel?.kind !== 'git') return;

			const loaded = await data.git(what);

			if (state.panel !== panel) return;
			panel.data = { ...panel.data, [what]: loaded ?? { none: true } };
			redraw();
		};

		// The reader, over the panel it was opened from: closing it goes back there
		const readFromPanel = async read => {
			const opened = await read();

			await loadCommentMarks(opened);

			if (!state.panel) return;
			state.files = Object.assign(createBrowser([], await loadPrefs()), { fromPanel: true, open: opened });
			redraw();
		};

		const saveArtifact = async ({ path: made, name }) => {
			const bytes = await data.artifactBytes(made);

			if (!bytes) {
				state.hint = 'Could not download it.';

				return redraw();
			}

			const folder = path.join(os.homedir(), 'Downloads', 'paude');
			const saved = path.join(folder, name);

			await mkdir(folder, { recursive: true });
			await Bun.write(saved, bytes);
			state.hint = openLocally(saved) ? `Saved to ${saved}, and opened.` : `Saved to ${saved}.`;
			redraw();
		};

		const takeTour = async () => {
			const { panel } = state;

			panel.stage = 'touring';
			redraw();

			const tour = await data.catchUp(panel.since ?? undefined);

			if (state.panel !== panel) return;
			if (tour.error) {
				state.panel = null;
				state.hint = "Couldn't catch you up just now.";
			} else panel.data = tour;
			redraw();
		};

		// A tour of what the reader has open, above it; its first stop waits for → as catching up does. It's the open
		// file's or diff's own, so it goes when another opens or that one closes.
		const walk = async ({ subject, heading }) => {
			const opened = state.files?.open;

			if (!opened) return;
			opened.tour = { subject, heading };
			redraw();

			const told = await data.tour(subject);

			if (opened.tour?.subject !== subject) return;
			if (told.error) {
				opened.tour = null;
				state.hint = told.error;
			} else Object.assign(opened.tour, told, { index: 0 });
			redraw();
		};

		const openOverlay = () => {
			overlay = true;
			state.draft = null;
			state.thread = null;
			state.reacting = false;
			state.files = null;
			state.panel = null;
			state.hint = null;
			write(`${MOUSE_OFF}${PLAIN_KEYS}${HIDE_CURSOR}`);
			redraw();
			loadStatus();
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
						state.hint = why ?? 'The terminal ended.';
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
			if (tinted) write(UNTINT);
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
			editFile,
			backToShell,
			endShell,
			attachOutput: ({ text }) => {
				send({ type: 'input', data: `\x1b[200~${attachOutputText(text)}\x1b[201~` });
				endShell();
			},
			files: openFiles,
			readFile: ({ path: file, line }) =>
				state.panel && !state.files ? readFromPanel(() => files.read(file, line)) : readFile(file, line),
			readDiffSet: ({ source }) =>
				state.panel && !state.files
					? readFromPanel(async () => {
							const { set, error } = await files.diffSet(source);

							return error ? { path: source.path ?? 'changes', error } : openDiffSet(set, source);
						})
					: readDiffSet(source),
			panel: loadPanel,
			loadGit,
			settle: async () => {
				const settled = await data.gitAction('settle');

				// git's last word on it, when it refused: a hint is one line
				const said = String(settled.output || 'Not settled')
					.trim()
					.split('\n')
					.at(-1);

				state.hint = settled.error ?? (settled.ok ? 'Settled: ready to push.' : printable(said));
				await loadGit({ what: 'stack' });
			},
			readArtifact: ({ path: made }) => readFromPanel(() => data.readArtifact(made)),
			saveArtifact,
			takeTour,
			walk,
			openUrl: ({ url: link }) => {
				const absolute = new URL(link, server.url).href;

				state.hint = openLocally(absolute)
					? 'Asked your browser to open it. Nothing came up? y copies it.'
					: 'No browser to open it here. y copies it.';
				redraw();
			},
			writeDecision: async ({ id: decision }) => {
				const asked = await data.writeDownDecision(decision);

				state.hint = asked.error ?? 'Asked: Claude records it once its prompt box is free.';
				redraw();
			},
			answerDecision: ({ id: decision, question }) => {
				state.draft = { kind: 'answer', id: decision, question, text: '' };
				redraw();
			},
			sendAnswer: async ({ id: decision, text }) => {
				const answered = await data.answerDecision(decision, text);

				state.hint = answered.error ?? 'Answered: it goes into the commit when paude files it again.';
				await reloadPanel();
				redraw();
			},
			dismissDecision: async ({ id: decision }) => {
				const set = await data.dismissDecision(decision);

				if (set.error) state.hint = set.error;
				await reloadPanel();
				redraw();
			},
			markLink: async ({ url: link, change }) => {
				const marked = await data.markLink(link, change);

				if (marked.error) state.hint = marked.error;
				await reloadPanel();
				redraw();
			},
			toggleWatch: async () => {
				const watching = !state.status?.watching;
				const set = await data.setWatching(watching);

				state.hint =
					set.error ?? (watching ? 'Watching: changes here are counted while you are away.' : 'Not watching.');
				await loadStatus();
			},
			setLifetime: async ({ lifetime }) => {
				const set = await data.setLifetime(lifetime);

				if (set.error) state.hint = set.error;
				else state.panel = null;
				await loadStatus();
			},
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
			// Written in the box's own line, as a comment on terminal output is
			startComment: ({ quote, anchor }) => {
				state.draft = { kind: 'comment', text: '', quote, anchor };
				redraw();
			},
			openComment,
			hint: ({ text }) => {
				state.hint = text;
				redraw();
			},
		};

		const stopInput = rawInput(key => {
			if (!overlay) {
				// The key itself, not a paste that happens to contain its byte
				if (OVERLAY_KEYS.includes(key)) return openOverlay();
				if (state.shell) return state.shell.input(key);
				ownInputAt = Date.now();
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
				const tint = tinted ? '' : tintFor(message.hue);

				if (tint) {
					write(tint);
					tinted = true;
				}
				redraw();
			} else if (NOTE_TYPES.includes(message.type)) {
				const arrived = applyNote(state.notes, message);

				if (arrived && !overlay && arrived.author !== displayName()) notify(`paude · ${arrived.author}`, arrived.text);

				if (message.type !== 'chat' && message.type !== 'chatUpdate' && state.files?.open)
					marks.soon(state.files.open, redraw);
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
			onState: (connectionState, reason) => {
				if (connectionState === 'connected') {
					filter = newFilter();
					warnedOffline = false;
				} else if (connectionState === 'failed') finish({ failed: reason });
				else if (connectionState !== 'reconnecting') finish(connectionState);
			},
		});
	});

export default attachSession;
