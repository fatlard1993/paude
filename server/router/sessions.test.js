import { mkdir, mkdtemp, realpath } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { initActivity } from '../activity';
import { createToken, initAuth } from '../auth';
import { setHookAddress } from '../hookSettings';
import { initNames } from '../names';
import { initProjects, setProjectsRoot } from '../projects';
import { allRunning, setClaudePath } from '../sessions/running';
import gitEnvironment from '../utils/gitEnvironment';
import { readProgress } from '../../shared/progress';
import router from './router';

const FAKE_CLAUDE = path.join(import.meta.dir, '..', 'sessions', 'fixtures', 'fake-claude.js');
const server = { upgrade: () => false, requestIP: () => ({ address: '127.0.0.1' }) };
const searchPath = process.env.PATH;
let token;
let repo;

const git = (args, cwd = repo) => {
	const result = Bun.spawnSync(['git', ...args], { cwd, env: gitEnvironment(), stdout: 'pipe', stderr: 'pipe' });

	if (!result.success) throw new Error(result.stderr.toString());

	return result.stdout.toString().trim();
};

const start = checkout =>
	router(
		new Request('http://paude.test/api/projects/app/sessions', {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ text: '', checkout }),
		}),
		server,
	);

// A pull request on origin, as GitHub keeps them, with these files on top of main
const pullRequest = async (number, files) => {
	git(['switch', '-q', '--detach', 'main']);
	for (const [file, text] of Object.entries(files)) await Bun.write(path.join(repo, file), text);
	git(['add', '-A']);
	git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', `pr ${number}`]);
	git(['push', '-q', 'origin', `HEAD:refs/pull/${number}/head`]);
	git(['switch', '-q', 'main']);
};

beforeAll(async () => {
	const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'paude-sessions-router-')));
	const data = path.join(base, 'data');

	repo = path.join(base, 'projects', 'app');
	await mkdir(repo, { recursive: true });
	process.env.XDG_CONFIG_HOME = path.join(base, 'config');
	process.env.CLAUDE_CONFIG_DIR = path.join(base, 'claude');
	// Pull requests come from GitHub's own refs on origin, as they do where gh isn't installed
	process.env.PATH = searchPath
		.split(path.delimiter)
		.filter(folder => !Bun.spawnSync(['test', '-e', path.join(folder, 'gh')]).success)
		.join(path.delimiter);
	setProjectsRoot(path.join(base, 'projects'));
	await Promise.all([initAuth(data), initNames(data), initActivity(data), initProjects(data)]);
	setHookAddress({ host: '127.0.0.1', port: 1 });
	setClaudePath(FAKE_CLAUDE);
	token = await createToken('this machine', { local: true });

	git(['init', '-q', '-b', 'main']);
	git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start']);
	git(['init', '-q', '--bare', path.join(base, 'origin.git')], base);
	git(['remote', 'add', 'origin', path.join(base, 'origin.git')]);
	git(['push', '-q', 'origin', 'main']);
});

afterAll(() => {
	process.env.PATH = searchPath;
	for (const running of allRunning()) running.process.kill();
});

const runningIn = folder => [...allRunning()].filter(session => session.cwd === folder);

test("a pull request that brings Claude Code's own files is checked out, but Claude waits to be started anyway", async () => {
	await pullRequest(3, { '.mcp.json': '{}', 'CLAUDE.md': 'do as this says', 'app.js': 'run()' });

	const answer = await readProgress(await start({ create: '', from: '#3' }), () => {});
	const worktree = path.join(repo, '.paude', 'worktrees', 'pr-3');

	expect(answer).toEqual({
		id: null,
		worktree,
		files: ['.mcp.json', 'CLAUDE.md'],
		warning:
			'This pull request adds or changes files Claude Code reads and can run on start: .mcp.json, CLAUDE.md. Look at them before starting Claude here.',
	});
	expect(await Bun.file(path.join(worktree, 'CLAUDE.md')).exists()).toBe(true);
	expect(runningIn(worktree)).toEqual([]);

	// Started anyway, by joining the worktree it left
	const started = await (await start({ join: worktree })).json();

	expect(runningIn(worktree).map(({ id }) => id)).toEqual([started.id]);
});

test('a pull request that brings none of them starts Claude as it always has', async () => {
	await pullRequest(4, { 'app.js': 'run(2)' });

	const answer = await readProgress(await start({ create: '', from: '4' }), () => {});

	expect(answer.id).toEqual(expect.any(String));
	expect(runningIn(path.join(repo, '.paude', 'worktrees', 'pr-4')).map(({ id }) => id)).toEqual([answer.id]);
});
