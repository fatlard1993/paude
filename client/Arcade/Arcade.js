import { View, appendStyles } from '@vanilla-bean/components';

import { logout, shelveArcade } from '../api';
import { Bar, ghostButton } from '../Bar';
import confirmDialog from '../confirmDialog';
import { element } from '../dom';
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
			onStatus: session => (this.title.textContent = session.title || session.project || 'Arcade'),
			onArcade: (arcade, shelf) => {
				this.arcade = arcade;
				if (arcade && shelf && this.shelfButton) this.shelfButton.style.display = '';
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
		ghostButton(bar, { icon: 'rotate-right', title: 'Reload the game', onPress: () => this.game.reload() });
		// The shelf is the owner's alone, and shown only once this paude is known to have one. Not the hidden attribute:
		// the button's own display rule outranks it.
		if (owner) {
			this.shelfButton = ghostButton(bar, {
				icon: 'box-archive',
				title: "Put it on the house shelf: run as one of the house's games, at a name of its own",
				onPress: () => this.shelve(),
			});
			this.shelfButton.style.display = 'none';
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

	async shelve() {
		const name = this.arcade?.title || this.title.textContent;
		const confirmed = await confirmDialog({
			header: `Put ${name} on the house shelf?`,
			body: "It runs as one of the house's games from now on, at a name of its own, built as it is right now. Shelving it again later puts the newer game there.",
			confirmLabel: 'Put it on the shelf',
		});

		if (!confirmed) return;
		this.talk.notice('Putting it on the shelf…', 'info');

		const { body, response } = await shelveArcade(this.id);

		if (!response?.ok) {
			this.talk.notice(typeof body === 'string' && body ? body : 'The shelf refused it', 'danger');

			return;
		}
		this.talk.notice(`On the shelf, on port ${body.port}`, 'success');
	}
}
