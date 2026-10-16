import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { initReviews, markReviewed, reviewState } from './reviews';
import gitEnvironment from './utils/gitEnvironment';

let dir;
let repo;

const git = (...args) => {
	const result = Bun.spawnSync(['git', ...args], { cwd: repo, env: gitEnvironment(), stdout: 'pipe', stderr: 'pipe' });

	if (!result.success) throw new Error(result.stderr.toString());

	return result.stdout.toString().trim();
};

const commit = message =>
	git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', message);

const ana = { inviteId: 'ana', sessionId: 's', role: 'comment', name: 'Ana' };
const ben = { inviteId: 'ben', sessionId: 's', role: 'comment', name: 'Ben' };

beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), 'paude-reviews-'));
	repo = path.join(dir, 'repo');
	Bun.spawnSync(['git', 'init', '-q', '-b', 'main', repo], { env: gitEnvironment() });
	initReviews(dir);
	commit('start');
	git('switch', '-q', '-c', 'idea');
	commit('first idea');
});

afterEach(() => rm(dir, { recursive: true, force: true }));

test("each person's review of a branch is their own, and counts what came after it", async () => {
	expect(await reviewState(ana, repo)).toMatchObject({ branch: 'idea', commit: null });
	expect(await markReviewed(ana, repo)).toBe(true);

	const reviewed = git('rev-parse', 'HEAD');

	commit('second idea');

	expect(await reviewState(ana, repo)).toMatchObject({ commit: reviewed, count: 1, head: git('rev-parse', 'HEAD') });
	expect(await reviewState(ben, repo)).toMatchObject({ commit: null });

	git('switch', '-q', 'main');
	expect(await reviewState(ana, repo)).toMatchObject({ branch: 'main', commit: null });
});

test('a detached HEAD, or someone with no lasting identity, has nothing to remember', async () => {
	expect(await markReviewed({ name: 'nobody' }, repo)).toBe(false);
	git('switch', '-q', '--detach');
	expect(await reviewState(ana, repo)).toEqual({ head: git('rev-parse', 'HEAD') });
	expect(await markReviewed(ana, repo)).toBe(false);
});
