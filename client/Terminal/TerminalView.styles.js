import { Elem, styled } from '@vanilla-bean/components';

import { Bar, CRAMPED } from '../Bar';

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

	/* What Claude asks, as buttons over the bottom of the terminal: on a phone, where its dialog is hard to work */
	.asking-overlay {
		position: absolute;
		left: 8px;
		right: 8px;
		bottom: 8px;
		z-index: 2;
		max-height: 70%;
		overflow: auto;
		display: none;
	}

	@media ${({ media }) => `${media.touch}, ${media.phone}`} {
		.asking-overlay.shown {
			display: flex;
		}
	}

	/* A usage limit stopped the turn: shown on any screen, since Claude's own says nothing of carrying on; at the top,
	   clear of the prompt box */
	.limit-overlay {
		position: absolute;
		left: 8px;
		right: 8px;
		top: 8px;
		z-index: 2;
		max-width: 480px;
		margin-left: auto;
		display: none;

		&.shown {
			display: flex;
		}
	}

	/* The catch-up tour keeps left, clear of the side panel it opens */
	.limit-overlay.tour {
		margin-left: 0;
		margin-right: auto;
	}

	/* Above the phone's key bar */
	@media ${({ media }) => media.touch} {
		.asking-overlay,
		.limit-overlay {
			bottom: 60px;
		}
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
		border: 1px solid ${({ colors }) => colors.alpha(colors.light(colors.blue), 0.6)};
		border-radius: ${({ radius }) => radius.sm};
		background: ${({ colors }) => colors.alpha(colors.blue, 0.25)};
		color: ${({ colors }) => colors.lightest(colors.blue)};
		font-family: inherit;
		white-space: nowrap;
		cursor: pointer;
		pointer-events: auto;
	}

	.fork-here.compact .words {
		display: none;
	}

	.fork-here:hover {
		background: ${({ colors }) => colors.alpha(colors.blue, 0.45)};
	}

	/* Floats over the terminal rather than taking a column, so opening it never changes the session's size */
	.notes,
	.git,
	.shares,
	.activity,
	.tasks,
	.links,
	.files,
	.shell {
		position: absolute;
		top: 8px;
		bottom: 8px;
		z-index: 2;
		box-sizing: border-box;
		border-radius: ${({ radius }) => radius.lg};
		border: 1px solid ${({ colors }) => colors.border};
		background: ${({ colors }) => colors.alpha(colors.black, 0.04)};
		backdrop-filter: blur(18px) saturate(160%);
		-webkit-backdrop-filter: blur(18px) saturate(160%);
		box-shadow: 0 8px 32px ${({ colors }) => colors.alpha(colors.vantablack, 0.45)};
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
	.links.open,
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
	.tasks,
	.links {
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
	.tasks .resize,
	.links .resize {
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
		background: ${({ colors }) => colors.alpha(colors.white, 0.15)};
	}

	.resizing {
		transition: none;
	}

	@media ${NARROW} {
		.notes,
		.git,
		.shares,
		.activity,
		.tasks,
		.links {
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
			background: ${({ colors }) => colors.alpha(colors.black, 0.96)};
		}
	}
`;

export const TopBar = styled(
	Bar,
	({ colors }) => `
		/* The session's own color, in kitty-bg's tints */
		.tinted & {
			border-bottom: 2px solid var(--session-accent);
		}

		.title {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			min-width: 0;
			overflow: hidden;
			font-weight: bold;
			white-space: nowrap;
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
			background: ${colors.light(colors.warning)};
			box-shadow: 0 0 0 3px ${colors.alpha(colors.light(colors.warning), 0.3)};
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
				align-items: center;
				justify-content: center;
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


		/* The meter's count beside its gauge; a cache gone cold reads amber */
		.meter .meter-text {
			font-size: 0.8em;
			white-space: nowrap;
		}

		.meter.cold {
			color: ${colors.light(colors.warning)};
		}

		/* A short-lived session says so, a press from being kept */
		.tool.lifetime.brief {
			color: ${colors.light(colors.warning)};
		}

		/* The lever names what it switches, and what it was before the last switch while that can be put back */
		.lifetime .lifetime-text {
			font-size: 0.8em;
			white-space: nowrap;
		}

		.lifetime .lifetime-was {
			margin-left: 4px;
			font-size: 0.7em;
			opacity: 0.5;
			white-space: nowrap;
		}

		.divider {
			width: 1px;
			height: 20px;
			margin: 0 4px;
			background: ${colors.alpha(colors.white, 0.1)};
		}

		/* A phone keeps the session's name: the divider gives way */
		@media ${CRAMPED} {
			.divider {
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
	({ colors, radius }) => `
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
			border-radius: ${radius.lg};
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
		@media ${CRAMPED} {
			.who {
				display: none;
			}
		}
	`,
);

// Back's menu when sessions are waiting: back where you came from, or straight to one of them
