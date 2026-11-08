import { Elem, Notify, styled } from '@vanilla-bean/components';

import { getRemotes } from '../api';
import { button, element } from '../dom';
import { identity } from '../identity';
import { knownServers, setServers } from '../servers';
import { goToArcade, makeArcade, readingSelect, whereSelect } from './makeArcade';

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
	let remotes = [];
	const opener = element('button', 'open-form variant-flat', '🕹️ New arcade game');
	const form = element('form');
	const name = element('input');
	const idea = element('textarea');
	const player = element('input');
	const { reading, hint } = readingSelect();
	let where = whereSelect([]);
	const make = element('button', '', 'Make it');
	const progress = element('pre');
	const close = () => {
		card.elem.classList.remove('open', 'making');
		name.value = '';
		idea.value = '';
		player.value = '';
	};

	name.placeholder = "What's it called? (or leave that to find out together)";
	name.maxLength = 60;
	idea.placeholder = 'The idea so far, as rough or detailed as you like; or leave it for Claude to ask';
	idea.rows = 2;
	idea.maxLength = 4000;
	player.placeholder = "Who's building it? (their name)";
	player.maxLength = 40;
	form.append(
		name,
		idea,
		player,
		reading,
		where,
		make,
		button('', close, { icon: 'xmark', title: 'Cancel (Esc)', className: 'icon-only' }),
		hint,
	);
	card.elem.append(opener, form, progress);
	opener.addEventListener('click', () => {
		card.elem.classList.add('open');
		name.focus();
		otherPaudes(found => {
			remotes = found;

			const picker = whereSelect(remotes);

			picker.value = remotes.some(remote => remote.url === where.value) ? where.value : '';
			where.replaceWith(picker);
			where = picker;
		});
	});
	form.addEventListener('keydown', event => event.key === 'Escape' && close());
	form.addEventListener('submit', async event => {
		event.preventDefault();
		if (card.elem.classList.contains('making')) return;

		card.elem.classList.add('making');
		make.disabled = true;
		progress.textContent = '';

		const remote = remotes.find(other => other.url === where.value) ?? null;
		const made = await makeArcade(
			{ name: name.value.trim(), idea: idea.value.trim(), player: player.value.trim(), reading: reading.value },
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
