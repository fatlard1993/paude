import { Component, styled } from '@vanilla-bean/components';

// The keys a phone keyboard lacks but Claude Code leans on
const KEYS = [
	['Esc', '\x1b'],
	['Tab', '\t'],
	['⇧Tab', '\x1b[Z'],
	['^C', '\x03'],
	['↑', '\x1b[A'],
	['↓', '\x1b[B'],
	['←', '\x1b[D'],
	['→', '\x1b[C'],
	['/', '/'],
	['⏎', '\r'],
];

const Bar = styled(
	Component,
	({ colors }) => `
		display: none;
		gap: 4px;
		padding: 4px 8px;
		overflow-x: auto;

		@media (pointer: coarse) {
			display: flex;
		}

		button {
			flex: 1 0 auto;
			min-width: 40px;
			padding: 8px 6px;
			border: none;
			border-radius: 4px;
			background: ${colors.alpha(colors.white, 0.08)};
			color: inherit;
			font: inherit;
		}
	`,
);

// Fires on click, which a swipe along the bar cancels, so scrolling to a key doesn't press the ones it passes.
// Cancelling pointerdown keeps focus, and the phone keyboard, on the terminal.
const keyButton = (label, press) => {
	const button = document.createElement('button');

	button.textContent = label;
	button.addEventListener('pointerdown', event => event.preventDefault());
	button.addEventListener('click', press);

	return button;
};

export default class KeyBar extends Bar {
	build() {
		const select = keyButton('Select', () => this.options.selectLines());

		select.title = 'Comment on lines: tap the first, then the last';
		this.elem.append(select);

		for (const [label, sequence] of KEYS) this.elem.append(keyButton(label, () => this.options.sendKey(sequence)));
	}
}
