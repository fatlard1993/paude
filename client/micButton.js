import { appendStyles, theme } from '@vanilla-bean/components';

import { button } from './dom';
import { canListen, listen } from './speech';

// A microphone beside a box words go in: pressed, it listens until the talking stops (this paude's ear when it has
// one, the browser's otherwise) and hands the words to `onText`, for the box to take. The same button wherever a
// prompt is typed. null when this browser can't listen.
const STYLES = `
	.mic-button.hearing {
		background: ${theme.colors.red} !important;
		color: ${theme.colors.white} !important;
		animation: mic-pulse 1s ease-in-out infinite;
	}

	.mic-button.thinking {
		background: ${theme.colors.purple} !important;
		color: ${theme.colors.white} !important;
		animation: mic-pulse 0.6s ease-in-out infinite;
	}

	@keyframes mic-pulse {
		50% {
			opacity: 0.55;
		}
	}
`;

export const micButton = ({ session, onText, className = '', title = 'Say it instead of typing' }) => {
	if (!canListen()) return null;
	appendStyles(STYLES, 'mic-button');

	let ear = null;
	const mic = button('', () => press(), { icon: 'microphone', className: `mic-button icon-only ${className}`, title });
	const press = () => {
		if (ear) {
			ear.stop();

			return;
		}
		mic.classList.add('hearing');
		mic.title = 'Listening… press to stop';
		ear = listen({
			session,
			onThinking: () => {
				mic.classList.remove('hearing');
				mic.classList.add('thinking');
			},
			onEnd: reason => {
				ear = null;
				mic.classList.remove('hearing', 'thinking');
				mic.title = title;
				if (reason === 'denied') mic.title = 'The microphone is blocked here: allow it in the address bar';
			},
			onHeard: (text, final) => final && text.trim() && onText(text.trim()),
		});
	};

	return mic;
};

// Words put into a box: after what's there, with a space, and the box told, so what keeps its draft keeps these too
export const intoBox = (box, text) => {
	box.value = `${box.value.trimEnd()}${box.value.trim() ? ' ' : ''}${text}`;
	box.dispatchEvent(new Event('input', { bubbles: true }));
	box.focus();
};
