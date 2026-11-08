import { Elem, Notify, styled } from '@vanilla-bean/components';

import { button, element } from '../dom';
import { goToArcade, makeArcade, readingSelect, whereSelect } from './makeArcade';

// The home page's way into the arcade: name the game and who's building it, and paude makes a project from the game
// scaffold, starts Claude in it on the kid's terms, and opens the arcade page on it. On this paude, or on any other
// this machine is logged into (remotes(): the reachable ones, as the home page has them), where the game then lives
// and runs.
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

		form select {
			flex: 1 1 160px;
		}

		form .meta {
			flex: 1 1 100%;
			color: ${colors.muted};
			font-size: 0.85em;
		}

		pre {
			display: none;
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

		&.open form {
			display: flex;
		}

		&.making pre {
			display: block;
		}
	`,
);

const newArcadeCard = ({ remotes = () => [] } = {}) => {
	const card = new Card({});
	const opener = element('button', 'open-form variant-flat', '🕹️ New arcade game');
	const form = element('form');
	const name = element('input');
	const player = element('input');
	const { reading, hint } = readingSelect();
	const where = whereSelect([]);
	const make = element('button', '', 'Make it');
	const progress = element('pre');
	const close = () => {
		card.elem.classList.remove('open', 'making');
		name.value = '';
		player.value = '';
	};

	name.placeholder = "What's the game called?";
	name.maxLength = 60;
	name.required = true;
	player.placeholder = "Who's building it? (their name)";
	player.maxLength = 40;
	form.append(
		name,
		player,
		reading,
		where,
		make,
		button('', close, { icon: 'xmark', title: 'Cancel (Esc)', className: 'icon-only' }),
		hint,
	);
	card.elem.append(opener, form, progress);
	opener.addEventListener('click', () => {
		// The other paudes as the page knows them now
		where.replaceWith((form.where = whereSelect(remotes())));
		card.elem.classList.add('open');
		name.focus();
	});
	form.addEventListener('keydown', event => event.key === 'Escape' && close());
	form.addEventListener('submit', async event => {
		event.preventDefault();
		if (!name.value.trim() || card.elem.classList.contains('making')) return;

		card.elem.classList.add('making');
		make.disabled = true;
		progress.textContent = '';

		const picked = form.where ?? where;
		const remote = remotes().find(other => other.url === picked.value) ?? null;
		const made = await makeArcade(
			{ name: name.value.trim(), player: player.value.trim(), reading: reading.value },
			remote,
			progress,
		);

		make.disabled = false;
		if (made?.id) {
			close();
			if (!(await goToArcade(made.id, remote)))
				new Notify({
					intent: 'danger',
					content: `The game is made, but ${remote.name} could not be opened from here.`,
				});
		} else {
			card.elem.classList.remove('making');
			new Notify({ intent: 'danger', content: made?.error || 'The game could not be made.' });
		}
	});

	return card.elem;
};

export default newArcadeCard;
