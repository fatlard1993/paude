import { Tabs, styled } from '@vanilla-bean/components';

import { recall, remember } from './storage';

// The library's tabs, underlined in the bar's accent
const Strip = styled(
	Tabs,
	({ colors, space }) => `
		margin-top: ${space.lg};
		overflow: visible;
		border-bottom: 1px solid ${colors.border};

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

	const strip = new Strip({
		appendTo,
		tabs: names.map(({ name, label }) => ({ id: name, label })),
		onChange: ({ value }) => remember(key, value),
	});

	return {
		pane: (name, elem) => (panes[name] = elem),
		count: (name, n) => strip.count(name, n),
		show: name => {
			const wanted = name ?? recall(key);

			strip.options.panels = { ...panes };
			if (wanted in panes) strip.select(wanted);
		},
	};
};
