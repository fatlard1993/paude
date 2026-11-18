import { closeButton, element } from '../dom';
import Panel from './NotesPanel.styles';
import renderPeople from './People';

// Who is invited into the session, and inviting someone: the owner's alone
export default class PeoplePanel extends Panel {
	build() {
		const who = element('div', 'who');

		this.list = element('div', 'list');
		who.append(
			element('strong', '', 'People'),
			element('span', 'spacer'),
			closeButton(() => this.options.close()),
		);
		who.querySelector('.spacer').style.flex = '1';
		this.elem.tabIndex = -1;
		this.elem.append(who, this.list);
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape' || event.target.matches('input, select')) return;

			event.stopPropagation();
			this.options.close();
		});
	}

	async refresh() {
		this.list.replaceChildren(...(await renderPeople(this.options.sessionId)));
	}
}
