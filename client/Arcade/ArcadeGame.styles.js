import { Component, styled } from '@vanilla-bean/components';

// The game a session builds, live in a frame, or the room where it's waited for
const GameFrame = styled(
	Component,
	({ colors, space }) => `
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		min-height: 0;
		min-width: 0;
		background: ${colors.alpha(colors.black, 0.4)};

		iframe {
			width: 100%;
			height: 100%;
			border: 0;
			background: ${colors.black};
		}

		.new-version {
			position: absolute;
			top: ${space.md};
			left: 50%;
			transform: translateX(-50%);
			z-index: 2;
			/* Its own surface: it sits over whatever the game draws, light or dark */
			background: ${colors.surface};
			color: ${colors.white};
			border: 1px solid ${colors.edge};
			box-shadow: 0 4px 16px ${colors.alpha(colors.vantablack, 0.45)};

			&:hover,
			&:focus-visible {
				background: ${colors.light(colors.surface)};
			}
		}

		.waiting-room {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: ${space.md};
			padding: ${space.xl};
			text-align: center;
			color: ${colors.alpha(colors.white, 0.75)};
		}

		.waiting-room i {
			font-size: 3em;
			color: ${colors.light(colors.blue)};
		}

		/* What Claude changed, as the session's output: the Files panel, filling the space, without the buttons that
		   would close or enlarge a docked panel */
		.arcade-changes {
			position: absolute;
			inset: 0;
		}

		.arcade-changes button.close,
		.arcade-changes button[title='Full screen'] {
			display: none;
		}

		.arcade-changes .list:empty::before {
			content: 'Nothing changed yet. What Claude changes shows here, each a tap from its diff.';
			display: block;
			padding: ${space.lg};
			opacity: 0.6;
		}
	`,
);

export default GameFrame;
