import inputKind from '../shared/inputKind';
import relativeTime from '../shared/relativeTime';
import { CLEAR, bold, dim, fit, orange, printable, size, wrap } from './screen';

const KIND_LABELS = { terminal: 'terminal', web: 'browser' };
const CHAT_LINES = 8;
const MAX_LISTED_COMMENTS = 9;
const QUOTE_LINES = 8;
const MAX_QUOTE = 2000;
const CANCEL = ['\x1b', '\x03'];

const firstLine = text =>
	printable(
		text
			.split('\n')
			.find(line => line.trim())
			?.trim() ?? '',
	);

const openComments = notes => notes.comments.filter(({ resolved }) => !resolved).slice(-MAX_LISTED_COMMENTS);

const threadComment = state => state.notes.comments.find(({ id }) => id === state.thread);

const DRAFT_PROMPTS = {
	chat: () => 'Message:',
	comment: draft => `Comment on "${firstLine(draft.quote)}":`,
	reply: draft => `Reply to ${printable(draft.author)}:`,
};

const listView = state => {
	const { presence, notes } = state;
	const here = presence.clients.map((client, index) => {
		const who = index === presence.you ? 'you' : printable(client.name);

		return `  ${client.driver ? orange('●') : ' '} ${who} ${dim(`(${KIND_LABELS[client.kind] ?? 'unknown'})`)}`;
	});
	const chat = notes.chat
		.slice(-CHAT_LINES)
		.map(({ author, text, at }) => `  ${bold(printable(author))} ${dim(relativeTime(at))}  ${printable(text)}`);
	const comments = openComments(notes).map(({ author, quote, text, replies }, index) => {
		const thread = replies.length ? dim(` (${replies.length} ${replies.length === 1 ? 'reply' : 'replies'})`) : '';

		return `  ${bold(String(index + 1))} ${dim(`"${firstLine(quote)}"`)} ${bold(printable(author))}: ${printable(text)}${thread}`;
	});

	return [
		'Here now:',
		...here,
		'',
		`Chat ${dim('(between people; Claude never sees it)')}`,
		...(chat.length ? chat : [dim('  nothing yet')]),
		'',
		`Open comments: ${notes.comments.filter(({ resolved }) => !resolved).length}${comments.length ? dim('  (press a number to read one)') : ''}`,
		...comments,
	];
};

const threadView = (state, width) => {
	const comment = threadComment(state);

	if (!comment) return [dim('That comment is gone.')];

	const quote = String(comment.quote).split('\n');
	const shownQuote = quote.slice(0, QUOTE_LINES).map(line => dim(`│ ${printable(line)}`));
	const entry = ({ author, at, text }) => [
		`${bold(printable(author))} ${dim(relativeTime(at))}`,
		...wrap(printable(text), width - 2).map(line => `  ${line}`),
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

const footerFor = (state, canNote) => {
	const { draft } = state;

	if (draft) return `${bold(DRAFT_PROMPTS[draft.kind](draft))} ${draft.text}█  ${dim('enter send · esc cancel')}`;

	if (state.thread) {
		const comment = threadComment(state);

		return [
			canNote && comment && `${bold('r')} reply`,
			canNote && comment && `${bold('x')} ${comment.resolved ? 'reopen' : 'resolve'}`,
			`${bold('esc')} back`,
		]
			.filter(Boolean)
			.join('   ');
	}

	return [
		canNote && `${bold('c')} chat`,
		canNote && `${bold('m')} comment on selection`,
		`${bold('d')} detach`,
		state.canSwitch !== false && `${bold('s')} switch`,
		`${bold('esc')} back to Claude`,
	]
		.filter(Boolean)
		.join('   ');
};

export const renderOverlay = state => {
	const { cols, rows } = size();
	const width = cols - 1;
	const lines = [
		bold(`paude · ${printable(state.presence.title) || state.id}`),
		dim(state.presence.busy ? 'Claude is working' : 'Claude is idle'),
		'',
		...(state.thread ? threadView(state, width) : listView(state)),
		'',
		...(state.hint ? [orange(state.hint)] : []),
	];
	// The list keeps its newest lines when it overflows; a thread keeps its top, where the quote and comment are
	const room = rows - 2;
	const shown = state.thread ? lines.slice(0, room) : lines.slice(Math.max(0, lines.length - room));

	return `${CLEAR}${shown.map(line => fit(line, width)).join('\r\n')}\r\n${fit(footerFor(state, state.role !== 'watch'), width)}`;
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

	if (key === 'r') {
		state.draft = { kind: 'reply', text: '', commentId: comment.id, author: comment.author };

		return { type: 'redraw' };
	}

	if (key === 'x') return { type: 'resolve', commentId: comment.id, resolved: !comment.resolved };

	return { type: 'ignore' };
};

// Handles a keypress while the overlay is up. Returns the action the attach loop should take; 'ignore' needs no
// redraw. `readSelection` returns the text this person last selected in their terminal, or null.
export const overlayKey = (state, key, { readSelection = () => null } = {}) => {
	// Mouse and focus reports, and terminal replies, aren't keys
	if (inputKind(key) !== 'typing') return { type: 'ignore' };

	state.hint = null;

	const canNote = state.role !== 'watch';

	if (state.draft) return draftKey(state, key);
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

	if (canNote && key === 'm') {
		const quote = readSelection()?.trim().slice(0, MAX_QUOTE);

		if (quote) state.draft = { kind: 'comment', text: '', quote };
		else state.hint = 'Nothing selected. Shift+drag over the text in Claude first, then Ctrl+] and m.';

		return { type: 'redraw' };
	}

	return { type: 'ignore' };
};
