import { Elem, styled } from '@vanilla-bean/components';

import { getRemotes } from '../api';
import { button, element } from '../dom';
import { identity } from '../identity';
import { knownServers, setServers } from '../servers';
import { newArcadeForm } from './makeArcade';
import makersPanel from './makersPanel';

// The home page's way into the arcade: name the game and who's building it, and paude makes a project from the game
// scaffold, starts Claude in it on the kid's terms, and opens the arcade page on it. On this paude, or on any other
// this machine is logged into, asked for as the card opens, where the game then lives and runs.
const Card = styled(
	Elem,
	({ colors, radius, space }) => `
		display: flex;
		flex-direction: column;
		min-height: 56px;

		.open-form {
			flex: 1;
			align-self: stretch;
			border: 1px dashed ${colors.alpha(colors.white, 0.18)};
			border-radius: ${radius.md};
			color: ${colors.muted};
			font: inherit;
		}

		.open-form:hover {
			border-color: ${colors.alpha(colors.white, 0.35)};
			color: ${colors.white};
		}

		form {
			display: none;
			flex-wrap: wrap;
			gap: ${space.sm};
			padding: ${space.sm};
			border: 1px dashed ${colors.alpha(colors.white, 0.18)};
			border-radius: ${radius.md};
		}

		form input {
			flex: 1 1 160px;
			min-width: 0;
		}

		form textarea {
			flex: 1 1 100%;
			min-height: 3em;
			resize: vertical;
		}

		form select {
			flex: 1 1 160px;
		}

		form .meta {
			flex: 1 1 100%;
			color: ${colors.muted};
			font-size: 0.85em;
		}

		pre {
			max-height: 10em;
			overflow: auto;
			margin: ${space.sm} 0 0;
			padding: ${space.sm} ${space.md};
			border-radius: ${radius.md};
			background: ${colors.alpha(colors.black, 0.35)};
			font-size: 0.85em;
			white-space: pre-wrap;
		}

		&.open .open-form {
			display: none;
		}

		&.open form.new-arcade {
			display: flex;
		}

		.makers {
			margin-top: ${space.sm};
		}

		.makers .open-form {
			width: 100%;
			min-height: 40px;
		}

		.makers.open form {
			display: flex;
		}

	`,
);

// The other paudes this machine can make a game on, for this machine's own login: the ones last found, at once, then
// asked again (which takes a moment per paude) in case one came or went
const otherPaudes = async onFound => {
	if (!identity()?.remotes) return;
	onFound(knownServers());

	const { body } = await getRemotes().catch(() => ({}));

	if (!Array.isArray(body)) return;
	setServers(body);
	onFound(body.filter(remote => !remote.error));
};

const newArcadeCard = () => {
	const card = new Card({});
	const opener = element('button', 'open-form variant-flat', '🕹️ New arcade game');
	const { form, hint, setRemotes, reset, focus } = newArcadeForm({ onMade: () => close() });
	const close = () => {
		card.elem.classList.remove('open');
		reset();
	};

	form.insertBefore(button('', close, { icon: 'xmark', title: 'Cancel (Esc)', className: 'icon-only' }), hint);
	card.elem.append(opener, form, makersPanel());
	opener.addEventListener('click', () => {
		card.elem.classList.add('open');
		focus();
		otherPaudes(setRemotes);
	});
	form.addEventListener('keydown', event => event.key === 'Escape' && close());

	return card.elem;
};

export default newArcadeCard;
