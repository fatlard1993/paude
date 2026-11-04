import { Notify } from '@vanilla-bean/components';

import { attachFile } from '../api';

// Files dropped or pasted onto a terminal's screen, saved on the server for the session and their paths handed to
// `paste`, for Claude's prompt (`base` for another paude's session, through this one) (an image's path becomes an attached image); a text paste still goes through as typing
export const acceptFiles = (screen, sessionId, paste, base = '') => {
	const carriesFiles = event => event.dataTransfer?.types.includes('Files');
	const attach = async files => {
		const paths = [];

		for (const file of files) {
			const { response, body } = await attachFile(sessionId, file, base);

			if (response.ok) paths.push(body.path);
			else new Notify({ intent: 'warning', content: `${file.name || 'The file'} wasn't attached: ${body}` });
		}
		if (paths.length) paste(`${paths.join(' ')} `);
	};

	screen.addEventListener('dragover', event => {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		screen.classList.add('dropping');
	});
	screen.addEventListener('dragleave', () => screen.classList.remove('dropping'));
	screen.addEventListener('drop', event => {
		screen.classList.remove('dropping');
		if (!carriesFiles(event)) return;
		event.preventDefault();
		attach([...event.dataTransfer.files]);
	});
	screen.addEventListener(
		'paste',
		event => {
			const files = [...(event.clipboardData?.files ?? [])];

			if (!files.length) return;
			event.preventDefault();
			event.stopPropagation();
			attach(files);
		},
		true,
	);
};
