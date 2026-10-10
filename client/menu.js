import { Elem, styled } from '@vanilla-bean/components';

import { button, element } from './dom';

const MenuBox = styled(
	Elem,
	({ colors }) => `
		position: fixed;
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 240px;
		max-width: min(360px, calc(100vw - 16px));
		padding: 4px;
		border-radius: 8px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(24, 24, 27, 0.92);
		backdrop-filter: blur(18px);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);

		button {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 2px;
			padding: 6px 10px;
			border: none;
			border-radius: 6px;
			background: transparent;
			color: inherit;
			font: inherit;
			text-align: left;
			cursor: pointer;
		}

		button:hover, button:focus-visible {
			background: ${colors.alpha(colors.white, 0.08)};
		}

		.detail {
			color: ${colors.light(colors.gray)};
			font-size: 0.8em;
			white-space: normal;
		}

		.heading {
			margin: 6px 10px 2px;
			color: hsl(29, 70%, 65%);
			font-size: 0.75em;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}
	`,
);

let open = null;

export const closeMenu = () => {
	open?.stop();
	open?.box.elem.remove();
	open = null;
};

// A menu under a button: items ({ label, detail, accent, onPress }) and headings ({ heading }). One at a time; pressing
// its button again, Esc, or a press elsewhere closes it.
export const openMenu = (anchor, items) => {
	const again = open?.anchor === anchor;

	closeMenu();
	if (again) return;

	const box = new MenuBox({ appendTo: document.body });
	const at = anchor.getBoundingClientRect();

	for (const item of items) {
		if (item.heading) {
			box.elem.append(element('div', 'heading', item.heading));
			continue;
		}

		const row = button('', () => {
			closeMenu();
			item.onPress();
		});

		row.append(element('span', 'label', item.label), ...(item.detail ? [element('span', 'detail', item.detail)] : []));
		if (item.accent) row.style.boxShadow = `inset 3px 0 ${item.accent}`;
		box.elem.append(row);
	}

	// Kept on the screen: under the button, moved left as far as it needs
	Object.assign(box.elem.style, { left: `${at.left}px`, top: `${at.bottom + 4}px` });
	box.elem.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - box.elem.offsetWidth - 8))}px`;

	const outside = event => {
		if (!box.elem.contains(event.target) && !anchor.contains(event.target)) closeMenu();
	};
	const escape = event => event.key === 'Escape' && closeMenu();

	document.addEventListener('pointerdown', outside, true);
	document.addEventListener('keydown', escape);
	open = {
		anchor,
		box,
		stop: () => {
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('keydown', escape);
		},
	};
};
