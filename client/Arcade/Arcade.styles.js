import { Elem, styled } from '@vanilla-bean/components';

// The arcade page: the game large, the talk with Claude beside it; on a phone one over the other
const ArcadePage = styled(
	Elem,
	({ colors, media }) => `
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;

		.stage {
			display: flex;
			flex: 1;
			min-height: 0;
		}

		.stage > .arcade-game {
			flex: 1 1 60%;
		}

		.stage > .arcade-talk {
			flex: 1 1 40%;
			min-width: min(360px, 100%);
			max-width: 560px;
			border-left: 1px solid ${colors.border};
		}

		@media ${media.phone}, (max-width: 820px) {
			.stage {
				flex-direction: column;
			}

			.stage > .arcade-game {
				flex: 0 0 42vh;
			}

			.stage > .arcade-talk {
				max-width: none;
				min-width: 0;
				border-left: 0;
				border-top: 1px solid ${colors.border};
			}
		}
	`,
);

export default ArcadePage;
