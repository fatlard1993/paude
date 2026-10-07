import { Component, styled } from '@vanilla-bean/components';

const LAYER = 'rgba(18, 18, 21, 0.5)';

const Panel = styled(
	Component,
	({ colors }) => `
		display: flex;
		flex-direction: column;
		gap: 8px;
		height: 100%;
		min-height: 0;
		padding: 8px;
		box-sizing: border-box;

		/* Focused so Esc closes it; nothing to show for that */
		&:focus {
			outline: none;
		}

		&.busy {
			cursor: progress;
		}

		&.busy button {
			pointer-events: none;
			opacity: 0.6;
		}

		.bar, .tabs, .body, .output {
			border-radius: 6px;
			background: ${LAYER};
		}

		.bar {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 6px;
		}

		.spacer {
			flex: 1;
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

		button.icon-only {
			padding: 4px 8px;
		}

		button.primary {
			background: ${colors.alpha(colors.blue, 0.45)};
		}

		button.danger:hover {
			background: ${colors.alpha(colors.red, 0.45)};
		}

		button:disabled {
			opacity: 0.4;
			cursor: default;
		}

		.branch {
			font-weight: bold;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.tracking, .meta {
			color: ${colors.light(colors.gray)};
			font-size: 0.85em;
			font-variant-numeric: tabular-nums;
		}

		/* What git said, kept until dismissed when it refused */
		.output {
			display: none;
			align-items: flex-start;
			gap: 6px;
			padding: 6px 8px;
		}

		.output.shown {
			display: flex;
		}

		.output.error {
			box-shadow: inset 3px 0 ${colors.light(colors.red)};
		}

		.output pre {
			flex: 1;
			margin: 0;
			max-height: 10em;
			overflow: auto;
			white-space: pre-wrap;
			font-size: 0.85em;
		}

		.tabs {
			display: flex;
			gap: 4px;
			padding: 4px;
		}

		.tabs button {
			flex: 1 1 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			padding: 4px 6px;
			font-size: 0.9em;
			background: transparent;
			opacity: 0.7;
		}

		.tabs button.active {
			background: ${colors.alpha(colors.white, 0.08)};
			opacity: 1;
		}

		.body {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			padding: 6px;
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.section-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin: 8px 2px 4px;
			color: ${colors.light(colors.gray)};
			font-size: 0.8em;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}

		.section-head:first-child {
			margin-top: 2px;
		}

		.file, .branch-row {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 2px;
			border-radius: 4px;
		}

		.file:hover, .branch-row:hover {
			background: ${colors.alpha(colors.white, 0.05)};
		}

		.file .path {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			text-align: left;
			background: transparent;
			padding: 2px 4px;
		}

		.status {
			width: 1.2em;
			text-align: center;
			font-weight: bold;
		}

		.status.modified, .status.renamed, .status.copied { color: ${colors.light(colors.yellow)}; }
		.status.added, .status.untracked { color: ${colors.light(colors.green)}; }
		.status.deleted { color: ${colors.light(colors.red)}; }

		.branch-row .name {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.share a {
			color: inherit;
			text-decoration: none;
		}

		.share a:hover {
			text-decoration: underline;
		}

		.share > i {
			width: 1.2em;
			text-align: center;
			opacity: 0.7;
		}

		.branch-row.current .name {
			font-weight: bold;
		}

		.branch-row.current .name::before {
			content: '● ';
			color: ${colors.light(colors.green)};
		}

		.commit-box {
			display: flex;
			flex-direction: column;
			gap: 6px;
			margin-top: 10px;
		}

		.review-commit {
			padding: 2px 6px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.check {
			cursor: pointer;
		}

		.commit-box input, .commit-box textarea, .new-branch input {
			box-sizing: border-box;
			width: 100%;
			font: inherit;
		}

		.commit-options {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 6px;
		}

		.amend {
			flex: 1;
			font-size: 0.85em;
		}

		.new-branch {
			display: flex;
			gap: 6px;
			margin-bottom: 6px;
		}

		.history-item {
			display: flex;
			flex-direction: column;
			align-items: stretch;
			gap: 2px;
			padding: 6px;
			text-align: left;
			background: transparent;
			white-space: normal;
		}

		.history-item:hover {
			background: ${colors.alpha(colors.white, 0.05)};
		}

		.refs {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
		}

		.ref {
			padding: 0 6px;
			border-radius: 8px;
			font-size: 0.75em;
			background: ${colors.alpha(colors.blue, 0.3)};
		}

		.more {
			align-self: center;
			margin-top: 6px;
		}

		/* The Tasks panel */
		.task-name {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			text-align: left;
			background: transparent;
		}

		.outcome.ok { color: ${colors.light(colors.green)}; }
		.outcome.failed { color: ${colors.light(colors.red)}; }
		.outcome.running { color: ${colors.light(colors.yellow)}; }

		button.on {
			background: ${colors.alpha(colors.blue, 0.45)};
		}

		.problem {
			display: flex;
			gap: 8px;
			align-items: baseline;
			padding: 3px 6px;
			text-align: left;
			background: transparent;
			white-space: normal;
			font-size: 0.9em;
		}

		.problem:hover {
			background: ${colors.alpha(colors.white, 0.05)};
		}

		.problem .where {
			flex-shrink: 0;
			color: ${colors.light(colors.red)};
		}

		.problem.warning .where {
			color: ${colors.light(colors.yellow)};
		}

		.problem .message {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.run-head {
			display: flex;
			align-items: center;
			gap: 6px;
			flex-wrap: wrap;
			margin-bottom: 6px;
		}

		.run-output {
			flex: 1;
			margin: 0;
			max-height: none;
		}

		/* The Activity panel's turns and their steps */
		.turn {
			display: flex;
			flex-direction: column;
			border-radius: 4px;
		}

		.turn-head {
			display: flex;
			flex-direction: column;
			align-items: stretch;
			gap: 2px;
			padding: 6px;
			text-align: left;
			background: transparent;
			white-space: normal;
		}

		.turn-head:hover {
			background: ${colors.alpha(colors.white, 0.05)};
		}

		.turn-head .subject {
			overflow: hidden;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
		}

		.steps {
			display: flex;
			flex-direction: column;
			gap: 1px;
			margin: 0 0 8px 10px;
			padding-left: 6px;
			border-left: 1px solid ${colors.alpha(colors.white, 0.12)};
		}

		.step-line {
			display: flex;
			align-items: baseline;
			gap: 6px;
			width: 100%;
			padding: 2px 4px;
			text-align: left;
			background: transparent;
			font-size: 0.9em;
		}

		.step-line:hover {
			background: ${colors.alpha(colors.white, 0.05)};
		}

		.step-line i {
			width: 1.2em;
			text-align: center;
			opacity: 0.6;
		}

		.step-line .tool {
			color: ${colors.light(colors.gray)};
		}

		.step-line .what {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.step.failed .tool, .step.failed i {
			color: ${colors.light(colors.red)};
			opacity: 1;
		}

		.step.running .what::after {
			content: ' …';
		}

		.step-output {
			margin: 2px 0 6px 24px;
			padding: 6px;
			max-height: 16em;
			overflow: auto;
			white-space: pre-wrap;
			font-size: 0.8em;
			border-radius: 4px;
			background: rgba(0, 0, 0, 0.35);
		}

		.empty {
			padding: 12px;
			color: ${colors.light(colors.gray)};
		}
	`,
);

export default Panel;
