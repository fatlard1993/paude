import { Notify } from '@vanilla-bean/components';

import { catchUpOn } from '../api';
import { button, element } from '../dom';
import { recall, remember } from '../storage';

// When this browser last had the session open, so catching up starts there
const LAST_SEEN_KEY = 'paude.lastSeen.';
const SEEN_EVERY_MS = 60_000;
// Enough of a prompt to find its line in the scrollback, short enough to sit on that line on a phone
const PROMPT_PROBE = 28;

const clock = time => new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Keeps this browser's last look at the session up to date while it's open; returns the look before this one
export const trackLastSeen = (sessionId, addCleanup) => {
	const key = LAST_SEEN_KEY + sessionId;
	const before = Number(recall(key)) || null;
	const mark = () => !document.hidden && remember(key, String(Date.now()));
	const timer = setInterval(mark, SEEN_EVERY_MS);

	mark();
	document.addEventListener('visibilitychange', mark);
	addCleanup('lastSeen', () => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', mark);
	});

	return before;
};

// The row a prompt starts on in the terminal's scrollback, the latest if it's there more than once; null when it has
// scrolled out of what the terminal keeps
const promptRow = (terminal, prompt) => {
	const probe = prompt
		.split('\n')[0]
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, Math.min(PROMPT_PROBE, terminal.cols - 4));
	const buffer = terminal.buffer.active;

	if (!probe) return null;
	for (let y = buffer.length - 1; y >= 0; y--) {
		const text = buffer.getLine(y)?.translateToString(true) ?? '';

		if (/^\s*[❯>]/.test(text) && text.replace(/\s+/g, ' ').includes(probe)) return y;
	}

	return null;
};

// A tour of what happened: an overview, then a stop per turn, each scrolling the terminal to where that turn began
export const startCatchUp = async ({ card, sessionId, since, terminal, openActivity }) => {
	const into = card.elem;
	const shown = into.classList;
	const close = () => {
		shown.remove('shown');
		terminal?.clearSelection();
	};

	into.replaceChildren(
		element('div', 'title', 'Catching you up'),
		element('div', 'question', 'Reading what happened…'),
	);
	shown.add('shown');

	const { body, response } = await catchUpOn(sessionId, since);

	if (!response?.ok) {
		close();
		new Notify({ type: 'warning', content: "Couldn't catch you up just now" });

		return;
	}

	const { overview, stops } = body;
	const show = index => {
		const stop = stops[index - 1];
		const answers = element('div', 'answers');
		const where = stop && terminal ? promptRow(terminal, stop.prompt) : null;

		into.replaceChildren(
			element(
				'div',
				'title',
				index === 0
					? `Since ${since ? clock(since) : 'lately'}: ${stops.length} turn${stops.length === 1 ? '' : 's'}`
					: `${index} of ${stops.length} · ${clock(stop.at)}`,
			),
			element('div', 'question', index === 0 ? overview : stop.text),
		);
		terminal?.clearSelection();
		if (where !== null) {
			terminal.scrollToLine(Math.max(0, where - 2));
			terminal.select(0, where, terminal.cols);
		} else if (stop) {
			into.append(element('div', 'details', 'Before what the terminal keeps: the Activity panel has it'));
			if (openActivity) answers.append(button('Open in Activity', () => openActivity(stop.turnId)));
		}
		if (index > 0) answers.append(button('Back', () => show(index - 1)));
		if (index < stops.length) answers.append(button(index === 0 ? 'Start the tour' : 'Next', () => show(index + 1)));
		answers.append(
			button(index === stops.length && index > 0 ? 'Done' : 'Close', () => {
				close();
				if (index > 0) terminal?.scrollToBottom();
			}),
		);
		into.append(answers);
	};

	show(0);
};
