import { styled } from '@vanilla-bean/components';

import { button } from './dom';
import { Header } from './Layout';

// Every page's top bar: where you are on the left, its tools on the right as quiet icons. A page with a color of its
// own (a project's, a session's) underlines the bar with it.
export const Bar = styled(
	Header,
	({ colors }) => `
		max-width: none;
		gap: 4px;
		padding: 6px 10px;
		background: rgba(24, 24, 27, 0.55);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid rgba(255, 255, 255, 0.07);

		&.accented {
			border-bottom: 2px solid var(--bar-accent);
		}

		.ghost {
			flex-shrink: 0;
			min-width: 32px;
			height: 32px;
			padding: 0 8px;
			border-radius: 6px;
			color: ${colors.alpha(colors.white, 0.7)};
			font: inherit;
		}

		.ghost:hover {
			color: ${colors.white};
		}

		.ghost.active {
			background: ${colors.alpha(colors.blue, 0.25)};
			color: ${colors.lighter(colors.blue)};
		}

		.ghost.danger:hover {
			color: ${colors.light(colors.red)};
		}

		.ghost .count {
			position: absolute;
			top: 1px;
			right: 0;
			min-width: 14px;
			padding: 0 3px;
			border-radius: 7px;
			background: ${colors.orange};
			color: ${colors.white};
			font-size: 10px;
			line-height: 14px;
		}
	`,
);

export const ghostButton = (appendTo, { icon, label, title, onPress, className = '' }) => {
	const node = button(label, onPress, { icon, title: title ?? '', className: `ghost variant-flat ${className}` });

	appendTo.elem.append(node);

	return node;
};
