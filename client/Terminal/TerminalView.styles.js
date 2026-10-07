import { Elem, styled } from '@vanilla-bean/components';

import { Header } from '../Layout';

// Below this the side panels cover the whole terminal
export const NARROW = '(max-width: 800px)';

export const Body = styled.Component`
	flex: 1;
	min-height: 0;
	display: flex;
	position: relative;

	.terminal-column {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	/* Over the terminal, holding only the buttons beside Claude's done lines */
	.fork-layer {
		position: absolute;
		inset: 0;
		z-index: 1;
		overflow: hidden;
		pointer-events: none;
	}

	/* A button, not a link in the text: plain to see, and only pressed on purpose */
	.fork-here {
		position: absolute;
		display: flex;
		align-items: center;
		gap: 5px;
		box-sizing: border-box;
		padding: 0 7px;
		border: 1px solid hsl(210, 60%, 60%, 0.6);
		border-radius: 4px;
		background: hsl(210, 60%, 45%, 0.25);
		color: hsl(210, 80%, 85%);
		font-family: inherit;
		white-space: nowrap;
		cursor: pointer;
		pointer-events: auto;
	}

	.fork-here:hover {
		background: hsl(210, 60%, 45%, 0.45);
	}

	/* Floats over the terminal rather than taking a column, so opening it never changes the session's size */
	.notes,
	.git,
	.shares,
	.activity,
	.tasks,
	.files,
	.shell {
		position: absolute;
		top: 8px;
		bottom: 8px;
		z-index: 2;
		box-sizing: border-box;
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(24, 24, 27, 0.04);
		backdrop-filter: blur(18px) saturate(160%);
		-webkit-backdrop-filter: blur(18px) saturate(160%);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
		overflow: hidden;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 0.15s ease,
			transform 0.15s ease;
	}

	.notes.open,
	.git.open,
	.shares.open,
	.activity.open,
	.tasks.open,
	.files.open,
	.shell.open {
		opacity: 1;
		transform: none;
		pointer-events: auto;
	}

	.notes,
	.git,
	.shares,
	.activity,
	.tasks {
		right: 8px;
		width: min(var(--notes-width, 360px), calc(100% - 16px));
		transform: translateX(12px);
	}

	.files {
		left: 8px;
		width: min(var(--files-width, 62%), calc(100% - 16px));
		transform: translateX(-12px);
	}

	.shell {
		top: auto;
		left: 8px;
		right: 8px;
		height: min(var(--shell-height, 42%), calc(100% - 16px));
		transform: translateY(12px);
	}

	.files.fullscreen {
		inset: 8px;
		width: auto;
	}

	.resize {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: ew-resize;
		z-index: 3;
	}

	.notes .resize,
	.git .resize,
	.shares .resize,
	.activity .resize,
	.tasks .resize {
		left: 0;
	}

	.files .resize {
		right: 0;
	}

	.shell .resize {
		top: 0;
		bottom: auto;
		left: 0;
		right: 0;
		width: auto;
		height: 6px;
		cursor: ns-resize;
	}

	.files.fullscreen .resize {
		display: none;
	}

	.resize:hover,
	.resizing .resize {
		background: rgba(255, 255, 255, 0.15);
	}

	.resizing {
		transition: none;
	}

	@media ${NARROW} {
		.notes,
		.git,
		.shares,
		.activity,
		.tasks {
			inset: 0;
			width: auto;
			border-radius: 0;
			border: none;
		}

		.resize {
			display: none;
		}

		.files,
		.shell {
			inset: 0;
			width: auto;
			height: auto;
			border-radius: 0;
			border: none;
		}

		/* Full screen over Claude's own key bar, which would show through the glass */
		.shell {
			background: rgba(24, 24, 27, 0.96);
		}
	}
`;

export const TopBar = styled(
	Header,
	({ colors }) => `
		max-width: none;
		gap: 4px;
		padding: 6px 10px;
		background: rgba(24, 24, 27, 0.55);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid rgba(255, 255, 255, 0.07);

		.title {
			display: flex;
			align-items: center;
			gap: 8px;
			font-size: 1em;
			min-width: 0;
		}

		.crumb {
			color: ${colors.gray};
			font-weight: normal;
			cursor: pointer;
			flex-shrink: 0;
		}

		.crumb:hover {
			color: ${colors.white};
		}

		.name {
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.state {
			width: 8px;
			height: 8px;
			flex-shrink: 0;
			border-radius: 50%;
			background: ${colors.alpha(colors.white, 0.25)};
		}

		.state.busy {
			background: ${colors.light(colors.orange)};
			animation: paude-pulse 1.2s ease-in-out infinite;
		}

		.state.waiting {
			background: hsl(38, 70%, 60%);
			box-shadow: 0 0 0 3px hsla(38, 70%, 60%, 0.3);
			animation: none;
		}

		.state.offline {
			background: ${colors.red};
		}

		@keyframes paude-pulse {
			50% {
				opacity: 0.35;
			}
		}

		.ghost {
			position: relative;
			flex-shrink: 0;
			min-width: 32px;
			height: 32px;
			padding: 0 8px;
			border: none;
			border-radius: 6px;
			background: transparent;
			color: ${colors.alpha(colors.white, 0.7)};
			font: inherit;
			cursor: pointer;
		}

		.ghost:hover {
			background: ${colors.alpha(colors.white, 0.08)};
			color: ${colors.white};
		}

		.ghost.active {
			background: ${colors.alpha(colors.blue, 0.25)};
			color: ${colors.lighter(colors.blue)};
		}

		.ghost.danger:hover {
			color: ${colors.light(colors.red)};
		}

		/* On a phone the tool buttons fold into one menu */
		.ghost.tools {
			display: none;
		}

		@media ${NARROW} {
			.ghost.tool {
				display: none;
			}

			.ghost.tools {
				display: inline-flex;
			}
		}

		/* A task is running */
		.ghost.busy i {
			color: ${colors.light(colors.yellow)};
			animation: paude-busy 1.2s ease-in-out infinite;
		}

		@keyframes paude-busy {
			50% {
				opacity: 0.4;
			}
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

		.divider {
			width: 1px;
			height: 20px;
			margin: 0 4px;
			background: rgba(255, 255, 255, 0.1);
		}

		/* A phone keeps the session's name: the project gives way */
		@media (max-width: 600px) {
			.crumb, .divider {
				display: none;
			}
		}
	`,
);

export const SelectHint = styled(
	Elem,
	({ colors }) => `
		position: absolute;
		left: 50%;
		top: 12px;
		transform: translateX(-50%);
		z-index: 1;
		padding: 6px 12px;
		border-radius: 14px;
		background: ${colors.alpha(colors.black, 0.75)};
		color: ${colors.light(colors.orange)};
		pointer-events: none;
	`,
);

export const SelectionActions = styled.Component`
	position: absolute;
	z-index: 1;
	display: flex;
	gap: 6px;
`;

export const Presence = styled(
	Elem,
	({ colors }) => `
		display: flex;
		gap: 6px;
		flex-shrink: 0;
		font-size: 0.8em;
		overflow: hidden;

		align-items: center;

		.who {
			display: flex;
			align-items: center;
			gap: 5px;
			padding: 2px 8px;
			border-radius: 10px;
			background: ${colors.alpha(colors.white, 0.06)};
			color: ${colors.alpha(colors.white, 0.75)};
			white-space: nowrap;
		}

		.who i {
			font-size: 0.85em;
			opacity: 0.6;
		}

		.who.sizer {
			box-shadow: inset 0 0 0 1px ${colors.alpha(colors.orange, 0.6)};
		}

		.status {
			color: ${colors.light(colors.orange)};
		}

		/* The people stay a tap away in the panel */
		@media (max-width: 600px) {
			.who {
				display: none;
			}
		}
	`,
);

// Back's menu when sessions are waiting: back where you came from, or straight to one of them
export const BackMenu = styled(
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
