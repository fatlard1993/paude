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
	`,
);

export default GameFrame;
