import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { parseEnvFile, sessionEnvironmentView } from './environment';
import { replaceInProject } from './files';
import gitEnvironment from './utils/gitEnvironment';

let cwd;

beforeAll(async () => {
	cwd = await mkdtemp(path.join(os.tmpdir(), 'paude-replace-'));
	Bun.spawnSync(['git', 'init', '-q'], { cwd, env: gitEnvironment() });
	await writeFile(path.join(cwd, 'a.js'), 'const total = add(1);\nconst subtotal = add(2);\n');
	await writeFile(path.join(cwd, 'b.js'), 'add(3); // add more\n');
	await writeFile(path.join(cwd, '.env'), 'API_KEY="abc123"\nexport PORT=3000\n# a comment\n');
	await writeFile(path.join(cwd, 'c.txt'), 'nothing here\n');
});

afterAll(() => rm(cwd, { recursive: true, force: true }));

const read = name => Bun.file(path.join(cwd, name)).text();

test('replaces a whole word across the project, literally', async () => {
	expect(await replaceInProject(cwd, 'total', 'sum', { wholeWord: true, caseSensitive: true })).toEqual({
		files: 1,
		replacements: 1,
	});
	expect(await read('a.js')).toBe('const sum = add(1);\nconst subtotal = add(2);\n');
});

test("a regular expression's replacement can use its groups", async () => {
	expect(await replaceInProject(cwd, 'add\\((\\d)\\)', 'plus($1, 0)', { regex: true })).toEqual({
		files: 2,
		replacements: 3,
	});
	expect(await read('b.js')).toBe('plus(3, 0); // add more\n');
});

test('reads .env files as dotenv does, and never sends their values', async () => {
	expect(parseEnvFile('API_KEY="abc"\nexport PORT=3000\n# no')).toEqual([
		{ name: 'API_KEY', value: 'abc' },
		{ name: 'PORT', value: '3000' },
	]);

	const { files } = await sessionEnvironmentView(cwd);

	expect(files).toEqual([
		{
			file: '.env',
			variables: [
				{ name: 'API_KEY', value: '•••• (6 characters)' },
				{ name: 'PORT', value: '•••• (4 characters)' },
			],
		},
	]);
});
