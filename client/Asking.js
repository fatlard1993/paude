import { Elem, Notify, styled } from '@vanilla-bean/components';

import { answerAsking, continueAfterLimit } from './api';
import { button, element } from './dom';

// What Claude is asking (a permission, a question), answered with a tap: a phone needn't work Claude's dialog in a
// terminal. Each answer presses its number, as long as Claude still asks that.
export const AskingCard = styled(
	Elem,
	({ colors }) => `
		box-sizing: border-box;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		border-radius: 8px;
		background: ${colors.alpha(colors.black, 0.96)};
		box-shadow: inset 0 0 0 1px ${colors.alpha(colors.orange, 0.5)};
		color: ${colors.white};
		font-size: 0.9em;

		.title {
			color: ${colors.light(colors.orange)};
			font-weight: bold;
		}

		.details {
			font-family: monospace;
			white-space: pre-wrap;
			word-break: break-word;
			max-height: 8em;
			overflow: auto;
			color: ${colors.alpha(colors.white, 0.8)};
		}

		.question {
			font-weight: bold;
		}

		.answers {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.answers button {
			padding: 8px 10px;
			border: none;
			border-radius: 6px;
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
			font: inherit;
			text-align: left;
			white-space: normal;
			word-break: break-word;
		}

		.answers button small {
			display: block;
			opacity: 0.7;
		}
	`,
);

// Fills `card` with what's asked; answers only when canAnswer, and onAnswered after one goes through
export const showAsking = (card, sessionId, asking, { canAnswer, onAnswered }) => {
	const into = card.elem ?? card;

	into.replaceChildren();
	if (asking.title) into.append(element('div', 'title', asking.title));
	if (asking.details.length) into.append(element('div', 'details', asking.details.join('\n')));
	into.append(element('div', 'question', asking.question));
	if (!canAnswer) return;

	const answers = element('div', 'answers');

	for (const option of asking.options) {
		const choice = button(`${option.key}. ${option.label}`, async event => {
			event.preventDefault();
			event.stopPropagation();

			const { response } = await answerAsking(sessionId, asking.question, option.key);

			if (response?.ok) onAnswered?.();
			else new Notify({ type: 'warning', content: 'Claude is no longer asking that' });
		});

		if (option.detail) choice.append(element('small', '', option.detail));
		answers.append(choice);
	}
	into.append(answers);
};

const clock = time => new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// A session a usage limit stopped: when it resets, and carrying on, now or then. Claude Code may carry on by itself at
// the reset; whichever goes first, the other finds Claude already working and stands down.
export const showLimit = (card, sessionId, limit, { canAct, onChanged }) => {
	const into = card.elem ?? card;
	const now = Date.now();
	const reset = limit.resetAt && limit.resetAt > now;

	into.replaceChildren(element('div', 'title', 'Usage limit reached'));
	into.append(
		element(
			'div',
			'question',
			(limit.stale && 'It has reset: Claude is waiting to carry on') ||
				(limit.armed &&
					(limit.resetAt
						? `paude carries on when it resets, at ${clock(limit.resetAt)}`
						: 'paude tries to carry on every half hour')) ||
				(reset && `Resets at ${clock(limit.resetAt)}`) ||
				(limit.resetAt ? 'It has reset' : "Claude didn't say when it resets"),
		),
	);
	if (!canAct) return;

	const answers = element('div', 'answers');
	const act = (label, when) =>
		button(label, async event => {
			event.preventDefault();
			event.stopPropagation();

			const { response } = await continueAfterLimit(sessionId, when);

			if (response?.ok) onChanged?.(when);
			else new Notify({ type: 'warning', content: "Claude can't take it now: busy, asking, or something is typed" });
		});

	if (limit.armed) answers.append(act("Don't wait", 'cancel'));
	else {
		if (!reset || limit.stale) answers.append(act('Continue', 'now'));
		if (!limit.stale && (reset || !limit.resetAt)) answers.append(act('Continue when reset', 'reset'));
	}
	into.append(answers);
};
