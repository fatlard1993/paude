import { Toolbar, styled } from '@vanilla-bean/components';

import { button } from './dom';

// Below this the bar sheds what it can spare, its labels and who's here: its own content breakpoint, narrower than a
// phone, since at a phone's widest the bar still has room for them
export const CRAMPED = '(max-width: 600px)';

// Every page's top bar: where you are on the left, its tools on the right as quiet icons, over glass the page shows
// through. A page with a color of its own (a project's, a session's) underlines the bar with it.
export class Bar extends styled(
	Toolbar,
	({ colors, radius, safeArea, space }) => `
		&.variant-bar {
			padding-top: calc(${space.sm} + ${safeArea.top});
			padding-inline: calc(${space.md} + ${safeArea.left}) calc(${space.md} + ${safeArea.right});
			background: ${colors.alpha(colors.black, 0.55)};
			backdrop-filter: blur(12px);
			-webkit-backdrop-filter: blur(12px);
		}

		&.accented {
			border-bottom: 2px solid var(--bar-accent);
		}

		.ghost {
			flex-shrink: 0;
			min-width: 32px;
			height: 32px;
			padding: 0 ${space.sm};
		}

		.ghost:where(:not(.active)) {
			color: ${colors.alpha(colors.white, 0.7)};
		}

		.ghost:where(:not(.active)):hover {
			color: ${colors.white};
		}

		.ghost.danger:hover {
			color: ${colors.light(colors.danger)};
		}

		.ghost .count {
			position: absolute;
			top: 1px;
			right: 0;
			min-width: 14px;
			padding: 0 ${space.xs};
			border-radius: ${radius.pill};
			background: ${colors.orange};
			color: ${colors.white};
			font-size: 10px;
			line-height: 14px;
		}
	`,
) {
	static schema = {
		variant: { default: 'bar' },
		gap: { default: 4 },
		wrap: { default: false },
	};
}

export const ghostButton = (appendTo, { icon, label, title, onPress, className = '' }) => {
	const node = button(label, onPress, { icon, title: title ?? '', className: `ghost variant-flat ${className}` });

	appendTo.elem.append(node);

	return node;
};
