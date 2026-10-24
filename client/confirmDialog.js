import { Dialog, Notify } from '@vanilla-bean/components';

import { element } from './dom';

// Resolves to whether the confirming button was pressed
const confirmDialog = ({ header, body, cancelLabel = 'Cancel', confirmLabel }) =>
	Dialog.confirm({ size: 'small', header, body, cancelLabel, confirmLabel });

export default confirmDialog;

export const confirmDeleteSession = async (session, deleteSession) => {
	const confirmed = await confirmDialog({
		header: `Delete "${session.title || 'this session'}"?`,
		body: 'Its conversation, chat and comments are removed, and anyone invited to it loses access. This cannot be undone.',
		confirmLabel: 'Delete',
	});

	if (!confirmed) return false;

	const { response, body } = await deleteSession(session.id);

	// The last session in a worktree paude made takes the worktree with it, unless it has changes
	if (response?.ok && body?.worktree) {
		new Notify(
			body.removed
				? { intent: 'success', content: `Worktree ${body.worktree} removed too; its branch stays.` }
				: { intent: 'warning', content: `Kept worktree ${body.worktree}: ${body.why}`, timeout: 10_000 },
		);
	}

	return Boolean(response?.ok);
};

// Resolves to the new name, '' to go back to the automatic one, or null when left as it was
// `select` is the [start, end] of the current text picked to type over, all of it unless given
export const nameDialog = ({
	current,
	pinned,
	header = 'Name this session',
	placeholder = 'Session name',
	confirmLabel = 'Save',
	select,
}) =>
	new Promise(resolve => {
		const input = element('input');
		const AUTOMATIC = 'Use automatic name';
		const finish = value => {
			resolve(value);
			dialog.close();
		};

		input.value = current ?? '';
		input.placeholder = placeholder;
		input.style.width = '100%';
		input.addEventListener('keydown', event => {
			// Left to itself, the Enter would go on to press the button focus returns to
			if (event.key !== 'Enter') return;

			event.preventDefault();
			finish(input.value.trim() || '');
		});

		const dialog = new Dialog({
			size: 'small',
			header,
			body: input,
			buttons: ['Cancel', ...(pinned ? [AUTOMATIC] : []), confirmLabel],
			onButtonPress: ({ button }) => {
				if (button === confirmLabel) finish(input.value.trim());
				else if (button === AUTOMATIC) finish('');
				else finish(null);
			},
			onClose: () => resolve(null),
		});
		setTimeout(() => {
			input.focus();
			input.setSelectionRange(...(select ?? [0, input.value.length]));
		});
	});
