import { mkdir, mkdtemp } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { beforeAll, expect, test } from 'bun:test';

import { setProjectsRoot } from '../projects';
import { resumeFolder } from './running';

const ID = '58a732eb-0000-4000-8000-000000000000';
let app;

beforeAll(async () => {
	const base = await mkdtemp(join(os.tmpdir(), 'paude-running-'));

	app = join(base, 'projects', 'app');
	await mkdir(join(app, 'tools'), { recursive: true });
	setProjectsRoot(join(base, 'projects'));
	process.env.CLAUDE_CONFIG_DIR = join(base, 'claude');
	await Bun.write(
		join(base, 'claude', 'projects', '-app', `${ID}.jsonl`),
		`${JSON.stringify({ type: 'user', cwd: app, sessionId: ID })}\n`,
	);
});

test('a session is taken back up where it last was, or where it began once that folder is gone', async () => {
	expect(await resumeFolder(ID, join(app, 'tools'))).toBe(join(app, 'tools'));
	expect(await resumeFolder(ID, join(app, '.claude', 'worktrees', 'removed'))).toBe(app);
});

test("failing both, the nearest folder above that's still in the project; outside every project, none", async () => {
	expect(await resumeFolder('no-transcript', join(app, 'tools', 'gone', 'deeper'))).toBe(join(app, 'tools'));
	expect(await resumeFolder('no-transcript', '/nowhere/at/all')).toBe(null);
});
