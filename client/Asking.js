import { Elem, Notify, styled } from '@vanilla-bean/components';

import { answerAsking } from './api';
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
		background: ${colors.alpha(colors.black, 0.85)};
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
