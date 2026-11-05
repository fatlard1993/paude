import { Notify } from '@vanilla-bean/components';

import { forkSession, getTurns } from '../api';
import confirmDialog from '../confirmDialog';
import { button, element } from '../dom';
import DONE_MARKER from '../../shared/doneMarker';
import { bufferCells } from './linkProviders';

// What a session's terminal does in the browser, wherever it's shown (its own page, or the side panel in the universe),
// so the two behave alike; its keys are claudeKeys'

// How far a finger moves before it's a drag rather than a tap, in CSS pixels
const TAP_SLOP = 8;
// The selection's buttons' distance from it and from the terminal's edges, in CSS pixels
const GAP = 6;
// xterm would scroll its own empty scrollback under the finger; every two rows dragged is a notch of the wheel
// instead, down to see earlier. Taps pass through, so a tap still brings up the keyboard. `paused()` while a drag is
// someone else's (selecting lines).
export const touchToClaude = ({ terminal, screen, pointer, send, canType, paused = () => false }) => {
	let start = null;
	let last = null;

	screen.addEventListener('touchstart', event => {
		start = last = event.touches.length === 1 ? event.touches[0].clientY : null;
	});
	screen.addEventListener(
		'touchmove',
		event => {
			if (last === null || paused()) return;

			const touch = event.touches[0];

			if (Math.abs(touch.clientY - start) < TAP_SLOP) return;

			const step = (terminal.element.getBoundingClientRect().height / terminal.rows) * 2;
			const notches = Math.trunc((touch.clientY - last) / step);

			event.preventDefault();
			event.stopPropagation();
			if (!notches) return;

			last += notches * step;
			if (!pointer.tracking()) {
				if (terminal.buffer.active.type !== 'alternate') terminal.scrollLines(-notches * 2);
			} else if (canType()) send(pointer.wheel(notches > 0, touch, Math.abs(notches)));
		},
		{ capture: true, passive: false },
	);
	screen.addEventListener('touchend', () => {
		last = null;
	});
};

// A click or tap that selected nothing goes to Claude, which moves its cursor there; a drag still selects. `paused()`
// while the click is someone else's (a link under it, lines being selected).
export const clickToClaude = ({ terminal, screen, pointer, send, canType, paused = () => false }) => {
	screen.addEventListener('click', event => {
		if (event.button !== 0 || !pointer.tracking() || !canType() || paused() || terminal.hasSelection()) return;

		send(pointer.report(0, event) + pointer.report(0, event, { release: true }));
	});
};

// The selection's buttons beside it rather than in a corner, which a panel can cover: above its first row, clear of
// the text, or below its last when there's no room above; hidden with no selection
export const besideSelection = (terminal, actions) => {
	const position = terminal.hasSelection() && terminal.getSelectionPosition();

	actions.style.display = position ? '' : 'none';
	if (!position) return;

	const screen = terminal.element.querySelector('.xterm-screen').getBoundingClientRect();
	const column = actions.parentElement.getBoundingClientRect();
	const cellWidth = screen.width / terminal.cols;
	const cellHeight = screen.height / terminal.rows;
	const rowTop = row => screen.top - column.top + (row - terminal.buffer.active.viewportY) * cellHeight;
	const clamp = (value, room) => Math.min(Math.max(value, GAP), room - GAP);
	let top = rowTop(position.start.y) - actions.offsetHeight - GAP;

	if (top < GAP) top = rowTop(position.end.y + 1) + GAP;

	actions.style.top = `${clamp(top, column.height - actions.offsetHeight)}px`;
	actions.style.left = `${clamp(screen.left - column.left + position.start.x * cellWidth, column.width - actions.offsetWidth)}px`;
};

const bufferLine = (terminal, index) => terminal.buffer.active.getLine(index)?.translateToString(true) ?? '';

// Every "done" line Claude prints after a turn gets a button after it that starts a new session from that point
// (`onFork(line)`, the line's place in the buffer). Drawn over the rows on screen in a layer after `screen`, redrawn
// with them: xterm's own decorations hide on the alternate screen, which Claude draws on.
export const forkButtons = ({ terminal, screen, onFork }) => {
	const layer = element('div', 'fork-layer');
	let pending = false;

	const forkButton = () => {
		const fork = button('', () => onFork(Number(fork.dataset.line)), {
			icon: 'code-branch',
			title: 'Start a new session holding the conversation up to this turn',
			className: 'fork-here',
		});

		fork.append(element('span', 'words', 'New session from here'));
		fork.setAttribute('aria-label', 'New session from here');
		layer.append(fork);

		return fork;
	};

	const place = () => {
		const { rows, cols } = terminal;
		const buffer = terminal.buffer.active;
		const drawn = terminal.element?.querySelector('.xterm-screen')?.getBoundingClientRect();

		if (!drawn || !layer.parentElement) return;

		const column = layer.parentElement.getBoundingClientRect();
		const cellWidth = drawn.width / cols;
		const cellHeight = drawn.height / rows;
		const spare = [...layer.children];
		let used = 0;

		for (let row = 0; row < rows; row++) {
			const { text, columns } = bufferCells(terminal, buffer.viewportY + row);

			if (!DONE_MARKER.exec(text)) continue;

			const fork = spare[used++] ?? forkButton();
			// After all of the line, not only its "done" time: Claude goes on after it (· 1 shell still running), onto
			// more rows when the terminal is narrow
			let end = row;

			while (buffer.getLine(buffer.viewportY + end + 1)?.isWrapped) end++;

			const last = end === row ? { text, columns } : bufferCells(terminal, buffer.viewportY + end);
			let after = last.text ? last.columns[last.text.length - 1] + 1 : 0;

			fork.dataset.line = buffer.viewportY + row;
			Object.assign(fork.style, { height: `${cellHeight}px`, fontSize: `${cellHeight * 0.65}px` });
			// Its words when they fit after the line, its icon alone when they'd cover it (a phone's narrow rows)
			fork.classList.remove('compact');
			fork.classList.toggle('compact', fork.offsetWidth > (cols - after) * cellWidth);

			// A line that fills its last row leaves no room even for the icon, so the button takes the row below
			if (fork.offsetWidth > (cols - after) * cellWidth) {
				const below = bufferCells(terminal, buffer.viewportY + ++end);

				after = below.text ? below.columns[below.text.length - 1] + 1 : 0;
			}

			const x = Math.min(after, cols - Math.ceil(fork.offsetWidth / cellWidth));

			Object.assign(fork.style, {
				left: `${drawn.left - column.left + x * cellWidth}px`,
				top: `${drawn.top - column.top + end * cellHeight}px`,
			});
		}

		spare.slice(used).forEach(fork => fork.remove());
	};
	const queue = () => {
		if (pending) return;
		pending = true;
		requestAnimationFrame(() => {
			pending = false;
			place();
		});
	};

	screen.after(layer);
	terminal.onRender(queue);
	terminal.onScroll(queue);

	return { layer, place };
};

// The screen only shows text, so the marker is matched to a turn by position: the nth marker from the bottom is the nth
// completed turn from the end, which holds even when older scrollback is gone. The confirmation shows that turn's
// prompt, so a mismatch is visible before anything is created. `go(id)` goes to the new session.
export const forkFromMarker = async ({ terminal, sessionId, line, go }) => {
	let markersBelow = 0;

	for (let index = line + 1; index < terminal.buffer.active.length; index++) {
		if (DONE_MARKER.test(bufferLine(terminal, index))) markersBelow += 1;
	}

	const { body, response } = await getTurns(sessionId);

	if (!response?.ok) return new Notify({ intent: 'danger', content: "Could not read this session's history." });

	// A turn still in progress has replies but no marker yet
	const turns = body.busy && body.turns.at(-1)?.last ? body.turns.slice(0, -1) : body.turns;
	const turn = turns[turns.length - 1 - markersBelow];

	if (!turn) return new Notify({ intent: 'warning', content: 'Could not match that line to a turn in the history.' });

	const confirmed = await confirmDialog({
		header: 'New session from here?',
		body: `It will hold this conversation up to and including the turn that began: "${turn.prompt}"`,
		confirmLabel: 'Start it',
	});

	if (!confirmed) return;

	const forked = await forkSession(sessionId, turn.endUuid);

	if (!forked.response?.ok) return new Notify({ intent: 'danger', content: 'Could not start the new session.' });

	go(forked.body.id);
};
