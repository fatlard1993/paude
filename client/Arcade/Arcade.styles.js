import { Elem, styled } from '@vanilla-bean/components';

// The arcade page: the game large, the talk with Claude beside it; on a phone one over the other
const ArcadePage = styled(
	Elem,
	({ colors, media, radius, space }) => `
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;

		.stage {
			display: flex;
			flex: 1;
			min-height: 0;
		}

		.stage > .arcade-game {
			flex: 1 1 60%;
		}

		.stage > .arcade-talk {
			position: relative;
			flex: 0 0 var(--arcade-talk-width, min(40%, 560px));
			min-width: min(260px, 100%);
			border-left: 1px solid ${colors.border};
		}

		/* Dragged wider or narrower from its inner edge (addResizeHandle) */
		.stage > .arcade-talk .resize {
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			width: 6px;
			cursor: ew-resize;
			z-index: 3;
		}

		/* Playing: the game alone, and one big button back to the talk */
		&.playing .stage > .arcade-talk {
			display: none;
		}

		/* The big button lives in the bar, clear of the game, and shows while the game has the whole screen */
		.change-button {
			display: none;
			margin-inline: ${space.md};
			padding: ${space.xs} ${space.lg};
			border-radius: ${radius.pill};
			background: ${colors.orange};
			color: ${colors.white};
			font-size: 1.1rem;
			font-weight: bold;
			white-space: nowrap;
			box-shadow: 0 2px 10px ${colors.alpha(colors.black, 0.45)};
		}

		.change-button i {
			margin-right: ${space.sm};
		}

		&.playing .change-button {
			display: inline-flex;
			align-items: center;
		}

		@media ${media.phone}, (max-width: 820px) {
			.stage {
				flex-direction: column;
			}

			.stage > .arcade-game {
				flex: 0 0 42vh;
			}

			.stage > .arcade-talk {
				flex: 1 1 40%;
				width: auto;
				max-width: none;
				min-width: 0;
				border-left: 0;
				border-top: 1px solid ${colors.border};
			}
			.stage > .arcade-talk .resize {
				display: none;
			}
		}
	`,
);

export default ArcadePage;
