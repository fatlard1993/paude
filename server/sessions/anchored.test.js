import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { anchored } from './attachSocket';

let dir;
let repo;

const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const git = (...args) =>
	Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, env })
		.stdout.toString()
		.trim();
const kept = hash => Bun.spawnSync(['git', 'cat-file', '-e', hash], { cwd: repo, env }).exitCode === 0;

beforeEach(async () => {
	dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'paude-anchored-')));
	repo = path.join(dir, 'repo');
	await mkdir(path.join(repo, 'app'), { recursive: true });
	await writeFile(path.join(repo, 'app', 'a.js'), 'one\n');
	await writeFile(path.join(repo, 'lib.js'), 'lib\n');
	await writeFile(path.join(dir, 'credentials'), 'secret\n');
	git('init', '-q');
	git('add', '-A');
	git('commit', '-qm', 'first');
});

afterEach(() => rm(dir, { recursive: true, force: true }));

test("a comment's anchor names only a file of the session's repository, and never copies another into git", async () => {
	const session = { id: 'session-1', cwd: path.join(repo, 'app') };
	const outside = git('hash-object', path.join(dir, 'credentials'));

	for (const where of [path.join(dir, 'credentials'), '../../credentials', '../.env', '/etc/hosts'])
		expect(await anchored(session, { path: where, from: 1 })).toBeNull();
	expect(kept(outside)).toBe(false);

	// A file elsewhere in the repository is named from the folder with ../
	expect(await anchored(session, { path: '../lib.js', from: 1 })).toMatchObject({
		path: '../lib.js',
		blob: git('rev-parse', 'HEAD:lib.js'),
	});
});

test('a comment keeps the text its lines were picked in once it is written, when that is the file on disk', async () => {
	const session = { id: 'session-1', cwd: path.join(repo, 'app') };

	await writeFile(path.join(repo, 'app', 'a.js'), 'two\n');

	const now = git('hash-object', 'app/a.js');

	expect(kept(now)).toBe(false);
	expect((await anchored(session, { path: 'a.js', from: 1, blob: now })).blob).toBe(now);
	expect(kept(now)).toBe(true);

	// A text it isn't is not taken as one
	expect((await anchored(session, { path: 'a.js', from: 1, side: 'old', blob: 'f'.repeat(40) })).blob).toBeUndefined();
});
