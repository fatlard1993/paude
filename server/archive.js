import path from 'path';

import writeJsonFile from '../shared/writeJsonFile';
import readJsonFile from '../shared/readJsonFile';

// Sessions put away: out of the lists unless asked for, found by search, and back as soon as one is opened again.
// For everyone, as a session's name is: { [sessionId]: when }
let file;
let archived = {};

export const initArchive = async dataDir => {
	file = path.join(dataDir, 'archived.json');
	archived = await readJsonFile(file, {});
};

export const isArchived = sessionId => sessionId in archived;

export const setArchived = async (sessionIds, on) => {
	let changed = false;

	for (const id of sessionIds) {
		if (on === isArchived(id)) continue;
		if (on) archived[id] = Date.now();
		else delete archived[id];
		changed = true;
	}

	if (changed) await writeJsonFile(file, () => archived);
};
