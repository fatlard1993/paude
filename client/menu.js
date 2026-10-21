import { ContextMenu, styled } from '@vanilla-bean/components';

// The library's menu in paude's glass: flat rows, a second line for detail, small warm headings
const GlassMenu = styled(
	ContextMenu,
	({ colors }) => `
		min-width: 240px;
		max-width: min(360px, calc(100vw - 16px)) !important;
		padding: 4px;
		border-radius: 8px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(24, 24, 27, 0.92);
		backdrop-filter: blur(18px);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
		color: ${colors.white};

		/* Laid out as paude's rows were: a column, label over detail */
		& li {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 2px;
			padding: 6px 10px;
			line-height: normal;
			border: none;
			border-radius: 6px;
			white-space: nowrap;
			outline-color: ${colors.lighter(colors.selected)};
		}

		/* Through ul, to outweigh the library Menu's own hover and focus colours */
		& ul li, & ul li:is(:hover, :focus, :focus-visible) {
			color: inherit !important;
		}

		& ul li:is(:hover, :focus-visible) {
			background-color: ${colors.alpha(colors.white, 0.08)};
		}

		& ul li:active {
			background-color: ${colors.alpha(colors.white, 0.14)};
		}

		& ul li:focus-visible {
			outline: auto;
			outline-offset: 0;
		}

		& li .detail {
			margin-top: 0;
		}

		& ul li.heading, & ul li.heading:hover {
			margin: 6px 10px 2px;
			padding: 0;
			border-radius: 0;
			background: none;
			color: hsl(29, 70%, 65%) !important;
		}
	`,
);

let menu = null;

export const closeMenu = () => {
	if (menu?.shown) menu.hide();
};

// A menu under a button, or at a point ({ x, y }): items ({ label, detail, accent, onPress }) and headings
// ({ heading }). One at a time; pressing its button again, Esc, or a press elsewhere closes it.
export const openMenu = (anchor, items) => {
	menu ??= new GlassMenu({ maxWidth: 360 });

	menu.options.items = items.map(item =>
		item.heading
			? { heading: item.heading }
			: {
					textContent: item.label,
					detail: item.detail || undefined,
					...(item.accent && { style: { boxShadow: `inset 3px 0 ${item.accent}` } }),
					// Closed before the item acts, so focus it moves (a panel's field) isn't taken back to the button
					onPointerPress: () => {
						closeMenu();
						item.onPress();
					},
				},
	);
	menu.show(anchor instanceof Element || !Number.isFinite(anchor?.x) ? { anchor } : anchor);
};
