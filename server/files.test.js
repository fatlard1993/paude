import { mkdir, mkdtemp, symlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeAll, expect, test } from 'bun:test';

import { SearchError, listFiles, readProjectFile, searchProject } from './files';
import gitEnvironment from './utils/gitEnvironment';

let project;
let outside;

beforeAll(async () => {
	project = await mkdtemp(path.join(os.tmpdir(), 'paude-files-'));
	outside = await mkdtemp(path.join(os.tmpdir(), 'paude-outside-'));

	await mkdir(path.join(project, 'src'));
	await Bun.write(path.join(project, 'src/app.js'), 'const greeting = "Hello";\nexport default greeting;\n');
	await Bun.write(path.join(project, 'notes.md'), 'nothing to see\n');
	await Bun.write(path.join(project, '.env'), 'SECRET=1\n');
	await Bun.write(path.join(project, '.gitignore'), '.env\n');
	await Bun.write(path.join(project, 'image.bin'), new Uint8Array([1, 0, 2, 0]));
	await Bun.write(path.join(outside, 'private.txt'), 'outside the project\n');
	await symlink(path.join(outside, 'private.txt'), path.join(project, 'escape.txt'));

	Bun.spawnSync(['git', 'init', '-q'], { cwd: project, env: gitEnvironment() });
	Bun.spawnSync(['git', 'add', 'src/app.js', '.gitignore'], { cwd: project, env: gitEnvironment() });
});

test('lists what git would show, leaving ignored files out', async () => {
	const files = await listFiles(project);

	expect(files).toContain('src/app.js');
	expect(files).toContain('notes.md');
	expect(files).not.toContain('.env');
});

test('reads listed text files and refuses everything else', async () => {
	expect(await readProjectFile(project, 'src/app.js')).toMatchObject({
		status: 200,
		text: expect.stringContaining('Hello'),
	});
	expect((await readProjectFile(project, '.env')).status).toBe(404);
	expect((await readProjectFile(project, '../../etc/passwd')).status).toBe(404);
	expect((await readProjectFile(project, 'escape.txt')).status).toBe(404);
	expect((await readProjectFile(project, 'image.bin')).status).toBe(415);
});

test('searches contents case-insensitively, tracked or not, never ignored files', async () => {
	expect(await searchProject(project, 'hello')).toEqual([
		{ path: 'src/app.js', line: 1, text: 'const greeting = "Hello";' },
	]);
	expect(await searchProject(project, 'nothing to')).toEqual([{ path: 'notes.md', line: 1, text: 'nothing to see' }]);
	expect(await searchProject(project, 'SECRET')).toEqual([]);
	expect(await searchProject(project, 'x')).toEqual([]);
});

test('search options: case, whole word, regex, and files to include or exclude', async () => {
	expect(await searchProject(project, 'hello', { caseSensitive: true })).toEqual([]);
	expect(await searchProject(project, 'greet', { wholeWord: true })).toEqual([]);
	expect((await searchProject(project, 'greet', { wholeWord: false })).length).toBe(2);
	expect(await searchProject(project, 'const \\w+ =', { regex: true })).toEqual([
		{ path: 'src/app.js', line: 1, text: 'const greeting = "Hello";' },
	]);
	expect(await searchProject(project, 'nothing', { include: '*.js' })).toEqual([]);
	expect((await searchProject(project, 'no', { include: '*.md' })).map(hit => hit.path)).toEqual(['notes.md']);
	expect((await searchProject(project, 'th', { exclude: 'src' })).map(hit => hit.path)).toEqual(['notes.md']);
	expect(searchProject(project, '(unclosed', { regex: true })).rejects.toBeInstanceOf(SearchError);
	// JavaScript's expressions, which grep's don't take: lookahead
	expect((await searchProject(project, 'greet(?=ing =)', { regex: true })).map(hit => hit.path)).toEqual([
		'src/app.js',
	]);
	expect(await searchProject(project, 'const (?!\\w)', { regex: true })).toEqual([]);
});

test('secret-looking files stay out of the listing even when git does not ignore them', async () => {
	for (const secret of [
		'.env.local',
		'.mcp.json',
		'deploy/id_ed25519',
		'certs/server.key',
		'.claude/settings.local.json',
	]) {
		await mkdir(path.dirname(path.join(project, secret)), { recursive: true });
		await Bun.write(path.join(project, secret), 'secret\n');
	}
	await Bun.sleep(2100);

	const files = await listFiles(project);

	for (const secret of [
		'.env.local',
		'.mcp.json',
		'deploy/id_ed25519',
		'certs/server.key',
		'.claude/settings.local.json',
	])
		expect(files).not.toContain(secret);
	expect(files).toContain('src/app.js');
});
