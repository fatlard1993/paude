import { Component, styled } from '@vanilla-bean/components';

import { NARROW } from './TerminalView.styles';

export const LINE_HEIGHT = 20;
// What text sits on over the panel's glass
const layer = colors => colors.alpha(colors.vantablack, 0.5);

const Panel = styled(
	Component,
	({ colors, fonts, radius, space }) => `
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: ${space.sm};
		padding: ${space.sm};

		/* Focused so Esc closes it; nothing to show for that */
		&:focus {
			outline: none;
		}

		.bar, .filters, .list, .viewer {
			background: ${layer(colors)};
			border-radius: ${radius.md};
		}

		.bar {
			display: flex;
			gap: ${space.sm};
			padding: ${space.sm};
			align-items: center;
		}

		.search {
			flex: 1;
			min-width: 0;
			display: flex;
			align-items: center;
			gap: 2px;
			padding-right: 2px;
			border-radius: ${radius.sm};
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
			gap: ${space.sm};
			padding: ${space.sm};
		}

		.filters.shown {
			display: flex;
		}

		button {
			padding: ${space.xs} ${space.md};
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
			font: inherit;
		}

		button.toggle {
			padding: 2px ${space.sm};
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
			padding: ${space.xs} ${space.sm};
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
			padding: ${space.sm};
			font-size: 0.9em;
		}

		.list .entry {
			display: flex;
			align-items: center;
			gap: ${space.sm};
			padding: 2px ${space.xs};
			border-radius: ${radius.sm};
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

		/* A press and hold opens the menu, not the browser's own or a text selection */
		.list .entry {
			user-select: none;
			-webkit-touch-callout: none;
		}

		.list .entry.selected {
			background: ${colors.alpha(colors.selected, 0.35)};
		}

		.list .entry.cut {
			opacity: 0.5;
		}

		.list:focus {
			outline: none;
		}

		.list:focus-visible .entry.cursor {
			outline: 1px solid ${colors.lighter(colors.selected)};
			outline-offset: -1px;
		}

		.list .entry.drop-target, .list.drop-target {
			outline: 1px dashed ${colors.lighter(colors.selected)};
			outline-offset: -1px;
			background: ${colors.alpha(colors.selected, 0.2)};
		}

		.list .hit-text {
			color: ${colors.muted};
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
			gap: ${space.sm};
			align-items: center;
			padding: ${space.sm};
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

		.replace {
			display: none;
			gap: ${space.sm};
		}

		.replace.shown {
			display: flex;
		}

		.replace input {
			flex: 1;
			min-width: 0;
			font: inherit;
		}

		.entry .snippet {
			margin-left: ${space.sm};
			color: ${colors.muted};
			font-size: 0.85em;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		/* Symbols in the list: their kind, and where they are */
		.list-heading {
			padding: ${space.sm} ${space.sm} ${space.xs};
			color: ${colors.muted};
			font-size: 0.8em;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}

		.symbol-kind {
			flex-shrink: 0;
			width: 1.4em;
			text-align: center;
			border-radius: 3px;
			font-size: 0.75em;
			font-weight: bold;
			text-transform: uppercase;
			background: ${colors.alpha(colors.white, 0.08)};
		}

		.symbol-kind.function, .symbol-kind.method { color: ${colors.light(colors.blue)}; }
		.symbol-kind.class, .symbol-kind.type { color: ${colors.light(colors.yellow)}; }
		.symbol-kind.value { color: ${colors.light(colors.green)}; }

		.entry .where {
			margin-left: auto;
			padding-left: ${space.sm};
			color: ${colors.muted};
			font-size: 0.8em;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.name-actions {
			display: contents;
		}

		/* Who last changed each run of lines, beside the line numbers */
		.blame {
			flex-shrink: 0;
			width: 18ch;
			padding-right: 8px;
			color: ${colors.muted};
			font-size: 0.8em;
			line-height: ${LINE_HEIGHT}px;
			white-space: pre;
			overflow: hidden;
			position: relative;
			z-index: 1;
		}

		.blame div {
			height: ${LINE_HEIGHT}px;
			overflow: hidden;
			text-overflow: ellipsis;
			cursor: pointer;
		}

		.blame div:hover {
			color: ${colors.white};
		}

		.file-history {
			display: flex;
			flex-direction: column;
			padding: ${space.sm};
		}

		.file-history .history-item {
			display: flex;
			flex-direction: column;
			align-items: stretch;
			gap: 2px;
			padding: ${space.sm};
			text-align: left;
			background: transparent;
			white-space: normal;
		}

		.file-history .history-item:hover {
			background: ${colors.alpha(colors.white, 0.05)};
		}

		.file-history .meta {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.commit-message {
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
			padding: ${space.sm};
			border-bottom: 1px solid ${colors.alpha(colors.white, 0.1)};
		}

		.commit-message .commit-body {
			white-space: pre-wrap;
		}

		.commit-message .commit-later {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 2px;
		}

		.commit-message .meta {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.source code.plain {
			font-family: ui-monospace, monospace;
			color: ${colors.white};
		}

		.status {
			margin-left: auto;
			padding: 0 ${space.xs};
			font-weight: bold;
			font-size: 0.85em;
		}

		.head .status {
			margin-left: 0;
		}

		.status.modified, .status.renamed {
			color: ${colors.light(colors.warning)};
		}

		.status.added, .status.untracked {
			color: ${colors.light(colors.success)};
		}

		.status.deleted {
			color: ${colors.light(colors.danger)};
		}

		.status.renamed {
			color: ${colors.lighter(colors.blue)};
		}

		.bar button .count:not(:empty) {
			margin-left: ${space.sm};
			padding: 0 ${space.sm};
			border-radius: ${radius.lg};
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
			color: ${colors.muted};
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
			color: ${colors.muted};
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
			color: ${colors.muted};
		}

		.diff .file-head {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-top: 12px;
			padding: 6px 8px;
			border-top: 1px solid ${colors.border};
			font-weight: bold;
		}

		.diff .group-head {
			margin-top: 18px;
			padding: 4px 8px;
			color: ${colors.light(colors.blue)};
			font-weight: bold;
		}

		.diff .file-head .file-label.part {
			color: ${colors.light(colors.blue)};
		}

		.diff .file-head .file-label {
			padding: 1px 6px;
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.white, 0.08)};
			color: ${colors.muted};
			font-size: 0.8em;
			white-space: nowrap;
		}

		.diff .file-head .show {
			margin-left: auto;
		}

		.diff .file-head .status {
			margin-left: 0;
		}

		.list .section {
			margin: ${space.md} ${space.xs} ${space.xs};
			font-size: 0.8em;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: ${colors.muted};
		}

		.list .entry .detail {
			margin-left: auto;
			padding-left: ${space.sm};
			font-size: 0.85em;
			color: ${colors.muted};
		}

		.list .entry.proposal {
			background: ${colors.alpha(colors.yellow, 0.14)};
		}

		.list .comparing {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: ${space.sm};
			margin-bottom: ${space.sm};
			padding: ${space.sm};
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.blue, 0.18)};
		}

		.bar button.proposing {
			box-shadow: inset 0 -2px ${colors.light(colors.yellow)};
		}

		.code-editor {
			height: 100%;
			background: ${colors.alpha(colors.black, 0.35)};
		}

		.code-editor .cm-editor {
			height: 100%;
			background: transparent;
			font-size: 13px;
		}

		.code-editor .cm-editor.cm-focused {
			outline: none;
		}

		.code-editor .cm-scroller {
			line-height: ${LINE_HEIGHT}px;
		}

		/* The syntax font colors the text, as it does in the source view */
		.code-editor .cm-content {
			${fonts.code}
			color: ${colors.white};
		}

		.code-editor .cm-content[class*='language-css'] {
			font-palette: --vbc-css-theme;
			color: ${colors.light(colors.green)};
		}

		.code-editor .cm-content[class*='language-json'] {
			font-palette: --vbc-json-theme;
		}

		.code-editor .cm-content[class*='language-html'] {
			font-palette: --vbc-html-theme;
		}

		.code-editor .cm-content.plain {
			font-family: ui-monospace, monospace;
		}

		.code-editor .cm-gutters {
			background: transparent;
			border-right: 1px solid ${colors.alpha(colors.white, 0.08)};
			color: ${colors.muted};
		}

		.code-editor .cm-activeLine, .code-editor .cm-activeLineGutter {
			background: ${colors.alpha(colors.white, 0.05)};
		}

		.code-editor .cm-cursor {
			border-left-color: ${colors.white};
		}

		.code-editor .cm-selectionBackground,
		.code-editor .cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground {
			background: ${colors.alpha(colors.blue, 0.4)};
		}

		.code-editor .cm-selectionMatch {
			background: ${colors.alpha(colors.blue, 0.2)};
		}

		.code-editor .cm-searchMatch {
			background: ${colors.alpha(colors.yellow, 0.25)};
			outline: 1px solid ${colors.alpha(colors.yellow, 0.5)};
		}

		.code-editor .cm-searchMatch-selected {
			background: ${colors.alpha(colors.orange, 0.5)};
		}

		/* The find bar, in the panel's own inputs and buttons */
		.code-editor .cm-panels {
			background: ${layer(colors)};
			color: inherit;
			border-color: ${colors.alpha(colors.white, 0.1)};
		}

		.code-editor .cm-search {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: ${space.xs} ${space.sm};
			padding: ${space.sm} 28px ${space.sm} ${space.sm};
			font-size: 0.9em;
		}

		.code-editor .cm-panels .cm-goto-line {
			padding: ${space.sm} 28px ${space.sm} ${space.sm};
			font-size: 0.9em;
		}

		.code-editor .cm-panels .cm-goto-line form, .code-editor .cm-panels .cm-goto-line label {
			display: flex;
			flex: 1;
			align-items: center;
			gap: ${space.sm};
			white-space: nowrap;
		}

		.code-editor .cm-search br {
			flex-basis: 100%;
			height: 0;
			content: '';
		}

		.code-editor .cm-panels .cm-textfield {
			flex: 1 1 140px;
			min-width: 0;
			margin: 0;
			padding: ${space.xs} ${space.sm};
			border: 1px solid ${colors.alpha(colors.white, 0.15)};
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.black, 0.6)};
			color: inherit;
			font: inherit;
		}

		.code-editor .cm-panels .cm-button {
			margin: 0;
			padding: ${space.xs} ${space.sm};
			border: none;
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.white, 0.1)};
			background-image: none;
			color: inherit;
			font: inherit;
		}

		/* Toggles drawn as the project search's: the box hidden, the label bordered, and lit while it's on */
		.code-editor .cm-search label {
			padding: 1px ${space.sm};
			border: 1px solid ${colors.alpha(colors.white, 0.25)};
			border-radius: ${radius.sm};
			font-size: inherit;
			font-family: ui-monospace, monospace;
			font-weight: bold;
			cursor: pointer;
		}

		.code-editor .cm-search label:has(input:checked) {
			border-color: ${colors.light(colors.blue)};
			background: ${colors.alpha(colors.blue, 0.45)};
		}

		.code-editor .cm-search label:has(input:focus-visible) {
			outline: 1px solid ${colors.lighter(colors.selected)};
		}

		.code-editor .cm-search label input {
			position: absolute;
			opacity: 0;
			pointer-events: none;
		}

		.code-editor .cm-search button[name='close'] {
			top: 4px;
			right: 6px;
			color: inherit;
			font-size: 1.3em;
		}

		.head .editing {
			color: ${colors.light(colors.yellow)};
		}

		.conflict {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: ${space.sm};
			padding: ${space.sm};
			background: ${colors.alpha(colors.orange, 0.2)};
		}

		.tour-strip {
			flex-shrink: 0;
			margin: ${space.sm};
			max-height: 40%;
			overflow: auto;
		}

		.tour-strip .question {
			font-weight: normal;
			line-height: 1.4;
		}

		.tour-strip .answers {
			flex-direction: row;
			flex-wrap: wrap;
		}

		.tour-strip .answers button {
			padding: ${space.xs} ${space.md};
		}

		.comment-mark {
			position: absolute;
			left: 0;
			width: 4px;
			min-height: ${LINE_HEIGHT}px;
			padding: 0;
			border: none;
			border-radius: 2px;
			background: ${colors.blue};
			cursor: pointer;
			z-index: 1;
		}

		.comment-mark:hover {
			width: 8px;
		}

		.diff .line,
		.diff.split .side {
			position: relative;
		}

		.diff .comment-mark {
			top: 0;
			bottom: 0;
		}

		/* Over the gutter, which is also above the text and would take the click as picking the line */
		.source .comment-mark {
			z-index: 2;
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

		img.enlarges {
			cursor: zoom-in;
		}

		.markdown pre {
			padding: 8px;
			border-radius: ${radius.sm};
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
			background: repeating-conic-gradient(${colors.darkest(colors.gray)} 0% 25%, ${colors.black} 0% 50%) 50% / 16px 16px;
		}

		.media iframe {
			width: 100%;
			height: 100%;
			min-height: 400px;
			border: none;
			background: white;
		}

		.empty {
			color: ${colors.muted};
			padding: ${space.sm};
		}

		.head .back {
			display: none;
		}

		@media ${NARROW} {
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
