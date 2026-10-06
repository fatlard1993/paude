import os from 'os';
import path from 'path';

import updateJsonFile from '../shared/updateJsonFile';

const file = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'paude', 'prefs.json');

export const DEFAULT_PREFS = {
	markdownView: 'rendered',
	search: { caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '' },
};

export const loadPrefs = async () => {
	try {
		const stored = await Bun.file(file).json();

		return { ...DEFAULT_PREFS, ...stored, search: { ...DEFAULT_PREFS.search, ...stored.search } };
	} catch {
		return structuredClone(DEFAULT_PREFS);
	}
};

export const savePrefs = prefs => updateJsonFile(file, DEFAULT_PREFS, () => prefs);
