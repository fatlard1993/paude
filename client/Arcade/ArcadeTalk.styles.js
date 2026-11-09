import { Component, styled } from '@vanilla-bean/components';

// The talk with Claude as the arcade has it: big type, scaled by --arcade-scale (the size option), the status with its
// controls in one row, the feed, the choices, and the box with the ear. The same column on the arcade page and in the
// universe's dock.
const Talk = styled(
	Component,
	({ colors, radius, safeArea, space }) => `
		--arcade-scale: 1;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		min-width: 0;
		font-size: calc(1.15rem * var(--arcade-scale));
		line-height: 1.45;

		.lamp {
			display: flex;
			align-items: center;
			gap: ${space.sm};
			padding: ${space.sm} ${space.md};
			border-bottom: 1px solid ${colors.border};
			font-weight: bold;
		}

		.lamp > i {
			width: 1.4em;
			text-align: center;
		}

		.lamp .words {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.lamp .put-back,
		.lamp .control {
			flex-shrink: 0;
			font-size: 0.8em;
			color: ${colors.alpha(colors.white, 0.75)};
		}

		.lamp .control {
			min-width: 2em;
			padding: ${space.xs} ${space.sm};
		}

		.lamp.working > i {
			color: ${colors.light(colors.blue)};
		}

		.lamp.waiting {
			color: ${colors.light(colors.orange)};
			animation: arcade-pulse 1.4s ease-in-out infinite;
		}

		.lamp.ready > i {
			color: ${colors.light(colors.green)};
		}

		.lamp.stopped > i {
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

		/* Waiting for its voice: the words dim and settle in, a sound wave where the speaker button sits, until the voice
		   starts and they light as they're said */
		.card .wave {
			display: none;
			float: right;
			gap: 3px;
			align-items: center;
			height: 1.2em;
			margin: 0 0 0 ${space.sm};
		}

		.card .wave i {
			width: 4px;
			height: 100%;
			border-radius: 2px;
			background: ${colors.light(colors.blue)};
			animation: voice-wave 0.9s ease-in-out infinite;
		}

		.card .wave i:nth-child(2) { animation-delay: 0.15s; }
		.card .wave i:nth-child(3) { animation-delay: 0.3s; }
		.card .wave i:nth-child(4) { animation-delay: 0.45s; }

		.card.voicing .wave {
			display: inline-flex;
		}

		.card.voicing .say {
			display: none;
		}

		.card.voicing p {
			opacity: 0.45;
			filter: blur(0.6px);
		}

		.card p {
			transition: opacity 250ms ease-out, filter 250ms ease-out;
		}

		@keyframes voice-wave {
			0%, 100% { transform: scaleY(0.3); }
			50% { transform: scaleY(1); }
		}

		@media (prefers-reduced-motion: reduce) {
			.card .wave i { animation: none; transform: scaleY(0.6); }
		}

		.card.you {
			align-self: flex-end;
			max-width: 85%;
			background: ${colors.alpha(colors.blue, 0.25)};
		}

		.card.notice {
			align-self: center;
			max-width: 90%;
			padding: ${space.sm} ${space.md};
			background: ${colors.alpha(colors.white, 0.08)};
			color: ${colors.alpha(colors.white, 0.8)};
			font-size: 0.85em;
			text-align: center;
		}

		.card.notice.warning {
			box-shadow: inset 0 0 0 1px ${colors.alpha(colors.orange, 0.6)};
		}

		.card.notice.danger {
			box-shadow: inset 0 0 0 1px ${colors.alpha(colors.red, 0.6)};
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
			border-radius: ${radius.sm};
		}

		.card .emoji.lit {
			background: ${colors.alpha(colors.orange, 0.6)};
		}

		/* A performance cue (a laugh, a whisper, an explosion): a stage direction, quieter than the words, lit as it plays */
		.card .cue {
			font-size: 0.7em;
			font-style: italic;
			letter-spacing: 0.02em;
			color: ${colors.alpha(colors.white, 0.6)};
			border-radius: ${radius.pill};
			padding: 0.1em 0.55em;
			background: ${colors.alpha(colors.purple, 0.25)};
			vertical-align: 0.15em;
			white-space: nowrap;
		}

		.card .cue.lit {
			color: ${colors.white};
			background: ${colors.alpha(colors.purple, 0.7)};
		}

		.card .say {
			float: right;
			margin: -${space.xs} -${space.xs} 0 ${space.sm};
			min-width: 2.2em;
			height: 2.2em;
		}

		.card.chosen .pick-again {
			margin-left: ${space.md};
			font-size: 0.8em;
			color: ${colors.alpha(colors.white, 0.75)};
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
			border-radius: ${radius.sm};
			padding: 0 ${space.xs};
		}

		.choices .question.lit,
		.choices button.choice.lit {
			background: ${colors.alpha(colors.orange, 0.45)};
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

		.choices .owner-waiting {
			color: ${colors.alpha(colors.white, 0.7)};
		}

		/* A choice opened to confirm: the headline, what it would do, yes in green and no in red */
		.choices .confirm {
			display: flex;
			flex-direction: column;
			gap: ${space.md};
		}

		.choices .confirm .headline {
			font-size: 1.3em;
			font-weight: bold;
			border-radius: ${radius.sm};
			padding: 0 ${space.xs};
		}

		.choices .confirm .headline .emoji {
			font-size: 1.6em;
			line-height: 1;
		}

		.choices .confirm .detail {
			border-radius: ${radius.sm};
			padding: 0 ${space.xs};
		}

		.choices .confirm .headline.lit,
		.choices .confirm .detail.lit {
			background: ${colors.alpha(colors.orange, 0.45)};
		}

		.choices .yes-no {
			display: flex;
			gap: ${space.md};
		}

		.choices .yes-no button {
			flex: 1;
			justify-content: center;
			min-height: 4em;
			font-size: 1.15em;
		}

		.choices button.yes {
			background: ${colors.alpha(colors.green, 0.55)};
		}

		.choices button.no {
			background: ${colors.alpha(colors.red, 0.5)};
		}

		.choices button.yes.lit {
			background: ${colors.green};
		}

		.choices button.no.lit {
			background: ${colors.red};
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

		/* Docked beside the universe: no bottom gutter of its own, the dock has one */
		&.docked .composer {
			padding-bottom: ${space.sm};
		}
	`,
);

export default Talk;
