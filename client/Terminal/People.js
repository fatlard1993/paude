import { createInvite, getInvites, revokeInvite } from '../api';
import confirmDialog from '../confirmDialog';
import { element } from '../dom';

const ROLES = [
	['drive', 'Drive: type into Claude, and all of the above'],
	['comment', 'Comment: chat, comment, read the files'],
	['watch', 'View: the terminal only'],
];
const EXPIRIES = [
	[1, '1 hour'],
	[24, '1 day'],
	[24 * 7, '7 days'],
];

const select = options => {
	const node = element('select');

	for (const [value, label] of options) {
		const option = element('option', '', label);

		option.value = String(value);
		node.append(option);
	}

	return node;
};

const remaining = expires => {
	const hours = Math.max(0, Math.round((expires - Date.now()) / 3_600_000));

	return hours < 24 ? `${hours}h left` : `${Math.round(hours / 24)}d left`;
};

const copyLink = async (link, button) => {
	try {
		await navigator.clipboard.writeText(link);
		button.textContent = 'Copied';
	} catch {
		// No clipboard outside https or without permission; the link is selectable in its field
		button.textContent = 'Select and copy it';
	}
};

const renderPeople = async sessionId => {
	const nodes = [];
	const form = element('div', 'invite-form');
	const name = element('input');
	const role = select(ROLES);
	const expiry = select(EXPIRIES);
	const create = element('button', '', 'Create invite link');
	const result = element('div', 'invite-result');

	name.placeholder = 'Their name';
	name.maxLength = 40;
	expiry.value = String(24);

	create.addEventListener('click', async () => {
		const { body, response } = await createInvite(sessionId, {
			name: name.value.trim(),
			role: role.value,
			hours: Number(expiry.value),
		});

		if (!response?.ok) {
			result.replaceChildren(element('div', 'empty', typeof body === 'string' ? body : 'Could not create the invite.'));

			return;
		}

		const link = `${window.location.origin}/#/join/${body.token}`;
		const field = element('input');
		const copy = element('button', '', 'Copy');

		field.readOnly = true;
		field.value = link;
		copy.addEventListener('click', () => copyLink(link, copy));
		result.replaceChildren(
			element('div', 'meta', `Send this to ${body.name}. It works until it expires or you revoke it.`),
			field,
			copy,
		);
		name.value = '';
		list.replaceChildren(...(await inviteRows()));
	});

	form.append(name, role, expiry, create);

	const list = element('div', 'invites');
	const inviteRows = async () => {
		const { body: invites } = await getInvites(sessionId);

		if (!invites?.length) return [element('div', 'empty', 'Nobody invited to this session.')];

		return invites.map(invite => {
			const row = element('div', 'comment');
			const revoke = element('button', '', 'Revoke');

			revoke.addEventListener('click', async () => {
				const confirmed = await confirmDialog({
					header: `Revoke ${invite.name}'s invite?`,
					body: 'They are signed out at once, in every browser and terminal they joined from.',
					confirmLabel: 'Revoke',
				});

				if (!confirmed) return;
				await revokeInvite(invite.id);
				list.replaceChildren(...(await inviteRows()));
			});
			row.append(
				element('div', 'text', invite.name),
				element('div', 'meta', `${invite.role} · ${remaining(invite.expires)}`),
				revoke,
			);

			return row;
		});
	};

	list.replaceChildren(...(await inviteRows()));
	nodes.push(
		element(
			'div',
			'meta',
			'Invite someone into this session. They see only this session; revoking ends their access at once.',
		),
		form,
		result,
		list,
	);

	return nodes;
};

export default renderPeople;
