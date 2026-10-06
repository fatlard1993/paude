import path from 'path';

import writeJsonFile from '../shared/writeJsonFile';

// Names pinned in paude. Claude Code's own custom title can't be removed once set, and a session without one keeps
// renaming itself as the conversation goes, so a pin lives here, where clearing it brings the automatic name back.
const MAX_NAME = 80;

let file;
let names = {};

export const initNames = async dataDir => {
	file = path.join(dataDir, 'names.json');
	names = (await Bun.file(file).exists()) ? await Bun.file(file).json() : {};
};

export const pinnedName = sessionId => names[sessionId];

export const pinName = async (sessionId, name) => {
	const trimmed = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '';

	if (trimmed) names[sessionId] = trimmed;
	else delete names[sessionId];

	await writeJsonFile(file, () => names);
};
