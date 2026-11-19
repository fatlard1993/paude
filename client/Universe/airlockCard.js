import { roleName } from '../../shared/roles';
import { button, element } from '../dom';
import { heading } from './replyCard';

// The airlock's card: who's come aboard, by the session each came in to, those with someone aboard first; each
// session's People (`onPeople`) to invite someone into it or change who may. `aboard`: [{ session, guests }], the
// guests as the ship has them ({ name, role }).
export const airlockCard = ({ aboard, onPeople, onClose }) => {
	const card = element('div', 'reply-card airlock-card');
	const count = aboard.reduce((total, { guests }) => total + guests.length, 0);

	card.append(
		heading(
			'Airlock',
			count ? `${count} aboard by invite` : "Nobody's come aboard by invite: each session's People invites them",
			onClose,
		),
	);
	if (!aboard.length) {
		card.append(element('div', 'about', 'No session of this machine aboard to invite anyone into'));

		return card;
	}

	const list = element('div', 'aboard');

	for (const { session, guests } of [...aboard].sort((a, b) => b.guests.length - a.guests.length)) {
		const row = element('div', 'aboard-session');
		const head = element('div', 'aboard-head');

		head.append(
			element('span', 'title', session.title || session.project || 'A new session'),
			button('People', () => onPeople(session), {
				icon: 'user-plus',
				className: 'variant-flat',
				title: `Who may come aboard ${session.title || 'this session'}, and inviting someone`,
			}),
		);
		row.append(head);
		for (const guest of guests) row.append(element('div', 'guest', `${guest.name} · ${roleName(guest.role)}`));
		list.append(row);
	}
	card.append(list);

	return card;
};
