import { mkdir, mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeAll, expect, test } from 'bun:test';

import {
	FolderError,
	initProjects,
	listProjects,
	projectOf,
	projectPath,
	registerFolder,
	setProjectsRoot,
	unregisterFolder,
} from './projects';

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
