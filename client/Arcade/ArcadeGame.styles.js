import { Component, styled } from '@vanilla-bean/components';

// The game a session builds, live in a frame, or the room where it's waited for
const GameFrame = styled(
	Component,
	({ colors, radius, space }) => `
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
			box-shadow: 0 4px 16px ${colors.alpha(colors.vantablack, 0.45)};
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

		/* Over the game while it's built: three blocks stacking and falling again, then breathing while it settles */
		.curtain {
			position: absolute;
			inset: 0;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: ${space.lg};
			background: radial-gradient(circle at 50% 40%, ${colors.alpha(colors.blue, 0.25)}, ${colors.alpha(colors.black, 0.92)} 70%);
			backdrop-filter: blur(6px);
			color: ${colors.white};
			animation: curtain-in 300ms ease-out;
		}

		.curtain.lifting {
			opacity: 0;
			transition: opacity 300ms ease-in;
			pointer-events: none;
		}

		.curtain .words {
			font-size: 1.5rem;
			font-weight: bold;
			letter-spacing: 0.02em;
		}

		.curtain .blocks {
			display: flex;
			flex-direction: column-reverse;
			align-items: center;
			height: 7.5rem;
		}

		.curtain .block {
			width: 3.5rem;
			height: 2.25rem;
			margin-top: 0.25rem;
			border-radius: ${radius.sm};
			box-shadow: inset 0 -0.3rem ${colors.alpha(colors.black, 0.25)};
			opacity: 0;
			animation: block-stack 2.4s ease-in infinite;
		}

		.curtain .block:nth-child(1) { background: ${colors.orange}; animation-delay: 0s; }
		.curtain .block:nth-child(2) { background: ${colors.teal}; animation-delay: 0.4s; width: 2.75rem; }
		.curtain .block:nth-child(3) { background: ${colors.purple}; animation-delay: 0.8s; width: 2rem; }

		.curtain.settling .block {
			opacity: 1;
			animation: block-breathe 1.2s ease-in-out infinite alternate;
		}

		.curtain.settling .block:nth-child(2) { animation-delay: 0.15s; }
		.curtain.settling .block:nth-child(3) { animation-delay: 0.3s; }

		@keyframes block-stack {
			0% { opacity: 0; transform: translateY(-6rem); }
			12% { opacity: 1; transform: translateY(0); }
			16% { transform: translateY(0) scaleY(0.85); }
			20% { transform: translateY(0) scaleY(1); }
			85% { opacity: 1; transform: translateY(0); }
			100% { opacity: 0; transform: translateY(0.5rem); }
		}

		@keyframes block-breathe {
			from { transform: scale(1); filter: brightness(1); }
			to { transform: scale(1.08); filter: brightness(1.3); }
		}

		@keyframes curtain-in {
			from { opacity: 0; }
			to { opacity: 1; }
		}

		@media (prefers-reduced-motion: reduce) {
			.curtain .block,
			.curtain.settling .block {
				opacity: 1;
				animation: none;
			}
		}
	`,
);

export default GameFrame;
