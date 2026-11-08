import { Elem, styled } from '@vanilla-bean/components';

// The arcade: the game large, the talk with Claude beside it in big type, every control a thumb's size. Sized by
// --arcade-scale (the size option) and read in the page's own dark.
const ArcadePage = styled(
	Elem,
	({ colors, media, radius, safeArea, space }) => `
		--arcade-scale: 1;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		font-size: calc(1.15rem * var(--arcade-scale));
		line-height: 1.45;

		.stage {
			display: flex;
			flex: 1;
			min-height: 0;
		}

		.game {
			position: relative;
			flex: 1 1 60%;
			min-width: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			background: ${colors.alpha(colors.black, 0.4)};
		}

		.game iframe {
			width: 100%;
			height: 100%;
			border: 0;
			background: ${colors.black};
		}

		.game .waiting-room {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: ${space.md};
			padding: ${space.xl};
			text-align: center;
			color: ${colors.alpha(colors.white, 0.75)};
		}

		.game .waiting-room i {
			font-size: 3em;
			color: ${colors.light(colors.blue)};
		}

		.talk {
			display: flex;
			flex-direction: column;
			flex: 1 1 40%;
			min-width: min(360px, 100%);
			max-width: 560px;
			min-height: 0;
			border-left: 1px solid ${colors.border};
		}

		.lamp {
			display: flex;
			align-items: center;
			gap: ${space.sm};
			padding: ${space.sm} ${space.md};
			border-bottom: 1px solid ${colors.border};
			font-weight: bold;
		}

		.lamp i {
			width: 1.4em;
			text-align: center;
		}

		.lamp .words {
			flex: 1;
			min-width: 0;
		}

		.lamp .put-back {
			flex-shrink: 0;
			font-size: 0.8em;
			color: ${colors.alpha(colors.white, 0.75)};
		}

		.lamp.working i {
			color: ${colors.light(colors.blue)};
		}

		.lamp.waiting {
			color: ${colors.light(colors.orange)};
			animation: arcade-pulse 1.4s ease-in-out infinite;
		}

		.lamp.ready i {
			color: ${colors.light(colors.green)};
		}

		.lamp.stopped i {
			color: ${colors.muted};
		}

		@keyframes arcade-pulse {
			50% {
				opacity: 0.55;
			}
		}

		.feed {
			flex: 1;
			min-height: 0;
			overflow: auto;
			display: flex;
			flex-direction: column;
			gap: ${space.md};
			padding: ${space.md};
			scroll-behavior: smooth;
		}

		.card {
			padding: ${space.md};
			border-radius: ${radius.lg};
			background: ${colors.alpha(colors.white, 0.06)};
		}

		.card.claude {
			box-shadow: inset 3px 0 ${colors.alpha(colors.blue, 0.8)};
		}

		.card.you {
			align-self: flex-end;
			max-width: 85%;
			background: ${colors.alpha(colors.blue, 0.25)};
		}

		.card p {
			margin: 0;
		}

		.card p + p {
			margin-top: ${space.sm};
		}

		.card .word {
			border-radius: ${radius.sm};
			padding: 0 2px;
			margin: 0 -2px;
		}

		.card .word.lit {
			background: ${colors.alpha(colors.orange, 0.6)};
		}

		.card .emoji {
			font-size: 1.3em;
			line-height: 1;
		}

		.card .say {
			float: right;
			margin: -${space.xs} -${space.xs} 0 ${space.sm};
			min-width: 2.2em;
			height: 2.2em;
		}

		.did {
			display: flex;
			flex-wrap: wrap;
			gap: ${space.sm} ${space.md};
			padding: 0 ${space.md};
			color: ${colors.alpha(colors.white, 0.6)};
			font-size: 0.8em;
		}

		.did span {
			display: inline-flex;
			align-items: center;
			gap: ${space.xs};
		}

		.choices {
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
			padding: ${space.md};
			border-top: 1px solid ${colors.border};
			background: ${colors.alpha(colors.orange, 0.08)};
		}

		.choices .question {
			font-weight: bold;
		}

		.choices button {
			display: flex;
			align-items: center;
			gap: ${space.md};
			min-height: 3.2em;
			padding: ${space.sm} ${space.md};
			border-radius: ${radius.lg};
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
			font: inherit;
			font-size: 1.05em;
			text-align: left;
			white-space: normal;
		}

		.choices button:hover {
			background: ${colors.alpha(colors.white, 0.18)};
		}

		.choices button .emoji {
			font-size: 1.8em;
			line-height: 1;
		}

		.choices button .label {
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.choices button .detail {
			font-size: 0.75em;
			color: ${colors.alpha(colors.white, 0.65)};
		}

		.choices .grown-up {
			color: ${colors.alpha(colors.white, 0.7)};
		}

		.composer {
			display: flex;
			align-items: center;
			gap: ${space.sm};
			padding: ${space.sm} ${space.md} calc(${space.sm} + ${safeArea.bottom});
			border-top: 1px solid ${colors.border};
		}

		.composer input {
			flex: 1;
			min-width: 0;
			font: inherit;
			padding: ${space.sm} ${space.md};
		}

		.composer .mic,
		.composer .send {
			flex-shrink: 0;
			width: 3em;
			height: 3em;
			border-radius: ${radius.pill};
			font-size: 1.1em;
		}

		.composer .mic {
			background: ${colors.blue};
			color: ${colors.white};
		}

		.composer .mic.hearing {
			background: ${colors.red};
			animation: arcade-pulse 1s ease-in-out infinite;
		}

		.composer .mic.thinking {
			background: ${colors.purple};
			animation: arcade-pulse 0.6s ease-in-out infinite;
		}

		.composer .heard {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: ${colors.alpha(colors.white, 0.75)};
			font-style: italic;
		}

		@media ${media.phone}, (max-width: 820px) {
			.stage {
				flex-direction: column;
			}

			.game {
				flex: 0 0 42vh;
			}

			.talk {
				max-width: none;
				min-width: 0;
				border-left: 0;
				border-top: 1px solid ${colors.border};
			}
		}
	`,
);

export default ArcadePage;
