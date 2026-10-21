import { mkdir, mkdtemp, readdir, symlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, expect, test } from 'bun:test';

import {
	copyEntries,
	createEntry,
	initTrash,
	moveEntries,
	restoreEntries,
	trashEntries,
	uploadFile,
} from './fileOperations';
import { listFiles } from './files';
import gitEnvironment from './utils/gitEnvironment';

let project;
let outside;

const statusOf = promise =>
	promise.then(
		() => 200,
		error => error.status,
	);
const there = file => Bun.file(path.join(project, file)).exists();

beforeEach(async () => {
	project = await mkdtemp(path.join(os.tmpdir(), 'paude-operations-'));
	outside = await mkdtemp(path.join(os.tmpdir(), 'paude-outside-'));
	initTrash(await mkdtemp(path.join(os.tmpdir(), 'paude-data-')));

	await Bun.write(path.join(project, 'src/app.js'), 'app\n');
	await Bun.write(path.join(project, 'src/lib/util.js'), 'util\n');
	await Bun.write(path.join(project, 'notes.md'), 'notes\n');
	await Bun.write(path.join(project, '.gitignore'), '*.log\n');
	await symlink(outside, path.join(project, 'elsewhere'));
	Bun.spawnSync(['git', 'init', '-q'], { cwd: project, env: gitEnvironment() });
});

test('a new file is made empty, its folders with it, and shows in the next listing', async () => {
	expect(await createEntry(project, 'docs/guide/start.md')).toEqual({ path: 'docs/guide/start.md', listed: true });
	expect(await Bun.file(path.join(project, 'docs/guide/start.md')).text()).toBe('');
	expect(await listFiles(project)).toContain('docs/guide/start.md');
	expect(await statusOf(createEntry(project, 'docs/guide/start.md'))).toBe(409);
});

test('a new folder is made where it is asked for, a trailing slash or not', async () => {
	expect(await createEntry(project, 'assets/icons/', { folder: true })).toEqual({ path: 'assets/icons' });
	expect(await statusOf(createEntry(project, 'assets/icons', { folder: true }))).toBe(409);
});

test('a file git ignores is made, but said not to be listed', async () => {
	expect(await createEntry(project, 'debug.log')).toEqual({ path: 'debug.log', listed: false });
});

test('nothing is made outside the project, inside .git, through a file, or as a secret', async () => {
	for (const wanted of ['../out.md', '/etc/out.md', 'a//b.md', '.git/hooks/pre-commit', 'elsewhere/new.md', '.env', 42])
		expect(await statusOf(createEntry(project, wanted))).toBe(400);
	expect(await statusOf(createEntry(project, 'notes.md/inside.md'))).toBe(400);
});

test('a rename moves a file or a folder, and a move can take several into a new folder', async () => {
	expect(await moveEntries(project, [{ from: 'notes.md', to: 'README.md' }])).toEqual({
		moved: [{ from: 'notes.md', to: 'README.md' }],
	});
	await moveEntries(project, [
		{ from: 'src/lib', to: 'shared/lib' },
		{ from: 'README.md', to: 'shared/README.md' },
	]);

	expect(await listFiles(project)).toEqual([
		'.gitignore',
		'elsewhere',
		'shared/README.md',
		'shared/lib/util.js',
		'src/app.js',
	]);
});

test('a move that would overwrite, go inside itself or land twice in one place moves nothing', async () => {
	expect(await statusOf(moveEntries(project, [{ from: 'notes.md', to: 'src/app.js' }]))).toBe(409);
	expect(await statusOf(moveEntries(project, [{ from: 'src', to: 'src/lib/src' }]))).toBe(400);
	expect(
		await statusOf(
			moveEntries(project, [
				{ from: 'src/app.js', to: 'notes.txt' },
				{ from: 'notes.md', to: 'notes.txt' },
			]),
		),
	).toBe(409);
	expect(await statusOf(moveEntries(project, [{ from: 'missing.md', to: 'found.md' }]))).toBe(404);
	expect(await statusOf(moveEntries(project, [{ from: 'notes.md', to: 'elsewhere/notes.md' }]))).toBe(400);
	expect(await there('notes.md')).toBe(true);
	expect(await there('src/app.js')).toBe(true);
});

test('a symlink out of the project moves as the link, and its target is untouched', async () => {
	await Bun.write(path.join(outside, 'kept.txt'), 'kept\n');
	await moveEntries(project, [{ from: 'elsewhere', to: 'linked' }]);

	expect(await readdir(outside)).toEqual(['kept.txt']);
	expect(await Bun.file(path.join(project, 'linked/kept.txt')).text()).toBe('kept\n');
});

test('a copy makes a second of a file or a whole folder, and never over another', async () => {
	await copyEntries(project, [
		{ from: 'notes.md', to: 'notes copy.md' },
		{ from: 'src', to: 'src copy' },
	]);

	expect(await Bun.file(path.join(project, 'notes copy.md')).text()).toBe('notes\n');
	expect(await Bun.file(path.join(project, 'src copy/lib/util.js')).text()).toBe('util\n');
	expect(await statusOf(copyEntries(project, [{ from: 'notes.md', to: 'src/app.js' }]))).toBe(409);
	expect(await Bun.file(path.join(project, 'src/app.js')).text()).toBe('app\n');
});

test('a delete goes to the trash and is restored from it, a folder and what is in it once', async () => {
	const { trash, deleted } = await trashEntries(project, ['src', 'src/lib/util.js', 'notes.md']);

	expect(deleted).toEqual(['src', 'notes.md']);
	expect(await listFiles(project)).toEqual(['.gitignore', 'elsewhere']);
	expect(await restoreEntries(project, trash)).toEqual({ restored: ['src', 'notes.md'] });
	expect(await listFiles(project)).toEqual(['.gitignore', 'elsewhere', 'notes.md', 'src/app.js', 'src/lib/util.js']);
	expect(await statusOf(restoreEntries(project, trash))).toBe(404);
});

test("a restore puts nothing over what's been made since, and only into the folder it came from", async () => {
	const { trash } = await trashEntries(project, ['notes.md']);

	expect(await statusOf(restoreEntries(outside, trash))).toBe(404);
	expect(await statusOf(restoreEntries(project, '../../etc'))).toBe(404);

	await Bun.write(path.join(project, 'notes.md'), 'new notes\n');
	expect(await statusOf(restoreEntries(project, trash))).toBe(409);
	expect(await Bun.file(path.join(project, 'notes.md')).text()).toBe('new notes\n');
});

test('an upload makes a new file, and replaces one only when asked', async () => {
	const bytes = new TextEncoder().encode('uploaded\n').buffer;

	expect(await uploadFile(project, 'assets/logo.svg', bytes)).toEqual({ path: 'assets/logo.svg', listed: true });
	expect(await statusOf(uploadFile(project, 'notes.md', bytes))).toBe(409);
	expect(await uploadFile(project, 'notes.md', bytes, { replace: true })).toEqual({ path: 'notes.md', listed: true });
	expect(await Bun.file(path.join(project, 'notes.md')).text()).toBe('uploaded\n');
	expect(await statusOf(uploadFile(project, 'src', bytes, { replace: true }))).toBe(409);
	expect(await statusOf(uploadFile(project, 'elsewhere', bytes, { replace: true }))).toBe(409);
	expect(await statusOf(uploadFile(project, 'elsewhere/in.txt', bytes))).toBe(400);
});

test('a folder made empty and then given a file shows that file', async () => {
	await mkdir(path.join(project, 'empty'));
	await createEntry(project, 'empty/first.md');

	expect(await listFiles(project)).toContain('empty/first.md');
});
