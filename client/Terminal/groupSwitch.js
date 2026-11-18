import { button, element } from '../dom';
import { GROUPS, groupOf, sectionsOf } from './panels';

// A grouped panel's title in its bar becomes a switch between it and the rest of its group the viewer has
// (`present`), `show(key)` opening one; a panel alone keeps its title
export const groupSwitch = (panel, key, present, show) => {
	const sections = sectionsOf(key, present);
	const title = panel.bar?.querySelector(':scope > .branch');

	if (sections.length < 2 || !title) return;

	const strip = element('div', 'tabs section-switch');

	for (const each of sections) {
		const tab = button(GROUPS[groupOf(key)].members[each], () => show(each), { className: 'variant-flat' });

		tab.classList.toggle('active', each === key);
		strip.append(tab);
	}
	title.replaceWith(strip);
};
