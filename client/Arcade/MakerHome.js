import { View, appendStyles } from '@vanilla-bean/components';

import { logout } from '../api';
import { button, element } from '../dom';
import { identity } from '../identity';
import { updateTabTitle } from '../tabTitle';
import { newArcadeForm } from './makeArcade';

// A game maker's own arcade (an invite to make games of their own): every game they've made, each the one session it's
// always been, opened where it was left (Claude compacting it as it grows), and a way to make a new one. Big and
// plain.
const STYLES = `
	.maker-home {
		box-sizing: border-box;
		width: 100%;
		max-width: 960px;
		margin: 0 auto;
		padding: 24px 16px 48px;
		font-size: 1.25rem;
	}

	.maker-home h1 {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 2rem;
		margin: 0 0 24px;
	}

	.maker-home h1 .leave {
		margin-left: auto;
		font-size: 1rem;
	}

	.maker-home .games {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
		gap: 16px;
	}

	.maker-home .game,
	.maker-home .new-game {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 6px;
		min-height: 120px;
		padding: 20px;
		border: 2px solid rgba(255, 255, 255, 0.15);
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.04);
		color: inherit;
		font: inherit;
		font-size: 1.4rem;
		text-align: left;
		cursor: pointer;
	}

	.maker-home .game:hover,
	.maker-home .new-game:hover {
		border-color: rgba(255, 255, 255, 0.4);
	}

	.maker-home .game .when {
		font-size: 0.9rem;
		opacity: 0.6;
	}

	.maker-home .new-game {
		align-items: center;
		text-align: center;
		border-style: dashed;
	}

	.maker-home form {
		display: none;
		flex-direction: column;
		gap: 12px;
		margin: 24px 0;
		font-size: 1.1rem;
	}

	.maker-home.making form {
		display: flex;
	}

	.maker-home form textarea {
		min-height: 4em;
	}

	.maker-home form pre {
		max-height: 10em;
		overflow: auto;
		white-space: pre-wrap;
		font-size: 0.85rem;
	}
`;

const since = stamp => {
	const days = Math.floor((Date.now() - Date.parse(stamp)) / 86_400_000);

	if (!Number.isFinite(days)) return '';
	if (days < 1) return 'Started today';
	if (days === 1) return 'Started yesterday';

	return `Started ${days} days ago`;
};

export default class MakerHome extends View {
	build() {
		appendStyles(STYLES);

		const name = identity()?.name ?? 'My';
		const page = element('div', 'maker-home');
		const leave = button(
			'Leave',
			async () => {
				await logout();
				window.location.reload();
			},
			{ className: 'leave variant-flat' },
		);
		const heading = element('h1', '', `🕹️ ${name}'s games`);
		const games = element('div', 'games');
		const { form, focus } = newArcadeForm({ asMaker: true });
		const newGame = element('button', 'new-game', '✨ Make a new game');

		heading.append(leave);
		newGame.type = 'button';
		newGame.addEventListener('click', () => {
			page.classList.toggle('making');
			if (page.classList.contains('making')) focus();
		});
		page.append(heading, form, games);
		this.elem.append(page);
		updateTabTitle({ page: `${name}'s games` });

		this.load(games, newGame);
	}

	async load(games, newGame) {
		const response = await fetch('/api/arcade/mine').catch(() => null);
		const mine = response?.ok ? await response.json() : [];

		games.replaceChildren(
			newGame,
			...mine.map(game => {
				const card = element('button', 'game');

				card.type = 'button';
				card.append(element('span', '', `🎮 ${game.title}`), element('span', 'when', since(game.made)));
				card.addEventListener('click', () => (window.location.hash = `#/arcade/${game.id}`));

				return card;
			}),
		);
	}
}
