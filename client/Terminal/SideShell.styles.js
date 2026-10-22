import { Component, styled } from '@vanilla-bean/components';

// What text sits on over the panel's glass
const layer = colors => colors.alpha(colors.vantablack, 0.5);

const Panel = styled(
	Component,
	({ colors, radius, space }) => `
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: ${space.sm};
		padding: ${space.sm};
		box-sizing: border-box;

		.bar {
			display: flex;
			gap: ${space.sm};
			align-items: center;
			padding: ${space.xs} ${space.sm};
			border-radius: ${radius.md};
			background: ${layer(colors)};
		}

		.label {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: ${colors.muted};
		}

		.label i {
			margin-right: ${space.sm};
			color: ${colors.light(colors.orange)};
		}

		button {
			display: inline-flex;
			gap: ${space.sm};
			align-items: center;
			padding: ${space.xs} ${space.md};
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.white, 0.08)};
			color: ${colors.white};
			font: inherit;
		}

		button:hover:not(:disabled) {
			background: ${colors.alpha(colors.white, 0.15)};
		}

		button:disabled {
			opacity: 0.4;
			cursor: default;
		}

		button.icon-only {
			padding: ${space.xs} ${space.sm};
		}

		.screen {
			position: relative;
			flex: 1;
			min-height: 0;
			padding: ${space.xs};
			border-radius: ${radius.md};
			background: ${colors.alpha(colors.vantablack, 0.55)};
			overflow: hidden;
		}

		.screen .xterm {
			height: 100%;
		}

		/* xterm paints its viewport solid from the theme, alpha dropped */
		.screen .xterm-viewport {
			background-color: transparent !important;
		}

		.screen.selecting {
			outline: 2px solid ${colors.alpha(colors.blue, 0.7)};
			outline-offset: -2px;
		}

		.hint {
			position: absolute;
			top: 8px;
			left: 50%;
			transform: translateX(-50%);
			z-index: 1;
			padding: ${space.xs} ${space.md};
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.black, 0.75)};
			color: ${colors.white};
			pointer-events: none;
		}
	`,
);

export default Panel;
