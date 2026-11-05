import path from 'path';

import { MODEL_NAMES } from '../shared/models';
import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';

// The model each session was started on, by hand or as suggested, so it's resumed on it too: Claude Code takes up a
// resumed conversation on the default model otherwise. { [sessionId]: model }
let file;
let models = {};

export const initSessionModels = async dataDir => {
	file = path.join(dataDir, 'session-models.json');
	models = await readJsonFile(file, {});
};

export const modelOf = id => (MODEL_NAMES.includes(models[id]) ? models[id] : undefined);

// One of MODEL_NAMES, or anything else for the default
export const setModel = async (id, model) => {
	if (MODEL_NAMES.includes(model)) models[id] = model;
	else if (id in models) delete models[id];
	else return;
	if (file) await writeJsonFile(file, () => models);
};
