import { element } from '../dom';
import renderPeople from '../Terminal/People';
import { heading } from './replyCard';

// The airlock's card: a session aboard picked (`chosen` first, if it's one of them), and its invites under it, to make
// a link or revoke one, as its People panel has them
export const airlockCard = ({ sessions, chosen, onClose }) => {
	const card = element('div', 'reply-card airlock-card');
	const picker = element('select');
	const people = element('div', 'people');

	card.append(heading('Airlock', 'Who may come aboard, a session at a time', onClose));
	if (!sessions.length) {
		card.append(element('div', 'about', 'No session of this machine aboard to invite anyone into'));

		return card;
	}

	for (const session of sessions) {
		const option = element('option', '', session.title || session.project || 'A new session');

		option.value = session.id;
		picker.append(option);
	}
	if (sessions.some(({ id }) => id === chosen?.id)) picker.value = chosen.id;

	const show = async () => {
		const id = picker.value;
		const nodes = await renderPeople(id);

		// Only the session still picked: one picked meanwhile shows instead
		if (picker.value === id) people.replaceChildren(...nodes);
	};

	picker.addEventListener('change', show);
	card.append(picker, people);
	show();

	return card;
};
