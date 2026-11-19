import { View } from '@vanilla-bean/components';

import { getSession, logout } from './api';
import ArcadeGame from './Arcade/ArcadeGame';
import ArcadePage from './Arcade/Arcade.styles';
import { Bar, ghostButton } from './Bar';
import { element } from './dom';
import { updateTabTitle } from './tabTitle';

// What a guest handed only what the session serves (Try it) gets: that page, live, the whole screen under a bar that
// names it; no terminal, no talk, nothing else of the session
export default class TryView extends View {
	build() {
		const page = new ArcadePage({ appendTo: this });
		const bar = new Bar({ appendTo: page });
		const title = element('span', 'title', 'Try it');
		const stage = element('div', 'stage');

		title.style.flex = '1';
		bar.elem.append(title);
		this.game = new ArcadeGame({ sessionId: this.options.id, keepRunning: false, appendTo: stage });
		ghostButton(bar, { icon: 'rotate-right', title: 'Reload it', onPress: () => this.game.reload() });
		ghostButton(bar, {
			icon: 'right-from-bracket',
			title: 'Leave',
			onPress: async () => {
				await logout();
				window.location.reload();
			},
		});
		page.elem.append(stage);
		this.addCleanup('tabTitle', () => updateTabTitle({ page: '' }));
		updateTabTitle({ page: 'Try it' });
		getSession(this.options.id).then(({ body }) => {
			if (body?.title || body?.project) title.textContent = body.title || body.project;
		});
	}
}
