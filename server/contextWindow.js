import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import { claudeHome } from './sessions/transcript';

// A model's context window, in tokens: as chosen in Claude's settings ("opus[1m]" for the million), since the
// transcript names the model alone ("claude-opus-5-5") whichever window it runs with
export const WINDOWS = { usual: 200_000, million: 1_000_000 };

// The model a session started in `cwd` runs, as Claude picks it: from the environment, else the project's local
// settings, its shared settings, then the user's
export const modelFor = async (cwd, env = process.env) => {
	if (env.ANTHROPIC_MODEL) return env.ANTHROPIC_MODEL;

	for (const file of [
		...(cwd ? [path.join(cwd, '.claude', 'settings.local.json'), path.join(cwd, '.claude', 'settings.json')] : []),
		path.join(claudeHome(), 'settings.json'),
	]) {
		const { model } = (await readJsonFile(file, {})) ?? {};

		if (typeof model === 'string' && model) return model;
	}

	return null;
};

// The window a session's context of `tokens` fills: the million when its model is chosen with it, or when it holds
// more than the usual window could; the usual one otherwise
export const windowFor = (model, tokens) =>
	/\[1m\]\s*$/i.test(model ?? '') || tokens > WINDOWS.usual ? WINDOWS.million : WINDOWS.usual;
