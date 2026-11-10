import { Notify } from '@vanilla-bean/components';

import confirmDialog from '../confirmDialog';
import { button, element } from '../dom';
import { readingSelect } from './makeArcade';

// The owner's way to give someone their own arcade (a game maker): a link that, opened on their device, keeps them
// logged in to make games and come back to them, each game one session. Who has one is listed, with how many games
// they've made, and can be taken back.
const makersPanel = () => {
	const panel = element('div', 'makers');
	const opener = element('button', 'open-form variant-flat', '🕹️ Give someone their own arcade');
	const form = element('form', 'new-maker');
	const name = element('input');
	const { reading, hint } = readingSelect();
	const give = element('button', '', 'Make their link');
	const result = element('div', 'meta');
	const list = element('div', 'meta');

	name.placeholder = 'Their name';
	name.setAttribute('aria-label', 'Their name');
	name.maxLength = 40;
	opener.type = 'button';
	form.append(name, reading, give, hint, result);
	panel.append(opener, form, list);

	const refresh = async () => {
		const response = await fetch('/api/makers').catch(() => null);
		const makers = response?.ok ? await response.json() : [];

		list.replaceChildren(
			...makers.map(maker => {
				const row = element('div', '', `${maker.name}: ${maker.games} ${maker.games === 1 ? 'game' : 'games'} `);

				row.append(
					button(
						'Take it back',
						async () => {
							const confirmed = await confirmDialog({
								header: `Take back ${maker.name}'s arcade?`,
								body: 'Their link stops working and they lose their way into their games. The games and their sessions stay yours.',
								confirmLabel: 'Take it back',
								intent: 'danger',
							});

							if (!confirmed) return;
							await fetch(`/api/invites/${maker.id}`, { method: 'DELETE' });
							refresh();
						},
						{ className: 'variant-flat' },
					),
				);

				return row;
			}),
		);
	};

	opener.addEventListener('click', () => {
		panel.classList.toggle('open');
		if (panel.classList.contains('open')) name.focus();
	});

	form.addEventListener('submit', async event => {
		event.preventDefault();

		const response = await fetch('/api/makers', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: name.value.trim(), reading: reading.value }),
		}).catch(() => null);

		if (!response?.ok) {
			new Notify({ intent: 'danger', content: response ? await response.text() : 'Could not reach the server.' });

			return;
		}

		const { link, name: given } = await response.json();
		const shown = element('a', '', link);

		shown.href = link;
		result.replaceChildren(`Open this on ${given}'s device, once: `, shown);
		navigator.clipboard?.writeText(link).then(
			() => new Notify({ intent: 'success', content: 'Link copied' }),
			() => {},
		);
		name.value = '';
		refresh();
	});

	refresh();

	return panel;
};

export default makersPanel;
