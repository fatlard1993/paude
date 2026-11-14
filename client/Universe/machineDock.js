import { Notify } from '@vanilla-bean/components';

import { button, element } from '../dom';
import FilesPanel from '../Terminal/FilesPanel';
import { PANELS, panelTitle } from '../Terminal/panels';
import SideShell from '../Terminal/SideShell';
import { heading } from './replyCard';

// What the machine's sidebar holds, as a session's dock holds its panels
export const MACHINE_VERBS = [
	{ key: 'files', hotkey: 'f' },
	{ key: 'shell', hotkey: 's' },
].map(verb => ({ ...verb, label: PANELS[verb.key].label }));

// A machine's own Files and Shell docked beside the universe, in its home folder: this paude's, or another's
// (`remote`, its address) through this one. No Claude stands behind it, so there's no prompt to attach anything to.
export const machineDock = ({ engine, remote, open = 'files', onClose }) => {
	const card = element('div', 'dock');
	const tabs = element('div', 'tabs');
	const body = element('div', 'body');
	const panels = new Map();
	const place = { machine: true, ...(remote && { remote }) };
	let showing;

	for (const { key, label, hotkey } of MACHINE_VERBS) {
		const tab = button(label, () => card.show(key), {
			icon: PANELS[key].icon,
			className: 'variant-flat',
			title: `${panelTitle(key)} (${hotkey})`,
		});

		tab.dataset.verb = key;
		tabs.append(tab);
	}
	card.append(heading(engine.name, 'its home folder', onClose, { close: 'Close' }), tabs, body);

	const common = key => ({ appendTo: body, place, close: onClose, addClass: ['docked', key] });
	const make = {
		files: () => new FilesPanel({ ...common('files'), setFullscreen: () => {} }),
		shell: () =>
			new SideShell({
				...common('shell'),
				ended: why => why && new Notify({ intent: 'warning', content: why }),
			}),
	};

	card.show = key => {
		if (!panels.has(key)) panels.set(key, make[key]());

		const shown = panels.get(key);

		if (showing !== key) {
			for (const [other, { elem }] of panels) elem.hidden = other !== key;
			for (const tab of tabs.children) tab.classList.toggle('active', tab.dataset.verb === key);
			if (showing === 'shell') panels.get('shell')?.stop();
			showing = key;
			if (key === 'shell') shown.start();
			else shown.refresh?.();
		}

		return shown;
	};

	card.opened = () => card.show(open);

	card.dispose = () => {
		for (const shown of panels.values()) {
			shown.stop?.();
			shown.dropEditor?.();
			shown.elem.remove();
		}
	};

	return card;
};
