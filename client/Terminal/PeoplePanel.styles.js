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
			gap: ${space.md};
			padding: ${space.sm};
		}

		section {
			display: flex;
			flex-direction: column;
			gap: ${space.sm};
			padding: ${space.md};
			border-radius: ${radius.md};
			background: ${colors.alpha(colors.vantablack, 0.6)};
		}

		.heading {
			display: flex;
			align-items: center;
			gap: ${space.sm};
			margin: 0 0 ${space.xs};
			padding-bottom: ${space.sm};
			border-bottom: 1px solid ${colors.alpha(colors.white, 0.1)};
			font-size: 1em;
			font-weight: bold;
		}

		.heading .count {
			padding: 0 ${space.sm};
			border-radius: ${radius.lg};
			background: ${colors.alpha(colors.white, 0.12)};
			font-size: 0.8em;
			font-weight: normal;
		}

		.meta,
		.empty {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.name {
			font-weight: bold;
		}

		.pill {
			padding: 0 ${space.sm};
			border-radius: ${radius.lg};
			background: ${colors.alpha(colors.blue, 0.3)};
			font-size: 0.8em;
		}

		.pill.quiet {
			background: ${colors.alpha(colors.white, 0.1)};
			color: ${colors.muted};
		}

		.person,
		.invite {
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.person + .person,
		.invite + .invite {
			padding-top: ${space.sm};
			border-top: 1px solid ${colors.alpha(colors.white, 0.06)};
		}

		.person-head,
		.invite-head {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: ${space.sm};
		}

		.invite-head .name {
			margin-right: auto;
		}

		.invite-controls {
			display: flex;
			gap: ${space.sm};
			margin-top: ${space.xs};
		}

		.invite-controls select {
			flex: 1;
			min-width: 0;
		}

		.invite .actions {
			display: flex;
			justify-content: flex-end;
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
		.family-name {
			color: ${colors.muted};
			font-size: 0.8em;
			letter-spacing: 0.05em;
			text-transform: uppercase;
		}

		.roles {
			display: flex;
			flex-direction: column;
			gap: ${space.md};
			margin-top: ${space.sm};
		}

		.family {
			display: flex;
			flex-direction: column;
			gap: ${space.xs};
		}

		.choices {
			display: flex;
			flex-direction: column;
			border: 1px solid ${colors.alpha(colors.white, 0.1)};
			border-radius: ${radius.md};
			overflow: hidden;
		}

		button.role {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 2px;
			margin: 0;
			padding: ${space.sm} ${space.md};
			border: 0;
			border-left: 3px solid transparent;
			border-radius: 0;
			color: inherit;
			text-align: left;
		}

		button.role + button.role {
			border-top: 1px solid ${colors.alpha(colors.white, 0.06)};
		}

		button.role[aria-checked='true'] {
			border-left-color: ${colors.light(colors.blue)};
			background: ${colors.alpha(colors.blue, 0.2)};
		}

		button.role .opens {
			color: ${colors.muted};
			font-size: 0.85em;
			white-space: normal;
		}

		button.role[aria-checked='true'] .opens {
			color: inherit;
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
			margin-top: ${space.sm};
			padding-top: ${space.md};
			border-top: 1px solid ${colors.alpha(colors.white, 0.1)};
		}

		.make select {
			flex: 1;
		}

		.link-to-send {
			display: flex;
			flex-wrap: wrap;
			gap: ${space.sm};
			padding: ${space.sm};
			border-radius: ${radius.md};
			background: ${colors.alpha(colors.green, 0.12)};
		}

		.link-to-send .meta {
			flex-basis: 100%;
			color: inherit;
		}

		.link-to-send input {
			flex: 1;
			min-width: 0;
		}

		.result:empty {
			display: none;
		}
	`,
);

export default Panel;
