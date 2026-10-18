import { Elem, styled } from '@vanilla-bean/components';

import { button, element } from './dom';
import { recall, remember } from './storage';

const Strip = styled(
	Elem,
	({ colors }) => `
		display: flex;
		gap: 4px;
		margin-top: 16px;
		border-bottom: 1px solid ${colors.alpha(colors.white, 0.08)};

		button {
			margin-bottom: -1px;
			padding: 6px 12px;
			border-bottom: 2px solid transparent;
			border-radius: 0;
			color: ${colors.light(colors.gray)};
			font: inherit;
		}

		button:hover {
			color: ${colors.white};
		}

		button.active {
			border-bottom-color: var(--bar-accent, ${colors.blue});
			color: ${colors.white};
		}

		.count {
			margin-left: 6px;
			color: ${colors.light(colors.gray)};
			font-size: 0.8em;
		}
	`,
);

// One pane at a time under a row of tabs ([{ name, label }]), each with a count beside its name; the last one open
// is remembered under `key`. Returns { pane(name, elem), count(name, n), show(name) }; show the first once the panes
// are in.
export const tabs = ({ appendTo, key, names }) => {
	const strip = new Strip({ appendTo });
	const panes = {};
	const counts = {};

	const show = name => {
		const shown = name in panes ? name : names[0].name;

		remember(key, shown);
		for (const [pane, elem] of Object.entries(panes)) elem.style.display = pane === shown ? '' : 'none';
		for (const node of strip.elem.children) node.classList.toggle('active', node.dataset.tab === shown);
	};

	for (const { name, label } of names) {
		const count = element('span', 'count');
		const node = button(label, () => show(name), { className: 'variant-flat' });

		node.append(count);
		node.dataset.tab = name;
		strip.elem.append(node);
		counts[name] = count;
	}

	return {
		pane: (name, elem) => (panes[name] = elem),
		count: (name, n) => (counts[name].textContent = n || ''),
		show: name => show(name ?? recall(key)),
	};
};
