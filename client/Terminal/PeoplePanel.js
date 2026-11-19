import { closeButton, element } from '../dom';
import Panel from './PeoplePanel.styles';
import renderPeople from './People';

// Who's here now is asked again this often while the panel shows
const HERE_EVERY_MS = 10_000;

// The session's people: who's in it now, who's invited and on what, and inviting someone; the owner's alone
export default class PeoplePanel extends Panel {
	build() {
		const who = element('div', 'who');

		this.list = element('div', 'list');
		who.append(
			element('strong', '', 'People'),
			element('span', 'spacer'),
			closeButton(() => this.options.close()),
		);
		this.elem.tabIndex = -1;
		this.elem.append(who, this.list);
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape' || event.target.matches('input, select')) return;

			event.stopPropagation();
			this.options.close();
		});
		this.addCleanup('here', () => clearTimeout(this.timer));
	}

	// Opened again, all of it afresh; while it shows, who's here now every little while
	async refresh() {
		clearTimeout(this.timer);
		if (this.people) await this.people.redraw();
		else this.people = await renderPeople(this.options.sessionId, this.list);
		this.watchHere();
	}

	watchHere() {
		this.timer = setTimeout(async () => {
			if (!this.showing()) return;
			await this.people.refreshHere();
			this.watchHere();
		}, HERE_EVERY_MS);
	}

	showing() {
		return this.elem.isConnected && this.elem.offsetParent !== null;
	}
}
