import { Component, styled } from '@vanilla-bean/components';

// The People panel: its parts sit on something solid enough to read over the glass, as the chat's do
const Panel = styled(
	Component,
	({ colors, radius, space }) => `
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;

		&:focus {
			outline: none;
		}

		.who {
			display: flex;
			align-items: center;
			gap: ${space.sm};
			margin: ${space.sm} ${space.sm} 0;
			padding: ${space.sm};
			border-radius: ${radius.md};
			background: ${colors.alpha(colors.vantablack, 0.5)};
		}

		.who .spacer {
			flex: 1;
		}

		.who button.close {
			padding: ${space.xs} ${space.sm};
			border-radius: ${radius.sm};
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
		}

		.list {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
			padding: ${space.sm};
		}

		section {
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
			padding: ${space.sm};
			border-radius: ${radius.md};
			background: ${colors.alpha(colors.vantablack, 0.5)};
		}

		.heading {
			margin: 0;
			color: ${colors.muted};
			font-size: 0.8em;
			font-weight: normal;
			letter-spacing: 0.06em;
			text-transform: uppercase;
		}

		.meta,
		.empty {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.person,
		.invite-head {
			display: flex;
			align-items: baseline;
			flex-wrap: wrap;
			gap: ${space.sm};
		}

		.name {
			font-weight: bold;
		}

		.tag {
			padding: 0 ${space.sm};
			border-radius: ${radius.lg};
			background: ${colors.alpha(colors.white, 0.1)};
			font-size: 0.8em;
		}

		.invite {
			display: flex;
			flex-direction: column;
			gap: ${space.xs};
			padding-top: ${space.sm};
			border-top: 1px solid ${colors.alpha(colors.white, 0.08)};
		}

		.invite .actions {
			display: flex;
			gap: ${space.sm};
		}

		button.danger:hover {
			background: ${colors.alpha(colors.danger, 0.45)};
		}

		.field {
			display: flex;
			flex-direction: column;
			gap: ${space.xs};
		}

		.field .label,
		.family {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.family {
			margin-top: ${space.xs};
		}

		.roles {
			display: flex;
			flex-direction: column;
			gap: ${space.xs};
		}

		button.role {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 2px;
			padding: ${space.sm};
			border: 1px solid ${colors.alpha(colors.white, 0.1)};
			border-radius: ${radius.md};
			color: inherit;
			text-align: left;
		}

		button.role[aria-checked='true'] {
			border-color: ${colors.light(colors.blue)};
			background: ${colors.alpha(colors.blue, 0.18)};
		}

		button.role .opens {
			color: ${colors.muted};
			font-size: 0.85em;
			white-space: normal;
		}

		.warning {
			padding: ${space.sm};
			border-left: 3px solid ${colors.light(colors.danger)};
			background: ${colors.alpha(colors.danger, 0.15)};
			font-size: 0.85em;
		}

		.make {
			display: flex;
			gap: ${space.sm};
		}

		.make select {
			flex: 1;
		}

		.link-to-send {
			display: flex;
			flex-wrap: wrap;
			gap: ${space.sm};
		}

		.link-to-send .meta {
			flex-basis: 100%;
		}

		.link-to-send input {
			flex: 1;
			min-width: 0;
		}
	`,
);

export default Panel;
