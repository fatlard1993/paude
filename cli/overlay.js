import relativeTime from '../shared/relativeTime';
import { CLEAR, bold, dim, fit, orange, printable, size } from './screen';

const KIND_LABELS = { terminal: 'terminal', web: 'browser' };
const CHAT_LINES = 8;
const COMMENT_LINES = 4;

const firstLine = text =>
	printable(
		text
			.split('\n')
			.find(line => line.trim())
			?.trim() ?? '',
	);

export const renderOverlay = state => {
	const { id, presence, notes, draft } = state;
	const { cols, rows } = size();
	const width = cols - 1;
	const here = presence.clients.map((client, index) => {
		const who = index === presence.you ? 'you' : printable(client.name);

		return `  ${client.driver ? orange('●') : ' '} ${who} ${dim(`(${KIND_LABELS[client.kind] ?? 'unknown'})`)}`;
	});
	const chat = notes.chat
		.slice(-CHAT_LINES)
		.map(({ author, text, at }) => `  ${bold(printable(author))} ${dim(relativeTime(at))}  ${printable(text)}`);
	const open = notes.comments.filter(({ resolved }) => !resolved);
	const comments = open.slice(-COMMENT_LINES).map(({ author, quote, text, replies }) => {
		const thread = replies.length ? dim(` (+${replies.length})`) : '';

		return `  ${dim(`"${firstLine(quote)}"`)} ${bold(printable(author))}: ${printable(text)}${thread}`;
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
		`Open comments: ${open.length}${open.length ? dim(' (add and reply from the browser)') : ''}`,
		...comments,
		'',
	];

	const footer =
		draft === null
			? [
					state.role !== 'watch' && `${bold('c')} chat`,
					`${bold('d')} detach`,
					state.canSwitch !== false && `${bold('s')} switch session`,
					`${bold('esc')} back to Claude`,
				]
					.filter(Boolean)
					.join('    ')
			: `${bold('Message:')} ${draft}█  ${dim('enter send · esc cancel')}`;

	// Keeps the footer on screen by dropping the oldest lines first
	const room = rows - 2;

	return `${CLEAR}${lines
		.slice(Math.max(0, lines.length - room))
		.map(line => fit(line, width))
		.join('\r\n')}\r\n${fit(footer, width)}`;
};

// Handles a keypress while the overlay is up. Returns the action the attach loop should take.
export const overlayKey = (state, key) => {
	if (state.draft !== null) {
		if (key === '\r' || key === '\n') {
			const text = state.draft.trim();

			state.draft = null;

			return text ? { type: 'chat', text } : { type: 'redraw' };
		}

		if (key === '\x1b' || key === '\x03') state.draft = null;
		else if (key === '\x7f' || key === '\b') state.draft = state.draft.slice(0, -1);
		else state.draft += printable(key);

		return { type: 'redraw' };
	}

	if (key === 'd') return { type: 'detach' };
	if (key === 's' && state.canSwitch !== false) return { type: 'switch' };

	if (key === 'c' && state.role !== 'watch') {
		state.draft = '';

		return { type: 'redraw' };
	}

	return { type: 'close' };
};
