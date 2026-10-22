import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeAll, expect, test } from 'bun:test';

import {
	FolderError,
	addFolders,
	initProjects,
	listProjects,
	noteProjectActivity,
	projectActivity,
	projectOf,
	projectPath,
	registerFolder,
	removeProject,
	setProjectsRoot,
	unregisterFolder,
} from './projects';
import gitEnvironment from './utils/gitEnvironment';

let base;

beforeAll(async () => {
	base = await mkdtemp(path.join(os.tmpdir(), 'paude-projects-'));
	await mkdir(path.join(base, 'root/app'), { recursive: true });
	await mkdir(path.join(base, 'elsewhere/app/sub'), { recursive: true });
	await mkdir(path.join(base, 'work/tool'), { recursive: true });
	setProjectsRoot(path.join(base, 'root'));
	await initProjects(path.join(base, 'data'));
});

test('folders from anywhere become projects, a clashing name gets a number', async () => {
	expect(await registerFolder(path.join(base, 'work/tool'))).toBe('tool');
	expect(await registerFolder(path.join(base, 'elsewhere/app'))).toBe('app-2');
	expect(await listProjects()).toEqual(['app', 'app-2', 'tool']);

	expect(projectPath('app-2')).toBe(path.join(base, 'elsewhere/app'));
	expect(projectOf(path.join(base, 'elsewhere/app/sub'))).toBe('app-2');
	expect(projectOf(path.join(base, 'root/app'))).toBe('app');
	expect(projectOf(path.join(base, 'nowhere'))).toBeNull();
});

test('registering is idempotent, a root child stays itself, and bad paths are refused', async () => {
	expect(await registerFolder(path.join(base, 'work/tool'))).toBe('tool');
	expect(await registerFolder(path.join(base, 'root/app'))).toBe('app');
	expect(registerFolder('relative/path')).rejects.toBeInstanceOf(FolderError);
	expect(registerFolder(path.join(base, 'missing'))).rejects.toBeInstanceOf(FolderError);
});

test('registrations persist and can be removed', async () => {
	await initProjects(path.join(base, 'data'));
	expect(await listProjects()).toContain('tool');

	expect(await unregisterFolder('tool')).toBe(true);
	expect(await unregisterFolder('tool')).toBe(false);
	expect(projectOf(path.join(base, 'work/tool'))).toBeNull();
});

test('a pattern adds every folder it matches as a project of its own, and nothing else', async () => {
	for (const mod of ['alpha', 'beta', '.hidden']) await mkdir(path.join(base, 'mods', mod), { recursive: true });
	await Bun.write(path.join(base, 'mods', 'notes.txt'), 'not a folder');

	expect(await addFolders(`${path.join(base, 'mods')}/*`)).toEqual(['alpha', 'beta']);
	expect(projectOf(path.join(base, 'mods', 'beta', 'src'))).toBe('beta');
	await expect(addFolders(`${path.join(base, 'mods')}/zzz*`)).rejects.toThrow('No folders match');
	await expect(addFolders('mods/*')).rejects.toThrow(FolderError);
});

test('removing takes a project off the list without touching it: an added folder is forgotten, one in the root hidden', async () => {
	await mkdir(path.join(base, 'root/kept'), { recursive: true });

	expect(await removeProject('alpha')).toBe('removed');
	expect(await removeProject('kept')).toBe('hidden');
	expect(await listProjects()).not.toContain('kept');
	expect(projectOf(path.join(base, 'root/kept/src'))).toBeNull();
	expect(projectPath('kept')).toBeNull();
	expect(await removeProject('nothing-here')).toBeNull();

	// Adding it again brings it back, under its own name
	expect(await addFolders(path.join(base, 'root/kept'))).toEqual(['kept']);
	expect(await listProjects()).toContain('kept');
});

test("a project keeps when it was last active after its sessions are gone, until its folder's name goes to another", async () => {
	expect(await registerFolder(path.join(base, 'work/tool'))).toBe('tool');
	await noteProjectActivity({ tool: 2000, app: undefined });
	await noteProjectActivity({ tool: 1000 });
	expect(projectActivity('tool')).toBe(2000);
	expect(projectActivity('app')).toBeNull();

	await initProjects(path.join(base, 'data'));
	expect(projectActivity('tool')).toBe(2000);

	await unregisterFolder('tool');
	expect(projectActivity('tool')).toBeNull();
});

test("a git worktree left in the projects root is its repository's, not a project of its own", async () => {
	const repo = path.join(base, 'root/repo');
	const run = (...args) => Bun.spawnSync(['git', ...args], { cwd: repo, env: gitEnvironment() });

	await mkdir(repo);
	run('init', '-q', '-b', 'main');
	run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start');
	run('worktree', 'add', '-q', '-b', 'fix', path.join(base, 'root/repo-fix'));
	// A submodule's .git file names a gitdir with no commondir
	await mkdir(path.join(base, 'root/module'));
	await writeFile(path.join(base, 'root/module/.git'), `gitdir: ${path.join(repo, '.git')}\n`);

	const listed = await listProjects();

	expect(listed).toContain('repo');
	expect(listed).toContain('module');
	expect(listed).not.toContain('repo-fix');
	expect(projectOf(path.join(base, 'root/repo-fix'))).toBe('repo');
});
