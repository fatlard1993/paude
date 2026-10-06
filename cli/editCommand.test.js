import { chmod, mkdtemp } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { beforeAll, expect, test } from 'bun:test';

import editCommand from './editCommand';

let folder;

// An "editor" that says which one it is and what it was asked to open
const fakeEditor = async name => {
	const path = join(folder, name);

	await Bun.write(path, `#!/bin/sh\necho "${name} opened [$*]"\n`);
	await chmod(path, 0o755);

	return path;
};

beforeAll(async () => {
	folder = await mkdtemp(join(os.tmpdir(), 'paude-edit-'));
});

const run = env =>
	Bun.spawnSync(['sh', '-c', editCommand("it's here.md")], { env: { PATH: process.env.PATH, ...env }, stdout: 'pipe' })
		.stdout.toString()
		.trim();

test('the named terminal editor opens the file, quotes and all; a desktop editor is passed over', async () => {
	expect(run({ PAUDE_EDITOR: await fakeEditor('nano') })).toBe("nano opened [it's here.md]");
	expect(run({ VISUAL: '/usr/local/bin/code', EDITOR: await fakeEditor('vim') })).toBe("vim opened [it's here.md]");
});
