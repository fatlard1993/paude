import { Tabs, styled } from '@vanilla-bean/components';

import { recall, remember } from './storage';

// The library's tabs, underlined in the bar's accent
const Strip = styled(
	Tabs,
	({ colors }) => `
		margin-top: 16px;
		overflow: visible;
		border-bottom: 1px solid ${colors.alpha(colors.white, 0.08)};

		& > .vbc-button {
			border-radius: 0;
		}

		& > .vbc-button[aria-selected='true'] {
			border-bottom-color: var(--bar-accent, ${colors.blue});
			font-weight: normal;
		}
	`,
);

// One pane at a time under a row of tabs ([{ name, label }]), each with a count beside its name; the last one open
// is remembered under `key`. Returns { pane(name, elem), count(name, n), show(name) }; show the first once the panes
// are in.
export const tabs = ({ appendTo, key, names }) => {
	const panes = {};

	// By display rather than the hidden attribute, which a pane's own display: flex would override
	const showPanes = name => {
		remember(key, name);
		for (const [pane, elem] of Object.entries(panes)) elem.style.display = pane === name ? '' : 'none';
	};

	const strip = new Strip({
		appendTo,
		tabs: names.map(({ name, label }) => ({ id: name, label })),
		onChange: showPanes,
	});

	return {
		pane: (name, elem) => (panes[name] = elem),
		count: (name, n) => strip.count(name, n),
		show: name => {
			const wanted = name ?? recall(key);

			if (wanted in panes) strip.select(wanted);
			showPanes(strip.options.selected);
		},
	};
};
