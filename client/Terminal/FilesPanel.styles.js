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

		/* Room for the path before the buttons beside it; past that, they wrap below */
		.viewer .path {
			flex: 1 1 10em;
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

		/* A block of its own: inline in the pre, the two fonts' line boxes together outgrow the gutter's lines */
		.source code {
			display: block;
		}

		.source code.plain {
			font-family: ui-monospace, monospace;
			color: ${colors.white};
		}

		.status {
			margin-left: auto;
			padding: 0 4px;
			font-weight: bold;
			font-size: 0.85em;
		}

		.head .status {
			margin-left: 0;
		}

		.status.modified, .status.renamed {
			color: ${colors.light(colors.yellow)};
		}

		.status.added, .status.untracked {
			color: ${colors.light(colors.green)};
		}

		.status.deleted {
			color: ${colors.light(colors.red)};
		}

		.status.renamed {
			color: ${colors.lighter(colors.blue)};
		}

		.bar button .count:not(:empty) {
			margin-left: 6px;
			padding: 0 6px;
			border-radius: 8px;
			font-size: 0.8em;
			background: ${colors.alpha(colors.white, 0.15)};
		}

		.diff {
			min-width: fit-content;
			font-size: 13px;
			line-height: ${LINE_HEIGHT}px;
			padding-bottom: 8px;
		}

		.hunk-head {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 4px 8px;
			margin-top: 6px;
			background: ${colors.alpha(colors.blue, 0.12)};
			color: ${colors.light(colors.gray)};
			font-family: ui-monospace, monospace;
			position: sticky;
			left: 0;
		}

		.hunk-head .where {
			white-space: pre;
		}

		.diff .line {
			display: flex;
			white-space: pre;
		}

		.diff .line.added {
			background: ${colors.alpha(colors.green, 0.16)};
		}

		.diff .line.removed {
			background: ${colors.alpha(colors.red, 0.16)};
		}

		.diff .line.picked {
			box-shadow: inset 3px 0 ${colors.light(colors.yellow)};
			background-image: linear-gradient(${colors.alpha(colors.yellow, 0.16)}, ${colors.alpha(colors.yellow, 0.16)});
		}

		.diff .numbers {
			display: flex;
			flex-shrink: 0;
			color: ${colors.gray};
			font-family: ui-monospace, monospace;
			cursor: pointer;
			user-select: none;
		}

		.diff .numbers span {
			width: 4ch;
			padding-right: 6px;
			text-align: right;
		}

		.diff .numbers:hover {
			color: ${colors.white};
		}

		.diff .mark {
			width: 2ch;
			flex-shrink: 0;
			text-align: center;
			font-family: ui-monospace, monospace;
			color: ${colors.light(colors.gray)};
		}

		.diff code {
			margin: 0;
			padding: 0 8px 0 0;
			background: transparent;
			white-space: pre;
			tab-size: 4;
		}

		.diff code.plain {
			font-family: ui-monospace, monospace;
			color: ${colors.white};
		}

		.diff.split .split-row {
			display: grid;
			grid-template-columns: 1fr 1fr;
		}

		.diff.split .side {
			display: flex;
			min-width: 0;
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}

		.diff.split .side.left {
			border-right: 1px solid ${colors.alpha(colors.white, 0.08)};
		}

		.diff.split .side.added {
			background: ${colors.alpha(colors.green, 0.16)};
		}

		.diff.split .side.removed {
			background: ${colors.alpha(colors.red, 0.16)};
		}

		.diff.split .side.empty {
			background: ${colors.alpha(colors.black, 0.25)};
		}

		.diff.split .side.picked {
			box-shadow: inset 3px 0 ${colors.light(colors.yellow)};
			background-image: linear-gradient(${colors.alpha(colors.yellow, 0.16)}, ${colors.alpha(colors.yellow, 0.16)});
		}

		.diff.split code {
			white-space: pre-wrap;
		}

		.diff .number {
			flex-shrink: 0;
			width: 4ch;
			padding-right: 6px;
			text-align: right;
			color: ${colors.gray};
			font-family: ui-monospace, monospace;
			cursor: pointer;
			user-select: none;
		}

		.diff .number:hover {
			color: ${colors.white};
		}

		.diff .split-note {
			padding-left: 8px;
			color: ${colors.light(colors.gray)};
		}

		.diff .file-head {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-top: 12px;
			padding: 6px 8px;
			border-top: 1px solid ${colors.alpha(colors.white, 0.12)};
			font-weight: bold;
		}

		.diff .file-head .status {
			margin-left: 0;
		}

		.list .section {
			margin: 10px 4px 4px;
			font-size: 0.8em;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: ${colors.light(colors.gray)};
		}

		.list .entry .detail {
			margin-left: auto;
			padding-left: 8px;
			font-size: 0.85em;
			color: ${colors.light(colors.gray)};
		}

		.list .entry.proposal {
			background: ${colors.alpha(colors.yellow, 0.14)};
		}

		.list .comparing {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 6px;
			margin-bottom: 6px;
			padding: 6px;
			border-radius: 4px;
			background: ${colors.alpha(colors.blue, 0.18)};
		}

		.bar button.proposing {
			box-shadow: inset 0 -2px ${colors.light(colors.yellow)};
		}

		textarea.editor {
			box-sizing: border-box;
			width: 100%;
			height: 100%;
			margin: 0;
			padding: 4px 8px;
			border: none;
			border-radius: 0;
			resize: none;
			outline: none;
			background: ${colors.alpha(colors.black, 0.35)};
			font-size: 13px;
			line-height: ${LINE_HEIGHT}px;
			white-space: pre;
			tab-size: 4;
		}

		textarea.editor.plain {
			font-family: ui-monospace, monospace;
			color: ${colors.white};
		}

		.head .editing {
			color: ${colors.light(colors.yellow)};
		}

		.conflict {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 8px;
			padding: 6px 8px;
			background: ${colors.alpha(colors.orange, 0.2)};
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
