import ArcadeGame from '../Arcade/ArcadeGame';
import { closeButton, element } from '../dom';
import Panel from './GitPanel.styles';

// What the session makes, live, on its own page: the page it serves in a frame, or else what Claude changed (the
// arcade's Output). Its frame is made the first time it's opened, so a session nobody looks at this way isn't polled.
// `keepRunning`: start the project's dev server again by itself when it's down, as an arcade does; otherwise a button.
export default class OutputPanel extends Panel {
	build() {
		this.bar = element('div', 'bar');
		this.body = element('div', 'body output-body');
		this.bar.append(
			element('span', 'branch', 'Output'),
			element('span', 'spacer'),
			closeButton(() => this.options.close()),
		);
		this.elem.tabIndex = -1;
		this.elem.append(this.bar, this.body);
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;

			event.stopPropagation();
			this.options.close();
		});
	}

	refresh() {
		this.output ??= new ArcadeGame({
			sessionId: this.options.sessionId,
			keepRunning: this.options.keepRunning?.() ?? false,
			appendTo: this.body,
		});
	}
}
