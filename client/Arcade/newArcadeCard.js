import { Elem, Notify, styled } from '@vanilla-bean/components';

import { READING } from '../../shared/arcade';
import { readProgress, recentLines } from '../../shared/progress';
import { button, element } from '../dom';

// The home page's way into the arcade: name the game and who's building it, and paude makes a project from the game
// scaffold, starts Claude in it on the kid's terms, and opens the arcade page on it. On this paude, or on any other
// this machine is logged into (remotes(): the reachable ones, as the home page has them), where the game then lives
// and runs; openThere(remote, { arcade }) takes the browser to the arcade there.
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

const newArcadeCard = ({ remotes = () => [], openThere } = {}) => {
	const card = new Card({});
	const opener = element('button', 'open-form variant-flat', '🕹️ New arcade game');
	const form = element('form');
	const name = element('input');
	const player = element('input');
	const reading = element('select');
	const where = element('select');
	const hint = element('div', 'meta');
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
	for (const [key, { label }] of Object.entries(READING)) {
		const option = element('option', '', label);

		option.value = key;
		reading.append(option);
	}
	reading.value = 'learning';
	hint.textContent = READING[reading.value].detail;
	reading.addEventListener('change', () => (hint.textContent = READING[reading.value].detail));
	form.append(
		name,
		player,
		reading,
		make,
		button('', close, { icon: 'xmark', title: 'Cancel (Esc)', className: 'icon-only' }),
		hint,
	);
	card.elem.append(opener, form, progress);
	opener.addEventListener('click', () => {
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

		const game = { name: name.value.trim(), player: player.value.trim(), reading: reading.value };
		const remote = remotes().find(other => other.url === where.value) ?? null;
		const response = await fetch(remote ? '/api/remotes/arcade' : '/api/arcade', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(remote ? { url: remote.url, ...game } : game),
		}).catch(() => null);
		let output = '';
		let made = { error: 'Could not reach the server.' };

		if (response && !response.ok) made = { error: await response.text() };
		else if (response)
			made = await readProgress(response, arrived => {
				output += arrived;
				progress.textContent = recentLines(output, 10).join('\n');
				progress.scrollTop = progress.scrollHeight;
			});

		make.disabled = false;
		if (made?.id) {
			close();
			if (remote) openThere?.(remote, { arcade: made.id });
			else window.location.hash = `#/arcade/${made.id}`;
		} else {
			card.elem.classList.remove('making');
			new Notify({ intent: 'danger', content: made?.error || 'The game could not be made.' });
		}
	});

	return card.elem;
};

export default newArcadeCard;
