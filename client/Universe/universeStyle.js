import { Elem, styled } from '@vanilla-bean/components';

// How wide the panel beside a room looked at is, in screen pixels
export const FOCUS_WIDTH = 320;

export const Stage = styled(
	Elem,
	({ colors, space, radius, media }) => `
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		background: #07090f;

		canvas {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			touch-action: none;
			image-rendering: pixelated;
		}

		canvas.dragging {
			cursor: grabbing;
		}

		canvas.pointing {
			cursor: pointer;
		}

		.tip {
			position: absolute;
			z-index: 1;
			max-width: min(320px, calc(100% - 32px));
			padding: ${space.sm} ${space.md};
			background: ${colors.alpha(colors.black, 0.9)};
			--aug-tl1: 6px;
			--aug-br1: 6px;
			--aug-border-all: 2px;
			--aug-border-bg: ${colors.light(colors.teal)};
			pointer-events: none;
			font-size: 0.85em;
		}

		.tip .rows {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: 0 ${space.sm};
			margin: 2px 0;
		}

		.tip .key {
			color: ${colors.light(colors.teal)};
			text-transform: uppercase;
			font-size: 0.85em;
		}

		.tip .about {
			color: ${colors.muted};
		}

		.reply-card {
			position: absolute;
			z-index: 2;
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
			width: min(380px, calc(100% - 32px));
			max-height: min(60%, 520px);
			/* Clear of the cut corners */
			padding: calc(14px + ${space.xs}) calc(14px + ${space.sm});
			border: none;
			border-radius: 0;
			background: ${colors.surface};
			--aug-tl1: 14px;
			--aug-tr1: 14px;
			--aug-tr2: 14px;
			--aug-br1: 14px;
			--aug-bl1: 14px;
			--aug-bl2: 14px;
			--aug-border-all: 2px;
			--aug-border-bg: ${colors.light(colors.teal)};
		}

		.reply-card .head {
			display: flex;
			align-items: flex-start;
			gap: ${space.sm};
		}

		.reply-card .titles {
			flex: 1;
			min-width: 0;
		}

		.reply-card .titles strong {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.reply-card .about {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.reply-card .asked {
			padding-left: ${space.sm};
			border-left: 2px solid ${colors.teal};
			color: ${colors.muted};
			font-size: 0.85em;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.reply-card .reply {
			flex: 1 1 auto;
			min-height: 0;
			overflow: auto;
			overflow-wrap: anywhere;
			font-size: 0.9em;
		}

		.reply-card .reply pre {
			overflow: auto;
		}

		.reply-card .answer {
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
		}

		.reply-card textarea {
			resize: vertical;
			font: inherit;
		}

		/* A folder to add: where it is, its path, whether to watch it, each on its own line */
		.pane .add-folder {
			display: flex;
			flex-direction: column;
			align-items: stretch;
			gap: ${space.sm};
		}

		.pane .add-folder .watch {
			display: flex;
			align-items: center;
			gap: ${space.sm};
		}

		.pane .add-folder button {
			align-self: flex-end;
		}

		/* Where a new prompt goes, or a folder is added */
		.reply-card select.where,
		.pane select.where {
			font: inherit;
			padding: 2px ${space.xs};
			border: 1px solid ${colors.border};
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.black, 0.6)};
			color: inherit;
		}

		.reply-card .actions {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			gap: ${space.sm};
		}

		.docked-terminal {
			position: relative;
			display: flex;
			flex-direction: column;
			gap: ${space.xs};
		}

		/* What can be done with a selection, beside it */
		.docked-terminal .selected {
			position: absolute;
			z-index: 2;
			display: flex;
			gap: ${space.xs};
			padding: 2px;
			border: 1px solid ${colors.border};
			border-radius: ${radius.md};
			background: ${colors.alpha(colors.black, 0.85)};
		}

		/* As on the session's page: the buttons beside Claude's done lines, the hint while lines are picked, and what
		   Claude asks as buttons on a touch screen */
		.docked-terminal .fork-layer {
			position: absolute;
			inset: 0;
			z-index: 1;
			overflow: hidden;
			pointer-events: none;
		}

		.docked-terminal .fork-here {
			position: absolute;
			display: flex;
			align-items: center;
			gap: ${space.sm};
			box-sizing: border-box;
			padding: 0 ${space.sm};
			border: 1px solid ${colors.alpha(colors.light(colors.blue), 0.6)};
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.blue, 0.25)};
			color: ${colors.lightest(colors.blue)};
			font-family: inherit;
			white-space: nowrap;
			cursor: pointer;
			pointer-events: auto;
		}

		.docked-terminal .fork-here.compact .words {
			display: none;
		}

		.docked-terminal .fork-here:hover {
			background: ${colors.alpha(colors.blue, 0.45)};
		}

		.docked-terminal .select-hint {
			position: absolute;
			left: 50%;
			top: 28px;
			transform: translateX(-50%);
			z-index: 2;
			padding: ${space.sm} ${space.md};
			border-radius: ${radius.pill};
			background: ${colors.alpha(colors.black, 0.75)};
			color: ${colors.light(colors.orange)};
			pointer-events: none;
		}

		.docked-terminal .asking-overlay {
			position: absolute;
			left: 8px;
			right: 8px;
			bottom: 60px;
			z-index: 2;
			max-height: 70%;
			overflow: auto;
			display: none;
		}

		@media ${media.touch}, ${media.phone} {
			.docked-terminal .asking-overlay.shown {
				display: flex;
			}
		}

		.docked-terminal .about {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		/* The terminal see-through over a tint dark enough to read it by, the glass showing past its rows; sized to fit,
		   so no scrollbars */
		.docked-terminal .screen.dropping {
			outline: 2px dashed ${colors.light(colors.orange)};
			outline-offset: -2px;
		}

		/* Its own stacking context, so xterm's layers stay under what's laid over the terminal */
		.docked-terminal .screen {
			flex: 1;
			min-height: 0;
			overflow: hidden;
			padding: 2px;
			isolation: isolate;
		}

		.docked-terminal .xterm {
			background: ${colors.alpha(colors.black, 0.5)};
		}

		.docked-terminal .xterm-viewport {
			background-color: transparent !important;
			scrollbar-width: none;
		}

		.docked-terminal .xterm-viewport::-webkit-scrollbar {
			display: none;
		}

		/* As wide as the session's columns draw, as tall as its rows; pulled up by however much they overflow the screen
		   (the panel's fit sets it), so its oldest rows are cut off at the top and never its prompt at the bottom */
		.dock .docked-terminal .screen > .xterm {
			position: relative;
			display: block;
			width: max-content;
			height: max-content;
			overflow: visible;
		}

		.airlock-card .people,
		.airlock-card .invites {
			display: grid;
			gap: ${space.sm};
		}

		.airlock-card .people {
			min-height: 0;
			overflow-y: auto;
		}

		.airlock-card .invite-form,
		.airlock-card .invite-result {
			display: flex;
			flex-wrap: wrap;
			gap: ${space.xs};
		}

		.airlock-card .invite-form input,
		.airlock-card .invite-result input {
			flex: 1 1 10em;
			min-width: 0;
		}

		.airlock-card .comment {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			column-gap: ${space.sm};
			padding: ${space.xs} ${space.sm};
			border-left: 2px solid ${colors.teal};
		}

		.airlock-card .comment .meta {
			grid-column: 1;
		}

		.airlock-card .comment button {
			grid-column: 2;
			grid-row: 1 / span 2;
		}

		.airlock-card .meta,
		.airlock-card .empty {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.reply-card .log {
			display: grid;
			gap: 2px;
			max-height: 50vh;
			overflow-y: auto;
		}

		.reply-card .log .use {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			column-gap: ${space.sm};
			padding: ${space.xs} ${space.sm};
			border: 0;
			border-left: 2px solid transparent;
			background: none;
			color: inherit;
			font: inherit;
			text-align: left;
			cursor: pointer;
		}

		.reply-card .log .use:hover:not(:disabled) {
			background: ${colors.alpha(colors.white, 0.06)};
		}

		.reply-card .log .use:disabled {
			cursor: default;
		}

		.reply-card .log .use.failed {
			border-left-color: ${colors.danger};
		}

		.reply-card .log .when {
			color: ${colors.muted};
			white-space: nowrap;
		}

		.reply-card .log .what {
			grid-column: 1 / -1;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: ${colors.muted};
		}

		.dock {
			position: absolute;
			z-index: 3;
			top: 12px;
			right: 16px;
			bottom: 72px;
			display: flex;
			flex-direction: column;
			gap: ${space.xs};
			width: min(620px, calc(100% - 32px));
			/* A width chosen on a wider window still leaves the grip on screen */
			max-width: calc(100% - 32px);
			padding: ${space.md} ${space.md} ${space.sm};
			box-sizing: border-box;
			/* Glass over the ship, as the session page's panels float over its terminal */
			border: 1px solid ${colors.border};
			border-radius: ${radius.lg};
			/* Light enough to see the stars and the ship through, blurred only a little */
			background: ${colors.alpha(colors.black, 0.18)};
			backdrop-filter: blur(3px) saturate(140%);
			-webkit-backdrop-filter: blur(3px) saturate(140%);
			box-shadow: 0 8px 32px ${colors.alpha(colors.vantablack, 0.45)};
			overflow: hidden;
		}

		.dock > .grip {
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			width: 7px;
			cursor: ew-resize;
			touch-action: none;
		}

		.dock > .grip:hover {
			background: ${colors.alpha(colors.light(colors.teal), 0.25)};
		}

		.dock > .head {
			display: flex;
			align-items: flex-start;
			gap: ${space.sm};
		}

		.dock > .head .titles {
			flex: 1;
			min-width: 0;
		}

		.dock > .head .titles strong {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.dock > .head .about {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.dock > .tabs {
			display: flex;
			flex-wrap: wrap;
			gap: 2px;
		}

		.dock > .tabs button {
			padding: 2px ${space.sm};
			font-size: 0.85em;
		}

		.dock > .tabs button.active {
			background: ${colors.alpha(colors.light(colors.teal), 0.2)};
			color: ${colors.light(colors.teal)};
		}

		.dock > .body {
			position: relative;
			flex: 1;
			min-height: 0;
		}

		.dock > .body > * {
			position: absolute;
			inset: 0;
		}

		.dock > .body > [hidden] {
			display: none;
		}

		.focus .summary {
			display: flex;
			flex-direction: column;
			gap: 2px;
			padding: 0;
			border: none;
			background: none;
			color: inherit;
			font: inherit;
			text-align: left;
			cursor: pointer;
		}

		.focus.folded {
			width: auto;
			max-width: calc(100% - 24px);
		}

		.focus .summary .line {
			white-space: nowrap;
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.focus .title .fold {
			float: right;
		}

		.focus {
			position: absolute;
			z-index: 2;
			display: flex;
			flex-direction: column;
			gap: ${space.xs};
			width: ${FOCUS_WIDTH}px;
			max-height: calc(100% - 64px);
			overflow-y: auto;
			padding: calc(12px + ${space.xs}) calc(10px + ${space.sm});
			box-sizing: border-box;
			background: #151920;
			--aug-tl1: 12px;
			--aug-tr1: 12px;
			--aug-tr2: 12px;
			--aug-br1: 12px;
			--aug-bl1: 12px;
			--aug-bl2: 12px;
			--aug-border-all: 2px;
			--aug-border-bg: ${colors.light(colors.teal)};
			font-size: 0.85em;
		}

		.focus .rows {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: 0 ${space.sm};
		}

		.focus .key {
			color: ${colors.light(colors.teal)};
			text-transform: uppercase;
			font-size: 0.85em;
		}

		.focus .items {
			display: flex;
			flex-direction: column;
			gap: 2px;
			margin-top: ${space.xs};
		}

		.focus .item {
			display: flex;
			flex-direction: column;
			padding: 2px ${space.sm};
			border: none;
			border-left: 2px solid ${colors.alpha(colors.white, 0.2)};
			background: none;
			color: inherit;
			font: inherit;
			text-align: left;
			cursor: pointer;
		}

		.focus .item:hover {
			background: ${colors.alpha(colors.white, 0.06)};
		}

		.focus .item.busy {
			border-left-color: ${colors.teal};
		}

		.focus .item.warn {
			border-left-color: ${colors.light(colors.warning)};
		}

		.focus .item.off {
			opacity: 0.7;
		}

		.focus .item .detail {
			color: ${colors.muted};
			font-size: 0.9em;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.focus .verbs {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
			margin-top: ${space.xs};
		}

		.focus .verbs button {
			display: flex;
			align-items: center;
			gap: 4px;
			padding: 2px ${space.sm};
			border: 1px solid ${colors.alpha(colors.light(colors.teal), 0.35)};
			border-radius: 0;
			background: none;
			color: inherit;
			font: inherit;
			cursor: pointer;
		}

		.focus .verbs button:hover {
			border-color: ${colors.light(colors.teal)};
		}

		.focus kbd {
			color: ${colors.light(colors.teal)};
			font: inherit;
			font-size: 0.85em;
			text-transform: uppercase;
		}

		.projects-list {
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.projects-list .project-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			column-gap: ${space.sm};
			padding: ${space.xs} ${space.sm};
			border-left: 2px solid ${colors.alpha(colors.light(colors.teal), 0.4)};
		}

		.projects-list .project-row .about {
			grid-column: 1;
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.projects-list .project-row button {
			grid-column: 2;
			grid-row: 1 / span 2;
		}

		.dock > .body > .scrolling {
			overflow-y: auto;
		}
	`,
);
