import inputKind from '../shared/inputKind';
import { REACTION_PALETTE } from '../shared/reactions';
import { roleAllows } from '../shared/roles';
import relativeTime from '../shared/relativeTime';
import { browserKey, browserKeys, browserView } from './fileBrowser';
import {
	OVERLAY_KEY,
	bold,
	dim,
	fit,
	heading,
	keyCap,
	onBackground,
	orange,
	printable,
	visibleLength,
	wrap,
} from './screen';

const KIND_LABELS = { terminal: 'terminal', web: 'browser' };
const CHAT_LINES = 8;
const MAX_LISTED_COMMENTS = 9;
const QUOTE_LINES = 8;
const MAX_QUOTE = 2000;
const CANCEL = ['\x1b', '\x03'];
const NAMED_KEYS = { 8: '\b', 9: '\t', 13: '\r', 27: '\x1b', 127: '\x7f' };
const ESC = '\x1b';
const CSI_U_KEY = new RegExp(`^${ESC}\\[(\\d+)(?::\\d+)*(?:;(\\d+)(?::\\d+)?)?(?:;[\\d:]*)?u$`);
const MODIFY_OTHER_KEY = new RegExp(`^${ESC}\\[27;(\\d+);(\\d+)~$`);

// A key reported as an escape sequence (kitty keyboard protocol, xterm's modifyOtherKeys) as the bytes it would be
// without one, for terminals that keep reporting that way while the overlay is up
export const plainKey = key => {
	const match = key.match(CSI_U_KEY);
	const other = !match && key.match(MODIFY_OTHER_KEY);
	const code = Number(match ? match[1] : other?.[2]);

	if (!code) return key;

	const ctrl = ((Number(match ? match[2] : other[1]) || 1) - 1) & 4;

	if (NAMED_KEYS[code]) return NAMED_KEYS[code];
	if (ctrl && /[a-z]/i.test(String.fromCodePoint(code))) return String.fromCharCode(code & 0x1f);

	return String.fromCodePoint(code);
};

const PALETTE = REACTION_PALETTE.slice(0, 9);

const reactionsOf = item =>
	Object.entries(item.reactions ?? {})
		.map(([emoji, authors]) => ` ${printable(emoji)} ${authors.length}`)
		.join(' ');

const firstLine = text =>
	printable(
		text
			.split('\n')
			.find(line => line.trim())
			?.trim() ?? '',
	);

const openComments = notes => notes.comments.filter(({ resolved }) => !resolved).slice(-MAX_LISTED_COMMENTS);

const canTypeIn = state => roleAllows(state.role ?? 'owner', 'type');

const threadComment = state => state.notes.comments.find(({ id }) => id === state.thread);

// The owner may delete any comment, anyone else their own (the server checks who, not just the name)
const mayDelete = (state, comment) =>
	state.role === 'owner' || comment.author === state.presence.clients?.[state.presence.you]?.name;

const DRAFT_PROMPTS = {
	chat: () => 'Message:',
	comment: draft => `Comment on "${firstLine(draft.quote)}":`,
	reply: draft => `Reply to ${printable(draft.author)}:`,
};

const listView = state => {
	const { presence, notes } = state;
	const here = presence.clients.map((client, index) => {
		const who = index === presence.you ? 'you' : printable(client.name);

		return `  ${client.sizer ? orange('●') : ' '} ${who} ${dim(`(${KIND_LABELS[client.kind] ?? 'unknown'})`)}`;
	});
	const chat = notes.chat
		.slice(-CHAT_LINES)
		.map(
			message =>
				`  ${bold(printable(message.author))} ${dim(relativeTime(message.at))}  ${printable(message.text)}${dim(reactionsOf(message))}`,
		);
	const comments = openComments(notes).map(({ author, quote, text, replies }, index) => {
		const thread = replies.length ? dim(` (${replies.length} ${replies.length === 1 ? 'reply' : 'replies'})`) : '';

		return `  ${keyCap(String(index + 1))} ${dim(`"${firstLine(quote)}"`)} ${bold(printable(author))}: ${printable(text)}${thread}`;
	});

	return [
		heading('Here now'),
		...here,
		'',
		`${heading('Chat')} ${dim('(between people; Claude never sees it)')}`,
		...(chat.length ? chat : [dim('  nothing yet')]),
		'',
		`${heading('Open comments')} ${notes.comments.filter(({ resolved }) => !resolved).length}${comments.length ? dim('  (press a number to read one)') : ''}`,
		...comments,
	];
};

const threadView = (state, width) => {
	const comment = threadComment(state);

	if (!comment) return [dim('That comment is gone.')];

	const quote = String(comment.quote).split('\n');
	const shownQuote = quote.slice(0, QUOTE_LINES).map(line => dim(`│ ${printable(line)}`));
	const entry = item => [
		`${bold(printable(item.author))} ${dim(relativeTime(item.at))}`,
		...wrap(printable(item.text), width - 2).map(line => `  ${line}`),
		...(item.reactions && reactionsOf(item) ? [`  ${reactionsOf(item)}`] : []),
	];

	return [
		`${comment.resolved ? dim('Resolved comment') : 'Comment'} on:`,
		...shownQuote,
		...(quote.length > QUOTE_LINES ? [dim(`│ ... ${quote.length - QUOTE_LINES} more lines`)] : []),
		'',
		...entry(comment),
		...comment.replies.flatMap(reply => ['', ...entry(reply)]),
	];
};

const BOX_BACKGROUND = 235;
const BORDER = text => `\x1b[38;5;242m${text}\x1b[39m`;
const MAX_BOX_WIDTH = 78;

const keysFor = (state, canNote) => {
	if (state.shell)
		return [
			`${keyCap('a')} attach your selection`,
			`${keyCap('k')} end it, back to Claude`,
			`${keyCap('esc')} back to the terminal`,
		];
	if (state.files) return browserKeys(state.files, canTypeIn(state), keyCap);
	if (state.draft) return [`${keyCap('enter')} send`, `${keyCap('esc')} cancel`];

	if (state.reacting)
		return [...PALETTE.map((emoji, index) => `${keyCap(String(index + 1))} ${emoji}`), `${keyCap('esc')} cancel`];

	if (state.thread) {
		const comment = threadComment(state);

		return [
			canNote && comment && `${keyCap('r')} reply`,
			canNote && comment && `${keyCap('+')} react`,
			canNote && comment && `${keyCap('x')} ${comment.resolved ? 'reopen' : 'resolve'}`,
			canNote && comment && mayDelete(state, comment) && `${keyCap('D')} delete`,
			`${keyCap('esc')} back`,
		].filter(Boolean);
	}

	return [
		canNote && `${keyCap('c')} chat`,
		canNote && `${keyCap('m')} comment on selection`,
		canNote && `${keyCap('f')} files`,
		canTypeIn(state) && `${keyCap('t')} side terminal`,
		`${keyCap('d')} detach`,
		state.canSwitch !== false && `${keyCap('s')} switch`,
		`${keyCap('esc')} back to Claude`,
	].filter(Boolean);
};

const packKeys = (keys, width) =>
	keys.reduce((rows, key) => {
		const last = rows.at(-1);

		if (last !== undefined && visibleLength(last) + 3 + visibleLength(key) <= width)
			rows[rows.length - 1] = `${last}   ${key}`;
		else rows.push(key);

		return rows;
	}, []);

const SHELL_HELP = [
	"A shell in this session's folder. It ends when you go back to Claude.",
	'',
	"Select some output (Shift+drag; on macOS, copy it), then press a to quote it in Claude's prompt.",
];

const mainView = (state, width, room) => {
	if (state.shell) return SHELL_HELP.flatMap(line => (line ? wrap(line, width) : ['']));
	if (state.files) return browserView(state.files, width, room);

	return state.thread ? threadView(state, width) : listView(state);
};

// Near the top right, where it covers the least of the prompt; every line is exactly `width` wide
export const overlayBox = (state, cols, rows) => {
	const widest = state.files ? cols - 4 : MAX_BOX_WIDTH;
	const zoomed = Boolean(state.files?.zoom);
	const width = cols < 50 || zoomed ? cols : Math.min(cols - 2, widest);
	const inner = width - 4;
	const draft = state.draft
		? wrap(`${DRAFT_PROMPTS[state.draft.kind](state.draft)} ${printable(state.draft.text)}█`, inner)
		: [];
	const keys = [...draft, ...packKeys(keysFor(state, state.role !== 'watch'), inner)];
	// Borders and the rule above the keys take three rows; one row of Claude stays visible above and below
	const room = Math.max(rows - (zoomed ? 0 : 2) - 3 - keys.length, 1);
	const content = [
		...mainView(state, inner, room),
		...(state.hint ? ['', ...wrap(state.hint, inner).map(orange)] : []),
	];
	// The list keeps its newest lines when it overflows; a thread keeps its top, where the quote and comment are
	const shown =
		state.thread || state.files ? content.slice(0, room) : content.slice(Math.max(0, content.length - room));
	const title = fit(
		` ${heading('paude')} ${bold(printable(state.presence.title) || state.id)} ${state.presence.busy ? orange('● working') : dim('○ ready')} `,
		width - 4,
	);
	const row = text =>
		onBackground(
			`${BORDER('│')} ${onBackground(fit(text, inner), inner, BOX_BACKGROUND)} ${BORDER('│')}`,
			width,
			BOX_BACKGROUND,
		);
	const rule = (left, right, label = '') =>
		onBackground(
			BORDER(`${left}─`) + label + BORDER(`${'─'.repeat(Math.max(width - 3 - visibleLength(label), 0))}${right}`),
			width,
			BOX_BACKGROUND,
		);

	return {
		x: cols - width,
		y: rows > 12 && !zoomed ? 1 : 0,
		width,
		lines: [
			rule('╭', '╮', title),
			...[...shown, ...Array.from({ length: zoomed ? room - shown.length : 0 }, () => '')].map(row),
			rule('├', '┤'),
			...keys.map(row),
			rule('╰', '╯'),
		],
	};
};

const send = draft => {
	const text = draft.text.trim();

	if (!text) return { type: 'redraw' };
	if (draft.kind === 'comment') return { type: 'comment', quote: draft.quote, text };
	if (draft.kind === 'reply') return { type: 'reply', commentId: draft.commentId, text };

	return { type: 'chat', text };
};

const draftKey = (state, key) => {
	if (key === '\r' || key === '\n') {
		const action = send(state.draft);

		state.draft = null;

		return action;
	}

	if (CANCEL.includes(key)) state.draft = null;
	else if (key === '\x7f' || key === '\b') state.draft.text = state.draft.text.slice(0, -1);
	else state.draft.text += printable(key);

	return { type: 'redraw' };
};

const threadKey = (state, key, canNote) => {
	const comment = threadComment(state);

	if (CANCEL.includes(key) || key === 'q' || key === '\x7f') {
		state.thread = null;

		return { type: 'redraw' };
	}

	if (!canNote || !comment) return { type: 'ignore' };

	// Pressed twice, as it takes the replies too
	const confirming = state.deleting === comment.id;

	state.deleting = null;
	if (key === 'D' && mayDelete(state, comment)) {
		if (!confirming) {
			state.deleting = comment.id;
			state.hint = `Press D again to delete this comment${comment.replies.length ? ' and its replies' : ''}.`;

			return { type: 'redraw' };
		}

		state.thread = null;
		state.hint = null;

		return { type: 'delete', commentId: comment.id };
	}

	if (key === 'r') {
		state.draft = { kind: 'reply', text: '', commentId: comment.id, author: comment.author };

		return { type: 'redraw' };
	}

	if (key === 'x') return { type: 'resolve', commentId: comment.id, resolved: !comment.resolved };

	if (key === '+') {
		state.reacting = true;

		return { type: 'redraw' };
	}

	return { type: 'ignore' };
};

const reactKey = (state, key) => {
	const emoji = PALETTE[Number(key) - 1];

	state.reacting = false;

	return /^[1-9]$/.test(key) && emoji ? { type: 'react', commentId: state.thread, emoji } : { type: 'redraw' };
};

// The box over the side terminal: quote a selection into Claude's prompt, or leave
const shellKey = (state, key, readSelection) => {
	if (CANCEL.includes(key)) return { type: 'backToShell' };
	if (key === 'k' || key === 'q') return { type: 'endShell' };
	if (key !== 'a') return { type: 'ignore' };

	const text = readSelection()?.trim();

	if (text) return { type: 'attachOutput', text };

	state.hint = readSelection.unavailable
		? "paude can't read your selection here: install wl-clipboard (Wayland) or xclip (X11)."
		: `Nothing selected. Shift+drag over the output first (on macOS, copy it), then ${OVERLAY_KEY} and a.`;

	return { type: 'redraw' };
};

// 'ignore' needs no redraw
export const overlayKey = (state, rawKey, { readSelection = () => null } = {}) => {
	// Mouse and focus reports, and terminal replies, aren't keys
	if (inputKind(rawKey) !== 'typing') return { type: 'ignore' };

	const key = plainKey(rawKey);

	state.hint = null;

	const canNote = roleAllows(state.role ?? 'owner', 'note');

	if (state.draft) return draftKey(state, key);
	if (state.shell) return shellKey(state, key, readSelection);
	if (state.files) {
		const action = browserKey(state.files, key, { canType: canTypeIn(state) });

		if (action.type !== 'leave') return action;
		state.files = null;

		return { type: 'redraw' };
	}
	if (state.reacting) return reactKey(state, key);
	if (state.thread) return threadKey(state, key, canNote);

	if (CANCEL.includes(key) || key === 'q') return { type: 'close' };
	if (key === 'd') return { type: 'detach' };
	if (key === 's' && state.canSwitch !== false) return { type: 'switch' };

	const listed = openComments(state.notes)[Number(key) - 1];

	if (/^[1-9]$/.test(key) && listed) {
		state.thread = listed.id;

		return { type: 'redraw' };
	}

	if (canNote && key === 'c') {
		state.draft = { kind: 'chat', text: '' };

		return { type: 'redraw' };
	}

	if (roleAllows(state.role ?? 'owner', 'files') && key === 'f') return { type: 'files' };
	if (canTypeIn(state) && key === 't') return { type: 'shell' };

	if (canNote && key === 'm') {
		const quote = readSelection()?.trim().slice(0, MAX_QUOTE);

		if (quote) state.draft = { kind: 'comment', text: '', quote };
		else if (readSelection.unavailable)
			state.hint = "paude can't read your selection here: install wl-clipboard (Wayland) or xclip (X11).";
		else
			state.hint = `Nothing selected. Shift+drag over Claude's output first (on macOS, copy it), then ${OVERLAY_KEY} and m.`;

		return { type: 'redraw' };
	}

	return { type: 'ignore' };
};
