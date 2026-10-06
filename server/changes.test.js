import { mkdtemp, realpath, rm } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { beforeEach, expect, test } from 'bun:test';

import { diffOf, listChanges } from './changes';
import { readProjectFile, writeProjectFile } from './files';
import gitEnvironment from './utils/gitEnvironment';

let repo;

const git = (...args) => {
	const result = Bun.spawnSync(['git', ...args], { cwd: repo, env: gitEnvironment(), stdout: 'pipe', stderr: 'pipe' });

	if (!result.success) throw new Error(result.stderr.toString());
};
const commit = () => git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'state');

beforeEach(async () => {
	repo = await realpath(await mkdtemp(join(os.tmpdir(), 'paude-changes-')));
	git('init', '-q', '-b', 'main');
	await Bun.write(join(repo, 'keep.js'), 'one\ntwo\nthree\n');
	await Bun.write(join(repo, 'gone.js'), 'bye\n');
	await Bun.write(join(repo, 'old-name.js'), 'the same body, long enough to be recognised as a rename\n');
	await Bun.write(join(repo, '.gitignore'), 'ignored.log\n');
	git('add', '-A');
	commit();
});

test('every kind of change since the last commit, staged or not, and nothing ignored or secret', async () => {
	await Bun.write(join(repo, 'keep.js'), 'one\n2\nthree\n');
	await rm(join(repo, 'gone.js'));
	git('mv', 'old-name.js', 'new-name.js');
	await Bun.write(join(repo, 'staged.js'), 'staged\n');
	git('add', 'staged.js');
	await Bun.write(join(repo, 'fresh.js'), 'untracked\n');
	await Bun.write(join(repo, 'ignored.log'), 'noise\n');
	await Bun.write(join(repo, '.env'), 'TOKEN=secret\n');

	expect(await listChanges(repo)).toEqual([
		{ path: 'fresh.js', status: 'untracked' },
		{ path: 'gone.js', status: 'deleted' },
		{ path: 'keep.js', status: 'modified' },
		{ path: 'new-name.js', status: 'renamed', from: 'old-name.js' },
		{ path: 'staged.js', status: 'added' },
	]);
});

test('a diff for a changed file, an untracked one all added, and none for anything else', async () => {
	await Bun.write(join(repo, 'keep.js'), 'one\n2\nthree\n');
	await Bun.write(join(repo, 'fresh.js'), 'untracked\n');

	expect(await diffOf(repo, 'keep.js')).toContain('-two\n+2\n');
	expect(await diffOf(repo, 'fresh.js')).toContain('+untracked');
	expect(await diffOf(repo, 'gone.js')).toBeNull();
	expect(await diffOf(repo, '../../etc/passwd')).toBeNull();
});

test('a repo with no commit yet shows everything as new; a folder outside git has no changes', async () => {
	await rm(join(repo, '.git'), { recursive: true });
	expect(await listChanges(repo)).toBeNull();

	git('init', '-q', '-b', 'main');
	git('add', 'keep.js');
	expect(await listChanges(repo)).toContainEqual({ path: 'keep.js', status: 'added' });
});

test('a save goes over the version that was opened, and refuses one that changed since', async () => {
	const opened = await readProjectFile(repo, 'keep.js');
	const saved = await writeProjectFile(repo, 'keep.js', 'one\nTWO\nthree\n', opened.hash);

	expect(saved.status).toBe(200);
	expect(await Bun.file(join(repo, 'keep.js')).text()).toBe('one\nTWO\nthree\n');

	// Saving again over the first version would lose the edit just made
	const stale = await writeProjectFile(repo, 'keep.js', 'mine\n', opened.hash);

	expect(stale).toEqual({ status: 409, text: 'one\nTWO\nthree\n', hash: saved.hash });
	expect(await Bun.file(join(repo, 'keep.js')).text()).toBe('one\nTWO\nthree\n');
});

test('only text files already in the project can be saved, and not too much of one', async () => {
	await Bun.write(join(repo, '.env'), 'TOKEN=secret\n');

	expect((await writeProjectFile(repo, '.env', 'TOKEN=mine\n', 'x')).status).toBe(404);
	expect((await writeProjectFile(repo, 'invented.js', 'new\n', 'x')).status).toBe(404);
	expect((await writeProjectFile(repo, '../outside.js', 'new\n', 'x')).status).toBe(404);

	const opened = await readProjectFile(repo, 'keep.js');

	expect((await writeProjectFile(repo, 'keep.js', 'x'.repeat(2 * 1024 * 1024), opened.hash)).status).toBe(413);
	expect((await writeProjectFile(repo, 'keep.js', { not: 'text' }, opened.hash)).status).toBe(413);
	expect(await Bun.file(join(repo, '.env')).text()).toBe('TOKEN=secret\n');
});
