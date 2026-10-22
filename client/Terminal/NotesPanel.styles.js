import { Component, styled } from '@vanilla-bean/components';

const Panel = styled(
	Component,
	({ colors, radius, space }) => `
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;

		/* Focused so Esc closes it; nothing to show for that */
		&:focus {
			outline: none;
		}

		.tabs, .who, .composer {
			display: flex;
			gap: ${space.sm};
			padding: ${space.sm};
		}

		/* The panel itself is mostly glass; what holds text sits on something solid enough to read */
		.tabs, .who {
			margin: ${space.sm} ${space.sm} 0;
			border-radius: ${radius.md};
			background: ${colors.alpha(colors.vantablack, 0.5)};
		}

		.message, .comment, .draft, .composer {
			background: ${colors.alpha(colors.vantablack, 0.5)};
		}

		.message {
			padding: ${space.sm};
			border-radius: ${radius.md};
		}

		.composer {
			margin: ${space.sm};
			border-radius: ${radius.md};
		}

		.tabs {
			border-bottom: none;
			overflow: visible;
		}

		.tabs button {
			flex: 1;
			margin-bottom: 0;
			padding: ${space.sm};
			border-bottom: none;
			border-radius: ${radius.sm};
			color: inherit;
			font: inherit;
			opacity: 0.6;
		}

		.tabs button[aria-selected='true'] {
			background: ${colors.alpha(colors.white, 0.08)};
			color: inherit;
			font-weight: normal;
			opacity: 1;
		}

		/* Unread, as a badge; nothing unread, nothing shown */
		.tabs .count:empty {
			display: none;
		}

		.tabs .count:not(:empty) {
			margin-left: ${space.sm};
			padding: 0 ${space.sm};
			border-radius: ${radius.lg};
			background: ${colors.orange};
			color: ${colors.white};
			font-size: 0.8em;
		}

		.who input {
			flex: 1;
		}

		.who .guest-name {
			flex: 1;
			display: flex;
			align-items: baseline;
			gap: ${space.sm};
			padding: ${space.xs} 2px;
			min-width: 0;
		}

		.who .guest-name .as {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.who .guest-name strong {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		/* Matches the files panel's */
		.who button.close {
			padding: ${space.xs} ${space.sm};
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
		}

		.who .bell {
			font-size: 1.1em;
		}

		.list {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			padding: ${space.sm};
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
		}

		.empty {
			color: ${colors.gray};
			padding: ${space.sm} 0;
		}

		.message .meta, .comment .meta, .reply .meta {
			color: ${colors.muted};
			font-size: 0.8em;
		}

		.message .text, .comment .text, .reply .text {
			white-space: pre-wrap;
			word-break: break-word;
		}

		.comment {
			padding: ${space.sm};
			border-radius: ${radius.md};
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
		}

		.comment.resolved {
			opacity: 0.5;
		}

		.quote {
			margin: 0;
			padding: ${space.xs} ${space.sm};
			border-left: 3px solid ${colors.light(colors.orange)};
			white-space: pre-wrap;
			word-break: break-word;
			max-height: 8em;
			overflow: hidden;
			font-size: 0.85em;
			cursor: pointer;
		}

		.place {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			gap: ${space.sm};
			font-size: 0.85em;
		}

		.place .where {
			padding: 0;
			color: ${colors.light(colors.blue)};
			font: inherit;
			font-family: ui-monospace, monospace;
			text-align: left;
			word-break: break-all;
		}

		.place .github {
			color: ${colors.gray};
		}

		.comment.flash {
			outline: 2px solid ${colors.alpha(colors.blue, 0.7)};
		}

		.comments-toolbar {
			display: flex;
			flex-wrap: wrap;
			gap: ${space.sm};
		}

		.comments-toolbar button {
			padding: ${space.xs} ${space.md};
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
			font: inherit;
			font-size: 0.9em;
		}

		.reactions {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: ${space.xs};
		}

		.reactions:empty {
			display: none;
		}

		.reactions .chip {
			padding: 1px ${space.sm};
			border: 1px solid ${colors.border};
			border-radius: ${radius.lg};
			background: ${colors.alpha(colors.white, 0.04)};
			color: inherit;
			font: inherit;
			font-size: 0.85em;
		}

		.reactions .chip.mine {
			border-color: ${colors.alpha(colors.blue, 0.7)};
			background: ${colors.alpha(colors.blue, 0.2)};
		}

		.reactions .chip.add {
			opacity: 0.45;
		}

		.reactions .chip.add:hover, .message:hover .chip.add, .comment:hover > .reactions .chip.add {
			opacity: 0.9;
		}

		.reactions .palette {
			display: none;
			flex-basis: 100%;
			flex-wrap: wrap;
			gap: 2px;
			padding: ${space.xs};
			border-radius: ${radius.md};
			background: ${colors.alpha(colors.vantablack, 0.9)};
		}

		.reactions .palette.open {
			display: flex;
		}

		.reactions .palette button {
			font-size: 1.15em;
			padding: 2px ${space.xs};
			border-radius: ${radius.sm};
		}

		.reactions .palette button:hover {
			background: ${colors.alpha(colors.white, 0.1)};
		}

		.reactions .palette input {
			width: 90px;
			font-size: 0.85em;
		}

		.reply {
			margin-left: ${space.md};
		}

		/* Claude's answers, set apart from what people say */
		.from-claude {
			border-left: 2px solid hsl(20, 70%, 60%);
			padding-left: ${space.sm};
		}

		.from-claude > .meta {
			color: hsl(20, 70%, 70%);
		}

		.composer button.ask {
			background: hsl(20, 60%, 45%, 0.35);
		}

		.actions {
			display: flex;
			gap: ${space.sm};
		}

		.actions button, .composer button {
			padding: ${space.xs} ${space.md};
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
			font: inherit;
		}

		textarea {
			flex: 1;
			min-height: 2.4em;
			max-height: 30vh;
			resize: vertical;
			font: inherit;
		}

		.draft {
			padding: ${space.sm};
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
			border-top: 1px solid ${colors.alpha(colors.white, 0.08)};
		}
	`,
);

export default Panel;
