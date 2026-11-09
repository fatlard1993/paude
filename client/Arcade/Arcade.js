import { View, appendStyles } from '@vanilla-bean/components';

import { hostArcadeGame, logout } from '../api';
import { Bar, ghostButton } from '../Bar';
import confirmDialog from '../confirmDialog';
import { button, element } from '../dom';
import { identity } from '../identity';
import { updateTabTitle } from '../tabTitle';
import ArcadePage from './Arcade.styles';
import ArcadeGame from './ArcadeGame';
import ArcadeTalk from './ArcadeTalk';

// A session as a kid plays it: the game they're building on one side, the talk with Claude on the other, in big type,
// read aloud, answered by tapping a choice or talking. No terminal. The same session as its own page shows; this is
// its arcade twin, for the owner too (to try it, or to sit beside the kid). The ship has the same two as panels of
// the session's dock.
const TOASTS_UP = `
	body.arcade > .stacked {
		bottom: auto !important;
		top: calc(56px + env(safe-area-inset-top, 0px));
	}
`;

export default class Arcade extends View {
	build() {
		this.id = this.options.id;
		this.arcade = null;
		this.page = new ArcadePage({ appendTo: this });
		this.buildBar();

		const stage = element('div', 'stage');

		this.game = new ArcadeGame({ sessionId: this.id, appendTo: stage });
		this.talk = new ArcadeTalk({
			sessionId: this.id,
			appendTo: stage,
			// The bar names the game, from its marker (which Claude writes a chosen name into); Claude's own title for
			// the conversation only until that is known
			onStatus: session => {
				if (!this.arcade?.title) this.title.textContent = session.title || session.project || 'Arcade';
			},
			onArcade: (arcade, host) => {
				this.arcade = arcade;
				if (arcade?.title) this.title.textContent = arcade.title;
				if (arcade && host && this.hostButton) this.hostButton.style.display = '';
				// Rested before this session was known to be an arcade (a fresh load finding a question up)
				if (arcade && this.resting) this.play(true);
			},
			// The loop a kid plays in: a change asked for, Claude's word on it read out, then the game alone to play,
			// until the big button brings the talk back and reads the choices again
			onRested: () => {
				this.resting = true;
				if (this.arcade) this.play(true);
			},
			onBusy: () => {
				this.resting = false;
				this.play(false);
			},
		});
		this.page.elem.append(stage);
		// Whatever toasts the page still gets (a watched session needing the owner) go to the top: the bottom is where the
		// kid's choices and box are
		appendStyles(TOASTS_UP, 'arcade-toasts');
		document.body.classList.add('arcade');
		this.addCleanup('toasts', () => document.body.classList.remove('arcade'));
		this.addCleanup('tabTitle', () => updateTabTitle({ page: '' }));
		updateTabTitle({ page: 'Arcade' });
	}

	buildBar() {
		const bar = new Bar({ appendTo: this.page });
		const owner = identity()?.owner;

		if (owner) {
			ghostButton(bar, { icon: 'house', title: 'Home', onPress: () => (window.location.hash = '#/') });
			ghostButton(bar, {
				icon: 'terminal',
				title: "The session's own page",
				onPress: () => (window.location.hash = `#/sessions/${this.id}`),
			});
		}
		ghostButton(bar, {
			icon: 'rocket',
			title: 'The ship: this session at its desk in the universe, with the talk and the game as panels',
			onPress: () => (window.location.hash = `#/universe/sessions/${encodeURIComponent(this.id)}`),
		});
		this.title = element('span', 'title', 'Arcade');
		this.title.style.flex = '1';
		this.title.style.minWidth = '0';
		this.title.style.overflow = 'hidden';
		this.title.style.textOverflow = 'ellipsis';
		this.title.style.whiteSpace = 'nowrap';
		bar.elem.append(this.title);
		// The big button, in the bar so it never sits over the game: shown while the game has the whole screen
		this.changeButton = button('Change the game', () => this.changeIt(), {
			icon: 'wand-magic-sparkles',
			className: 'change-button',
			title: 'Back to Claude: hear the choices and pick what happens next',
		});
		bar.elem.append(this.changeButton);
		ghostButton(bar, { icon: 'rotate-right', title: 'Reload the game', onPress: () => this.game.reload() });
		// Hosting is the owner's alone, and shown once this is known to be an arcade. Not the hidden attribute: the button's
		// own display rule outranks it.
		if (owner) {
			this.hostButton = ghostButton(bar, {
				icon: 'house-signal',
				title: "Put it with the house's games: hosted by the mother hub, at a name of its own",
				onPress: () => this.host(),
			});
			this.hostButton.style.display = 'none';
		}
		if (!owner)
			ghostButton(bar, {
				icon: 'right-from-bracket',
				title: 'Leave',
				onPress: async () => {
					await logout();
					window.location.reload();
				},
			});
	}

	// The game alone to play, or the talk beside it
	play(on) {
		this.page.elem.classList.toggle('playing', on);
	}

	// The big button: the talk comes back, and the question is read again, now, for a hand that just pressed
	changeIt() {
		this.play(false);
		this.talk.readAsking();
	}

	async host() {
		const name = this.arcade?.title || this.title.textContent;
		const confirmed = await confirmDialog({
			header: `Put ${name} with the house's games?`,
			body: "The mother hub hosts it from now on, at a name of its own, built as it's committed right now: it can be turned on and off, updated and shared from there. Doing this again later brings the newer game there.",
			confirmLabel: 'Host it',
		});

		if (!confirmed) return;
		this.talk.notice('Handing it to the mother hub…', 'info');

		const { body, response } = await hostArcadeGame(this.id);

		if (!response?.ok) {
			this.talk.notice(typeof body === 'string' && body ? body : 'The mother hub refused it', 'danger');

			return;
		}
		this.talk.notice(`Hosted${body.url ? ` at ${body.url}` : `, on port ${body.port}`}`, 'success');
	}
}
