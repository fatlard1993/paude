import { Component, styled } from '@vanilla-bean/components';

import { icon } from '../dom';

// The keys a phone keyboard lacks but Claude Code leans on. Arrows and Enter are icons: a phone draws ⏎ and ↑ from
// whatever font has them, at its own size and height.
const KEYS = [
	{ label: 'Esc', sequence: '\x1b' },
	{ label: 'Tab', sequence: '\t' },
	{ label: 'Shift Tab', sequence: '\x1b[Z' },
	{ label: '^C', sequence: '\x03', title: 'Ctrl+C' },
	{ icon: 'arrow-up', sequence: '\x1b[A', title: 'Up' },
	{ icon: 'arrow-down', sequence: '\x1b[B', title: 'Down' },
	{ icon: 'arrow-left', sequence: '\x1b[D', title: 'Left' },
	{ icon: 'arrow-right', sequence: '\x1b[C', title: 'Right' },
	{ label: '/', sequence: '/' },
	{ icon: 'arrow-turn-down fa-rotate-90', sequence: '\r', title: 'Enter' },
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
			display: inline-flex;
			align-items: center;
			justify-content: center;
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
// Canceling pointerdown keeps focus, and the phone keyboard, on the terminal.
const keyButton = ({ label, icon: name, title }, press) => {
	const button = document.createElement('button');

	if (name) button.append(icon(name));
	else button.textContent = label;
	if (title) button.setAttribute('aria-label', title);
	button.title = title ?? '';
	button.addEventListener('pointerdown', event => event.preventDefault());
	button.addEventListener('click', press);

	return button;
};

export default class KeyBar extends Bar {
	build() {
		const select = keyButton({ label: 'Select' }, () => this.options.selectLines());

		select.title = this.options.selectTitle ?? 'Comment on lines: tap the first, then the last';
		this.elem.append(select);

		// Someone who may comment but not type gets Select alone
		if (!this.options.sendKey) return;

		for (const key of KEYS) this.elem.append(keyButton(key, () => this.options.sendKey(key.sequence)));
	}
}
