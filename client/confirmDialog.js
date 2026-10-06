import { Dialog } from '@vanilla-bean/components';

// Resolves to whether the confirming button was pressed. Confirm is second because the dialog focuses its first
// button, so a reflexive Enter keeps things as they are; any other way out (backdrop, Escape) is a no.
const confirmDialog = ({ header, body, cancelLabel = 'Cancel', confirmLabel }) =>
	new Promise(resolve => {
		const dialog = new Dialog({
			size: 'small',
			header,
			body,
			buttons: [cancelLabel, confirmLabel],
			onButtonPress: ({ button, closeDialog }) => {
				resolve(button === confirmLabel);
				closeDialog();
			},
			onClose: () => {
				resolve(false);
				setTimeout(() => dialog.elem.remove(), 400);
			},
		});
	});

export default confirmDialog;

export const confirmDeleteSession = async (session, deleteSession) => {
	const confirmed = await confirmDialog({
		header: `Delete "${session.title || 'this session'}"?`,
		body: 'Its conversation, chat and comments are removed, and anyone invited to it loses access. This cannot be undone.',
		confirmLabel: 'Delete',
	});

	if (!confirmed) return false;

	const { response } = await deleteSession(session.id);

	return Boolean(response?.ok);
};

// Resolves to the new name, '' to go back to the automatic one, or null when left as it was
export const nameDialog = ({ current, pinned }) =>
	new Promise(resolve => {
		const input = document.createElement('input');
		const AUTOMATIC = 'Use automatic name';
		const finish = value => {
			resolve(value);
			dialog.close();
		};

		input.value = current ?? '';
		input.placeholder = 'Session name';
		input.style.width = '100%';
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') finish(input.value.trim() || '');
		});

		const dialog = new Dialog({
			size: 'small',
			header: 'Name this session',
			body: input,
			buttons: ['Cancel', ...(pinned ? [AUTOMATIC] : []), 'Save'],
			onButtonPress: ({ button }) => {
				if (button === 'Save') finish(input.value.trim());
				else if (button === AUTOMATIC) finish('');
				else finish(null);
			},
			onClose: () => {
				resolve(null);
				setTimeout(() => dialog.elem.remove(), 400);
			},
		});
		setTimeout(() => input.select());
	});
