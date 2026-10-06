import { Component, styled } from '@vanilla-bean/components';

export const LINE_HEIGHT = 20;
const LAYER = 'rgba(16, 16, 19, 0.5)';

const Panel = styled(
	Component,
	({ colors }) => `
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: 8px;
		padding: 8px;

		.bar, .filters, .list, .viewer {
			background: ${LAYER};
			border-radius: 6px;
		}

		.bar {
			display: flex;
			gap: 6px;
			padding: 6px;
			align-items: center;
		}

		.search {
			flex: 1;
			min-width: 0;
			display: flex;
			align-items: center;
			gap: 2px;
			padding-right: 2px;
			border-radius: 4px;
			background: ${colors.alpha(colors.black, 0.6)};
		}

		.search input {
			flex: 1;
			min-width: 0;
			border: none;
			background: transparent;
		}

		.filters {
			display: none;
			flex-direction: column;
			gap: 6px;
			padding: 6px;
		}

		.filters.shown {
			display: flex;
		}

		button {
			padding: 4px 10px;
			border: none;
			border-radius: 4px;
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
			font: inherit;
			cursor: pointer;
			white-space: nowrap;
		}

		button.toggle {
			padding: 2px 7px;
			border: 1px solid ${colors.alpha(colors.white, 0.25)};
			background: transparent;
			font-family: ui-monospace, monospace;
			font-weight: bold;
		}

		button.toggle.active {
			border-color: ${colors.light(colors.blue)};
		}

		button.active {
			background: ${colors.alpha(colors.blue, 0.45)};
			opacity: 1;
		}

		button.icon-only {
			padding: 4px 8px;
		}

		.panes {
			flex: 1;
			min-height: 0;
			display: flex;
		}

		.splitter {
			flex-shrink: 0;
			width: 8px;
			cursor: ew-resize;
			border-radius: 3px;
		}

		.splitter:hover, .splitter.dragging {
			background: ${colors.alpha(colors.white, 0.15)};
		}

		.list {
			box-sizing: border-box;
			width: var(--list-width, 34%);
			min-width: 140px;
			flex-shrink: 0;
			overflow: auto;
			padding: 6px;
			font-size: 0.9em;
		}

		.list .entry {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 2px 4px;
			border-radius: 3px;
			cursor: pointer;
			white-space: nowrap;
		}

		.list .entry .label {
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.list .entry i, .head i {
			width: 1.1em;
			flex-shrink: 0;
			text-align: center;
		}

		.list .entry:hover, .list .entry.current {
			background: ${colors.alpha(colors.white, 0.12)};
		}

		.list .hit-text {
			color: ${colors.light(colors.gray)};
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.list .hit-text mark {
			background: ${colors.alpha(colors.yellow, 0.35)};
			color: inherit;
		}

		.viewer {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}

		.viewer .head {
			display: flex;
			gap: 6px;
			align-items: center;
			padding: 6px;
			flex-wrap: wrap;
			border-bottom: 1px solid ${colors.alpha(colors.white, 0.08)};
		}

		.viewer .path {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.body {
			flex: 1;
			min-height: 0;
			overflow: auto;
		}

		.source {
			position: relative;
			display: flex;
			min-width: fit-content;
			font-size: 13px;
			line-height: ${LINE_HEIGHT}px;
		}

		.gutter {
			flex-shrink: 0;
			padding: 0 12px 0 8px;
			text-align: right;
			color: ${colors.gray};
			font-family: ui-monospace, monospace;
			user-select: none;
			cursor: pointer;
			position: relative;
			z-index: 1;
		}

		.gutter div:hover {
			color: ${colors.white};
		}

		.source pre, .source code {
			margin: 0;
			padding: 0;
			width: auto;
			background: transparent;
			line-height: ${LINE_HEIGHT}px;
			white-space: pre;
			tab-size: 4;
			position: relative;
			z-index: 1;
		}

		.source code.plain {
			font-family: ui-monospace, monospace;
			color: ${colors.white};
		}

		.band {
			position: absolute;
			left: 0;
			right: 0;
			background: ${colors.alpha(colors.yellow, 0.16)};
			pointer-events: none;
		}

		.markdown {
			padding: 8px 16px 16px;
			line-height: 1.5;
			max-width: 900px;
		}

		.markdown img {
			max-width: 100%;
		}

		.markdown pre {
			padding: 8px;
			border-radius: 4px;
			overflow: auto;
		}

		.markdown a {
			color: ${colors.light(colors.blue)};
		}

		.markdown table {
			border-collapse: collapse;
		}

		.markdown th, .markdown td {
			border: 1px solid ${colors.alpha(colors.white, 0.15)};
			padding: 4px 8px;
		}

		.media {
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 100%;
			padding: 8px;
			box-sizing: border-box;
		}

		.media img, .media video {
			max-width: 100%;
			max-height: 100%;
			object-fit: contain;
			background: repeating-conic-gradient(#2a2a2e 0% 25%, #222226 0% 50%) 50% / 16px 16px;
		}

		.media iframe {
			width: 100%;
			height: 100%;
			min-height: 400px;
			border: none;
			background: white;
		}

		.empty {
			color: ${colors.light(colors.gray)};
			padding: 8px;
		}

		.head .back {
			display: none;
		}

		@media (max-width: 800px) {
			.list {
				width: auto;
				flex: 1;
			}

			.splitter {
				display: none;
			}

			.panes.reading .list, .panes:not(.reading) .viewer {
				display: none;
			}

			.head .back {
				display: inline-block;
			}

			.bar {
				flex-wrap: wrap;
			}

			.bar .search {
				flex-basis: 100%;
			}
		}
	`,
);

export default Panel;
