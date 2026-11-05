import { expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { WINDOWS, modelFor, windowFor } from './contextWindow';

test("a session's window is the million when its model is chosen with it, or it holds more than the usual could", () => {
	expect(windowFor('opus[1m]', 167_747)).toBe(WINDOWS.million);
	expect(windowFor('claude-opus-5-5[1M]', 10)).toBe(WINDOWS.million);
	expect(windowFor('opus', 167_747)).toBe(WINDOWS.usual);
	expect(windowFor(null, 167_747)).toBe(WINDOWS.usual);
	expect(windowFor('opus', 385_176)).toBe(WINDOWS.million);
});

test('the model is the environment\'s, else the project\'s local settings, its shared ones, then the user\'s', async () => {
	const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paude-window-home-'));
	const project = await fs.mkdtemp(path.join(os.tmpdir(), 'paude-window-project-'));
	const write = (dir, name, model) =>
		fs.mkdir(path.join(dir, '.claude'), { recursive: true }).then(() =>
			fs.writeFile(path.join(dir, '.claude', name), JSON.stringify({ model })),
		);
	const was = process.env.CLAUDE_CONFIG_DIR;

	process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
	try {
		await write(home, 'settings.json', 'opus[1m]');
		expect(await modelFor(project, {})).toBe('opus[1m]');
		await write(project, 'settings.json', 'sonnet');
		expect(await modelFor(project, {})).toBe('sonnet');
		await write(project, 'settings.local.json', 'haiku');
		expect(await modelFor(project, {})).toBe('haiku');
		expect(await modelFor(project, { ANTHROPIC_MODEL: 'opus' })).toBe('opus');
	} finally {
		if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = was;
	}
});
