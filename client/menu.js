import { ContextMenu, styled } from '@vanilla-bean/components';

// The library's menu in paude's glass: flat rows, a second line for detail, small warm headings
const GlassMenu = styled(
	ContextMenu,
	({ colors, radius }) => `
		min-width: 240px;
		max-width: min(360px, calc(100vw - 16px)) !important;
		padding: 4px;
		border-radius: ${radius.lg};
		border: 1px solid ${colors.border};
		background: ${colors.alpha(colors.black, 0.92)};
		backdrop-filter: blur(18px);
		box-shadow: 0 8px 32px ${colors.alpha(colors.vantablack, 0.45)};
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
			border-radius: ${radius.md};
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

		/* A menu with marks (a check on the current choice) leaves them a column, so every label starts in line */
		&.marked ul li:not(.heading) {
			position: relative;
			padding-left: 30px;
		}

		& ul li.fa-support:before {
			position: absolute;
			left: 10px;
			top: 6px;
			font-size: 0.85em;
			line-height: 1.4;
		}

		& ul li.heading, & ul li.heading:hover {
			margin: 6px 10px 2px;
			padding: 0;
			border-radius: 0;
			background: none;
			color: ${colors.light(colors.orange)} !important;
		}
	`,
);

let menu = null;

export const closeMenu = () => {
	if (menu?.shown) menu.hide();
};

// A menu under a button, or at a point ({ x, y }): items ({ label, detail, icon, accent, onPress }) and headings
// ({ heading }); an item's icon marks it, as a check marks the current choice. One at a time; pressing its button
// again, Esc, or a press elsewhere closes it.
export const openMenu = (anchor, items) => {
	menu ??= new GlassMenu({ maxWidth: 360 });

	menu.options.items = items.map(item =>
		item.heading
			? { heading: item.heading }
			: {
					textContent: item.label,
					detail: item.detail || undefined,
					...(item.icon && { icon: item.icon }),
					...(item.accent && { style: { boxShadow: `inset 3px 0 ${item.accent}` } }),
					// Closed before the item acts, so focus it moves (a panel's field) isn't taken back to the button
					onPointerPress: () => {
						closeMenu();
						item.onPress();
					},
				},
	);
	menu.toggleClass(
		'marked',
		items.some(item => item.icon),
	);
	menu.show(anchor instanceof Element || !Number.isFinite(anchor?.x) ? { anchor } : anchor);
};

const HOLD_MS = 500;
const HOLD_SLOP_PX = 10;
// The click that ends a press-and-hold is part of the hold, not a tap on what was held
const HELD_CLICK_MS = 800;

// A right click on `elem`, or on touch a press held still, opens the menu `items()` gives at that point
export const contextMenu = (elem, items) => {
	let timer;
	let start = null;
	let heldAt = 0;
	const open = at => {
		const listed = items();

		if (listed.length) openMenu(at, listed);
	};
	const cancel = () => {
		clearTimeout(timer);
		start = null;
	};

	elem.addEventListener('contextmenu', event => {
		event.preventDefault();
		event.stopPropagation();
		if (Date.now() - heldAt > HELD_CLICK_MS) open({ x: event.clientX, y: event.clientY });
	});
	elem.addEventListener('pointerdown', event => {
		if (event.pointerType !== 'touch') return;

		start = { x: event.clientX, y: event.clientY };
		timer = setTimeout(() => {
			heldAt = Date.now();
			open(start);
		}, HOLD_MS);
	});
	elem.addEventListener('pointermove', event => {
		if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > HOLD_SLOP_PX) cancel();
	});
	for (const type of ['pointerup', 'pointercancel', 'pointerleave']) elem.addEventListener(type, cancel);
	elem.addEventListener(
		'click',
		event => {
			if (Date.now() - heldAt > HELD_CLICK_MS) return;
			event.preventDefault();
			event.stopImmediatePropagation();
		},
		true,
	);
};
