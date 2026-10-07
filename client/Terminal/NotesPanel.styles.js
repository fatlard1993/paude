import { Component, styled } from '@vanilla-bean/components';

const Panel = styled(
	Component,
	({ colors }) => `
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
			gap: 6px;
			padding: 8px;
		}

		/* The panel itself is mostly glass; what holds text sits on something solid enough to read */
		.tabs, .who {
			margin: 8px 8px 0;
			border-radius: 6px;
			background: rgba(18, 18, 21, 0.5);
		}

		.message, .comment, .draft, .composer {
			background: rgba(18, 18, 21, 0.5);
		}

		.message {
			padding: 6px 8px;
			border-radius: 6px;
		}

		.composer {
			margin: 8px;
			border-radius: 6px;
		}

		.tabs button {
			flex: 1;
			padding: 6px;
			border: none;
			border-radius: 4px;
			background: transparent;
			color: inherit;
			font: inherit;
			opacity: 0.6;
		}

		.tabs button.active {
			background: ${colors.alpha(colors.white, 0.08)};
			opacity: 1;
		}

		.badge {
			margin-left: 6px;
			padding: 0 6px;
			border-radius: 8px;
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
			gap: 6px;
			padding: 4px 2px;
			min-width: 0;
		}

		.who .guest-name .as {
			color: ${colors.light(colors.gray)};
			font-size: 0.85em;
		}

		.who .guest-name strong {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		/* Matches the files panel's */
		.who button.close {
			padding: 4px 8px;
			border: none;
			border-radius: 4px;
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
			cursor: pointer;
		}

		.who .bell {
			border: none;
			background: transparent;
			font-size: 1.1em;
			cursor: pointer;
		}

		.list {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			padding: 8px;
			display: flex;
			flex-direction: column;
			gap: 8px;
		}

		.empty {
			color: ${colors.gray};
			padding: 8px 0;
		}

		.message .meta, .comment .meta, .reply .meta {
			color: ${colors.light(colors.gray)};
			font-size: 0.8em;
		}

		.message .text, .comment .text, .reply .text {
			white-space: pre-wrap;
			word-break: break-word;
		}

		.comment {
			padding: 8px;
			border-radius: 6px;
			display: flex;
			flex-direction: column;
			gap: 6px;
		}

		.comment.resolved {
			opacity: 0.5;
		}

		.quote {
			margin: 0;
			padding: 4px 8px;
			border-left: 3px solid ${colors.light(colors.orange)};
			white-space: pre-wrap;
			word-break: break-word;
			max-height: 8em;
			overflow: hidden;
			font-size: 0.85em;
			cursor: pointer;
		}

		.reactions {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 4px;
		}

		.reactions:empty {
			display: none;
		}

		.reactions .chip {
			padding: 1px 7px;
			border: 1px solid ${colors.alpha(colors.white, 0.12)};
			border-radius: 10px;
			background: ${colors.alpha(colors.white, 0.04)};
			color: inherit;
			font: inherit;
			font-size: 0.85em;
			cursor: pointer;
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
			padding: 4px;
			border-radius: 6px;
			background: rgba(12, 12, 14, 0.9);
		}

		.reactions .palette.open {
			display: flex;
		}

		.reactions .palette button {
			border: none;
			background: transparent;
			font-size: 1.15em;
			padding: 2px 4px;
			border-radius: 4px;
			cursor: pointer;
		}

		.reactions .palette button:hover {
			background: ${colors.alpha(colors.white, 0.1)};
		}

		.reactions .palette input {
			width: 90px;
			font-size: 0.85em;
		}

		.reply {
			margin-left: 12px;
		}

		/* Claude's answers, set apart from what people say */
		.from-claude {
			border-left: 2px solid hsl(20, 70%, 60%);
			padding-left: 8px;
		}

		.from-claude > .meta {
			color: hsl(20, 70%, 70%);
		}

		.composer button.ask {
			background: hsl(20, 60%, 45%, 0.35);
		}

		.actions {
			display: flex;
			gap: 6px;
		}

		.actions button, .composer button {
			padding: 4px 10px;
			border: none;
			border-radius: 4px;
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
			padding: 8px;
			display: flex;
			flex-direction: column;
			gap: 6px;
			border-top: 1px solid ${colors.alpha(colors.white, 0.08)};
		}
	`,
);

export default Panel;
