import { Component, styled } from '@vanilla-bean/components';

const LAYER = 'rgba(16, 16, 19, 0.5)';

const Panel = styled(
	Component,
	({ colors }) => `
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: 6px;
		padding: 6px 8px 8px;
		box-sizing: border-box;

		.bar {
			display: flex;
			gap: 6px;
			align-items: center;
			padding: 4px 6px;
			border-radius: 6px;
			background: ${LAYER};
		}

		.label {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: ${colors.light(colors.gray)};
		}

		.label i {
			margin-right: 6px;
			color: ${colors.light(colors.orange)};
		}

		button {
			display: inline-flex;
			gap: 6px;
			align-items: center;
			padding: 4px 10px;
			border: none;
			border-radius: 4px;
			background: ${colors.alpha(colors.white, 0.08)};
			color: ${colors.white};
			font: inherit;
			cursor: pointer;
		}

		button:hover:not(:disabled) {
			background: ${colors.alpha(colors.white, 0.15)};
		}

		button:disabled {
			opacity: 0.4;
			cursor: default;
		}

		button.icon-only {
			padding: 4px 8px;
		}

		.screen {
			position: relative;
			flex: 1;
			min-height: 0;
			padding: 4px;
			border-radius: 6px;
			background: rgba(10, 10, 12, 0.72);
			overflow: hidden;
		}

		.screen .xterm {
			height: 100%;
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
			padding: 4px 10px;
			border-radius: 4px;
			background: ${colors.alpha(colors.black, 0.75)};
			color: ${colors.white};
			pointer-events: none;
		}
	`,
);

export default Panel;
