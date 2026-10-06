import relativeTime from '../shared/relativeTime';
import { CLEAR, bold, dim, fit, orange, printable, size } from './screen';

const KIND_LABELS = { terminal: 'terminal', web: 'browser' };
const CHAT_LINES = 8;
const COMMENT_LINES = 5;
const MAX_QUOTE = 2000;

const firstLine = text =>
	printable(
		text
			.split('\n')
			.find(line => line.trim())
			?.trim() ?? '',
	);

const shownComments = notes => notes.comments.filter(({ resolved }) => !resolved).slice(-COMMENT_LINES);

const DRAFT_PROMPTS = {
	chat: () => 'Message:',
	comment: draft => `Comment on "${firstLine(draft.quote)}":`,
	reply: draft => `Reply to ${printable(draft.author)}:`,
};

export const renderOverlay = state => {
	const { id, presence, notes, draft } = state;
	const { cols, rows } = size();
	const width = cols - 1;
	const canNote = state.role !== 'watch';
	const here = presence.clients.map((client, index) => {
		const who = index === presence.you ? 'you' : printable(client.name);

		return `  ${client.driver ? orange('●') : ' '} ${who} ${dim(`(${KIND_LABELS[client.kind] ?? 'unknown'})`)}`;
	});
	const chat = notes.chat
		.slice(-CHAT_LINES)
		.map(({ author, text, at }) => `  ${bold(printable(author))} ${dim(relativeTime(at))}  ${printable(text)}`);
	const open = notes.comments.filter(({ resolved }) => !resolved);
	const comments = shownComments(notes).map(({ author, quote, text, replies }, index) => {
		const thread = replies.length ? dim(` (+${replies.length})`) : '';

		return `  ${bold(String(index + 1))} ${dim(`"${firstLine(quote)}"`)} ${bold(printable(author))}: ${printable(text)}${thread}`;
	});

	const lines = [
		bold(`paude · ${printable(presence.title) || id}`),
		dim(presence.busy ? 'Claude is working' : 'Claude is idle'),
		'',
		'Here now:',
		...here,
		'',
		`Chat ${dim('(between people; Claude never sees it)')}`,
		...(chat.length ? chat : [dim('  nothing yet')]),
		'',
		`Open comments: ${open.length}`,
		...comments,
		'',
		...(state.hint ? [orange(state.hint)] : []),
	];

	let footer;

	if (draft) footer = `${bold(DRAFT_PROMPTS[draft.kind](draft))} ${draft.text}█  ${dim('enter send · esc cancel')}`;
	else if (state.picking)
		footer = `${bold('Reply to which comment?')} ${dim('1-' + comments.length + ' · esc cancel')}`;
	else {
		footer = [
			canNote && `${bold('c')} chat`,
			canNote && `${bold('m')} comment on selection`,
			canNote && comments.length && `${bold('r')} reply`,
			`${bold('d')} detach`,
			state.canSwitch !== false && `${bold('s')} switch`,
			`${bold('esc')} back to Claude`,
		]
			.filter(Boolean)
			.join('   ');
	}

	// Keeps the footer on screen by dropping the oldest lines first
	const room = rows - 2;

	return `${CLEAR}${lines
		.slice(Math.max(0, lines.length - room))
		.map(line => fit(line, width))
		.join('\r\n')}\r\n${fit(footer, width)}`;
};

const typeInto = (draft, key) => {
	if (key === '\x7f' || key === '\b') draft.text = draft.text.slice(0, -1);
	else draft.text += printable(key);
};

const send = draft => {
	const text = draft.text.trim();

	if (!text) return { type: 'redraw' };
	if (draft.kind === 'comment') return { type: 'comment', quote: draft.quote, text };
	if (draft.kind === 'reply') return { type: 'reply', commentId: draft.commentId, text };

	return { type: 'chat', text };
};

const CANCEL = ['\x1b', '\x03'];

// Handles a keypress while the overlay is up. Returns the action the attach loop should take.
// `readSelection` returns the text this person last selected in their terminal, or null.
export const overlayKey = (state, key, { readSelection = () => null } = {}) => {
	state.hint = null;

	if (state.draft) {
		if (key === '\r' || key === '\n') {
			const action = send(state.draft);

			state.draft = null;

			return action;
		}

		if (CANCEL.includes(key)) state.draft = null;
		else typeInto(state.draft, key);

		return { type: 'redraw' };
	}

	if (state.picking) {
		state.picking = false;

		const comment = shownComments(state.notes)[Number(key) - 1];

		if (comment) state.draft = { kind: 'reply', text: '', commentId: comment.id, author: comment.author };

		return { type: 'redraw' };
	}

	if (key === 'd') return { type: 'detach' };
	if (key === 's' && state.canSwitch !== false) return { type: 'switch' };

	if (state.role !== 'watch') {
		if (key === 'c') {
			state.draft = { kind: 'chat', text: '' };

			return { type: 'redraw' };
		}

		if (key === 'm') {
			const quote = readSelection()?.trim().slice(0, MAX_QUOTE);

			if (quote) state.draft = { kind: 'comment', text: '', quote };
			else state.hint = 'Nothing selected. Shift+drag over the text in Claude first, then Ctrl+] and m.';

			return { type: 'redraw' };
		}

		if (key === 'r' && shownComments(state.notes).length) {
			state.picking = true;

			return { type: 'redraw' };
		}
	}

	return { type: 'close' };
};
