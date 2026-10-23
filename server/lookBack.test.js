import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { initLookBack, lookBack } from './lookBack';

let dir;
let repo;
let transcripts;
let claudeConfig;

beforeEach(async () => {
	dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'paude-look-back-')));
	repo = path.join(dir, 'repo');
	Bun.spawnSync(['git', 'init', '-q', repo]);
	claudeConfig = process.env.CLAUDE_CONFIG_DIR;
	process.env.CLAUDE_CONFIG_DIR = path.join(dir, '.claude-home');
	transcripts = path.join(dir, '.claude-home', 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
	await mkdir(transcripts, { recursive: true });
	await initLookBack(path.join(dir, 'data'));
});

afterEach(async () => {
	if (claudeConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = claudeConfig;
	await rm(dir, { recursive: true, force: true });
});

test("a project's sessions are looked back on whole, once each, again when unsettled or grown", async () => {
	await writeFile(path.join(transcripts, 'old.jsonl'), '{}\n');
	await writeFile(path.join(transcripts, 'slow.jsonl'), '{}\n');
	await writeFile(path.join(transcripts, 'notes.txt'), '');

	const followed = [];
	const follow = async (id, cwd, options) => {
		followed.push([id, cwd, options]);

		// One out of time, or waiting on another session at work
		return id !== 'slow';
	};

	await lookBack(repo, { follow });
	expect(followed.toSorted()).toEqual([
		['old', repo, { whole: true }],
		['slow', repo, { whole: true }],
	]);

	followed.length = 0;
	await lookBack(repo, { follow });
	expect(followed.map(([id]) => id)).toEqual(['slow']);

	// Resumed since, and grown
	await appendFile(path.join(transcripts, 'old.jsonl'), '{}\n');
	followed.length = 0;
	await lookBack(repo, { follow });
	expect(followed.map(([id]) => id).toSorted()).toEqual(['old', 'slow']);
});

test('outside a repository, nothing is looked back on', async () => {
	const followed = [];

	await lookBack(dir, { follow: async id => followed.push(id) });
	expect(followed).toEqual([]);
});
