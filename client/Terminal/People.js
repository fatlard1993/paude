import { Notify, copyToClipboard } from '@vanilla-bean/components';

import { ROLES, ROLE_INFO, roleName } from '../../shared/roles';
import {
	changeInvite,
	createInvite,
	getInvites,
	getPeopleHere,
	renewInviteLink,
	revokeInvite,
	sessionRemote,
} from '../api';
import confirmDialog from '../confirmDialog';
import { button, element } from '../dom';
import { serverName } from '../identity';

const EXPIRIES = [
	[1, 'an hour'],
	[24, 'a day'],
	[24 * 7, 'a week'],
	[24 * 30, 'a month'],
	[24 * 365, 'a year'],
];
const FAMILIES = [
	['One thing, nothing else', ROLES.filter(role => ROLE_INFO[role].only)],
	['Into the session', ROLES.filter(role => !ROLE_INFO[role].only)],
];

const HOUR = 3_600_000;

// "3h", "2d", "5mo": how long, said short
const span = ms => {
	const hours = Math.max(0, ms) / HOUR;

	if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
	if (hours < 24) return `${Math.round(hours)}h`;
	if (hours < 24 * 60) return `${Math.round(hours / 24)}d`;

	return `${Math.round(hours / 24 / 30)}mo`;
};

// The machine the session runs on: another paude's by its address, else this one's name
const where = sessionId => {
	const remote = sessionRemote(sessionId);

	return remote ? new URL(remote).hostname : (serverName() ?? 'this machine');
};

const pairWarning = sessionId =>
	`Claude and the shell run commands as you, on ${where(sessionId)}: give it to someone you'd give that.`;

const field = (label, control) => {
	const wrap = element('label', 'field');

	wrap.append(element('span', 'label', label), control);

	return wrap;
};

const select = (options, value) => {
	const node = element('select');

	for (const [optionValue, label] of options) {
		const option = element('option', '', label);

		option.value = String(optionValue);
		node.append(option);
	}
	if (value !== undefined) node.value = String(value);

	return node;
};

const sayFailed = (body, fallback) =>
	new Notify({ intent: 'danger', content: (typeof body === 'string' && body) || fallback, timeout: 0 });

// A link to send, with a button to copy it; refused, it's still selectable in its field
const linkToSend = (link, about) => {
	const wrap = element('div', 'link-to-send');
	const shown = Object.assign(element('input'), { readOnly: true, value: link });
	const copy = button('Copy', async () => {
		copy.lastChild.textContent = (await copyToClipboard(link)) ? 'Copied' : 'Select and copy it';
	});

	shown.setAttribute('aria-label', 'The invite link');
	shown.addEventListener('focus', () => shown.select());
	wrap.append(element('div', 'meta', about), shown, copy);

	return wrap;
};

// Who's in the session now: each page, terminal or game reading it, under their name, where from and on what role
const hereNow = async sessionId => {
	const section = element('section', 'here');
	const { body } = await getPeopleHere(sessionId).catch(() => ({}));
	const here = body?.here ?? null;

	section.append(element('h3', 'heading', 'Here now'));
	if (!here) {
		section.append(element('div', 'empty', "This paude doesn't say who's here."));

		return section;
	}
	if (!here.length) section.append(element('div', 'empty', "Nobody's in it right now."));

	for (const person of here) {
		const row = element('div', 'person');

		row.append(
			element('span', 'name', person.name),
			element(
				'span',
				'meta',
				[
					person.role === 'owner' ? 'owner' : roleName(person.role),
					person.reading ? `reading from ${person.device}` : person.device,
				].join(' · '),
			),
		);
		if (person.driving) {
			const sizing = element('span', 'tag', 'sized for');

			sizing.title = 'The terminal is laid out for their screen: they typed into it last';
			row.append(sizing);
		}
		section.append(row);
	}

	return section;
};

const inviteRow = (sessionId, invite, { redraw }) => {
	const row = element('div', 'invite');
	const head = element('div', 'invite-head');
	const role = select(
		ROLES.map(id => [id, roleName(id)]),
		invite.role,
	);
	const expiry = select([
		['', `ends in ${span(invite.expires - Date.now())}`],
		...EXPIRIES.map(([hours, label]) => [hours, `ends ${label} from now`]),
	]);
	const extra = element('div', 'invite-extra');

	role.setAttribute('aria-label', `${invite.name}'s role`);
	expiry.setAttribute('aria-label', `When ${invite.name}'s invite ends`);

	role.addEventListener('change', async () => {
		const to = role.value;

		if (
			ROLE_INFO[to].warns &&
			!(await confirmDialog({
				header: `Let ${invite.name} pair?`,
				body: pairWarning(sessionId),
				confirmLabel: 'Pair',
				intent: 'danger',
			}))
		) {
			role.value = invite.role;

			return;
		}

		const { body, response } = await changeInvite(sessionId, invite.id, { role: to });

		if (!response?.ok) {
			role.value = invite.role;

			return sayFailed(body, `Couldn't change ${invite.name}'s role`);
		}
		new Notify({
			intent: 'success',
			content: `${invite.name} is on ${roleName(to)} now; a page of theirs that's open opens again under it`,
		});
		redraw();
	});

	expiry.addEventListener('change', async () => {
		if (!expiry.value) return;

		const { body, response } = await changeInvite(sessionId, invite.id, { hours: Number(expiry.value) });

		if (!response?.ok) return sayFailed(body, `Couldn't change when ${invite.name}'s invite ends`);
		redraw();
	});

	const renew = button(
		'New link',
		async () => {
			const confirmed = await confirmDialog({
				header: `A new link for ${invite.name}?`,
				body: "Their old link stops working. Anyone who already came in on it stays in, until it's revoked.",
				confirmLabel: 'Make a new link',
			});

			if (!confirmed) return;

			const { body, response } = await renewInviteLink(sessionId, invite.id);

			if (!response?.ok) return sayFailed(body, `Couldn't make a new link for ${invite.name}`);
			extra.replaceChildren(linkToSend(body.link, `Send this to ${invite.name}; the old link no longer works.`));
		},
		{ icon: 'link', className: 'variant-flat', title: 'Make a new link: for someone who lost theirs' },
	);
	const revoke = button(
		'Revoke',
		async () => {
			const confirmed = await confirmDialog({
				header: `Revoke ${invite.name}'s invite?`,
				body: 'They are signed out at once, in every browser and terminal they came in from.',
				confirmLabel: 'Revoke',
				intent: 'danger',
			});

			if (!confirmed) return;

			const { body, response } = await revokeInvite(sessionId, invite.id);

			if (!response?.ok) return sayFailed(body, `Couldn't revoke ${invite.name}'s invite`);
			redraw();
		},
		{ className: 'variant-flat danger' },
	);

	head.append(element('span', 'name', invite.name), role, expiry);
	row.append(
		head,
		element('div', 'meta', invite.seen ? `came in ${span(Date.now() - invite.seen)} ago` : "hasn't come in yet"),
		element('div', 'actions'),
		extra,
	);
	row.querySelector('.actions').append(renew, revoke);

	return row;
};

const invited = async (sessionId, { redraw }) => {
	const section = element('section', 'invited');
	const { body, response } = await getInvites(sessionId).catch(() => ({}));

	section.append(element('h3', 'heading', 'Invited'));
	if (!response?.ok) {
		section.append(
			element('div', 'empty', "Couldn't load the invites."),
			button('Try again', redraw, { className: 'variant-flat' }),
		);

		return section;
	}
	if (!body.length) section.append(element('div', 'empty', 'Nobody invited yet.'));
	for (const invite of body) section.append(inviteRow(sessionId, invite, { redraw }));

	return section;
};

// Naming someone, what they get, and for how long; then the link to send them
const inviteForm = (sessionId, { redraw }) => {
	const section = element('section', 'invite-someone');
	const name = Object.assign(element('input'), { placeholder: 'Their name', maxLength: 40 });
	const roles = element('div', 'roles');
	const expiry = select(
		EXPIRIES.map(([hours, label]) => [hours, `For ${label}`]),
		24,
	);
	const warning = element('div', 'warning');
	const result = element('div', 'result');
	let picked = 'comment';

	const pick = role => {
		picked = role;
		for (const choice of roles.querySelectorAll('.role'))
			choice.setAttribute('aria-checked', String(choice.dataset.role === role));
		warning.textContent = ROLE_INFO[role].warns ? pairWarning(sessionId) : '';
		warning.hidden = !ROLE_INFO[role].warns;
	};

	roles.setAttribute('role', 'radiogroup');
	roles.setAttribute('aria-label', 'What they get');
	for (const [family, members] of FAMILIES) {
		roles.append(element('div', 'family', family));
		for (const role of members) {
			const choice = button('', () => pick(role), { className: 'role variant-flat' });

			choice.setAttribute('role', 'radio');
			choice.dataset.role = role;
			choice.append(element('span', 'name', ROLE_INFO[role].name), element('span', 'opens', ROLE_INFO[role].opens));
			roles.append(choice);
		}
	}

	const create = button(
		'Make the link',
		async () => {
			if (!name.value.trim()) {
				name.setCustomValidity('Who is it for?');
				name.reportValidity();

				return;
			}

			const { body, response } = await createInvite(sessionId, {
				name: name.value.trim(),
				role: picked,
				hours: Number(expiry.value),
			});

			if (!response?.ok) return sayFailed(body, "Couldn't make the invite");
			result.replaceChildren(
				linkToSend(body.link, `Send this to ${body.name}. It works until it ends or you revoke it.`),
			);
			name.value = '';
			redraw();
		},
		{ icon: 'user-plus' },
	);

	name.addEventListener('input', () => name.setCustomValidity(''));
	name.addEventListener('keydown', event => event.key === 'Enter' && create.click());
	expiry.setAttribute('aria-label', 'How long it lasts');
	pick(picked);
	section.append(
		element('h3', 'heading', 'Invite someone'),
		field('Name', name),
		roles,
		warning,
		element('div', 'make'),
		result,
	);
	section.querySelector('.make').append(expiry, create);

	return section;
};

// The session's people, for its owner: who's here, who's invited and on what, and inviting someone. `appendTo` is
// filled, and filled again as invites change, keeping the form (and a link just made) as it is. Answers how to fill it
// all again (`redraw`) and who's here alone (`refreshHere`), which leaves a row being changed as it is.
const renderPeople = async (sessionId, appendTo) => {
	let here;
	const redraw = async () => {
		const [shown, list] = await Promise.all([hereNow(sessionId), invited(sessionId, { redraw })]);

		here = shown;
		appendTo.replaceChildren(here, list, form);
	};
	const refreshHere = async () => {
		const shown = await hereNow(sessionId);

		if (here?.isConnected) here.replaceWith(shown);
		here = shown;
	};
	const form = inviteForm(sessionId, { redraw });

	await redraw();

	return { redraw, refreshHere };
};

export default renderPeople;
