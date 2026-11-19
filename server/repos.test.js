import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { expect, test } from 'bun:test';

import { reposWithin } from './repos';

const git = (cwd, ...args) =>
	Bun.spawnSync(['git', ...args], { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });

test("a project's repositories are found however deep they nest, its worktrees with them, none from node_modules", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'paude-repos-'));

	try {
		const top = path.join(dir, 'project');
		const nested = path.join(top, 'packages', 'inner');
		const hidden = path.join(top, 'node_modules', 'dep');

		for (const repo of [top, nested, hidden]) {
			await mkdir(repo, { recursive: true });
			git(repo, 'init', '-q', '-b', 'main');
			git(repo, '-c', 'user.name=T', '-c', 'user.email=t@e.x', 'commit', '-q', '--allow-empty', '-m', 'first');
		}
		await writeFile(path.join(top, 'file.txt'), 'x');
		git(top, 'worktree', 'add', '-q', '-b', 'side', path.join(dir, 'side'));

		const found = await reposWithin(top);
		const real = async place => (await import('fs/promises')).realpath(place);

		expect(found.sort()).toEqual([await real(top), await real(nested), await real(path.join(dir, 'side'))].sort());
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('a project that keeps a repository for each of its many parts has every one of them found', async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'paude-repos-'));

	try {
		const parts = Array.from({ length: 95 }, (_, index) => path.join(dir, `part-${index}`));

		for (const part of parts) {
			await mkdir(path.join(part, '.git'), { recursive: true });
		}

		expect((await reposWithin(dir)).length).toBe(parts.length);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
