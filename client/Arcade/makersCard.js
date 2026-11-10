import { Elem, styled } from '@vanilla-bean/components';

import makersPanel from './makersPanel';

// The home page's arcade card: the owner's way to give someone an arcade of their own
const Card = styled(
	Elem,
	({ colors, radius, space }) => `
		display: flex;
		flex-direction: column;
		min-height: 56px;

		.open-form {
			flex: 1;
			align-self: stretch;
			border: 1px dashed ${colors.alpha(colors.white, 0.18)};
			border-radius: ${radius.md};
			color: ${colors.muted};
			font: inherit;
		}

		.open-form:hover {
			border-color: ${colors.alpha(colors.white, 0.35)};
			color: ${colors.white};
		}

		form {
			display: none;
			flex-wrap: wrap;
			gap: ${space.sm};
			padding: ${space.sm};
			border: 1px dashed ${colors.alpha(colors.white, 0.18)};
			border-radius: ${radius.md};
		}

		form input {
			flex: 1 1 160px;
			min-width: 0;
		}

		form textarea {
			flex: 1 1 100%;
			min-height: 3em;
			resize: vertical;
		}

		form select {
			flex: 1 1 160px;
		}

		form .meta {
			flex: 1 1 100%;
			color: ${colors.muted};
			font-size: 0.85em;
		}

		pre {
			max-height: 10em;
			overflow: auto;
			margin: ${space.sm} 0 0;
			padding: ${space.sm} ${space.md};
			border-radius: ${radius.md};
			background: ${colors.alpha(colors.black, 0.35)};
			font-size: 0.85em;
			white-space: pre-wrap;
		}

		&.open .open-form {
			display: none;
		}

		&.open form.new-arcade {
			display: flex;
		}

		.makers {
			margin-top: ${space.sm};
		}

		.makers .open-form {
			width: 100%;
			min-height: 40px;
		}

		.makers.open form {
			display: flex;
		}

	`,
);

// Making a game is a prompt sent to the arcade (the home prompt's arcade chip, then "A new game"); what stays on the
// home page is the owner's way to give someone an arcade of their own
const makersCard = () => {
	const card = new Card({});

	card.elem.append(makersPanel());

	return card.elem;
};

export default makersCard;
