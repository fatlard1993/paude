import { afterAll } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

// Every test run gets its own temp folder, gone when the run ends. A run killed before then (a timeout, ^C) leaves
// its folder and the sessions held open under it; the next run reaps them, by the dead run's pid in the name.
const ROOT = os.tmpdir();
const PREFIX = 'paude-test-';

const alive = pid => {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
};

for (const name of readdirSync(ROOT)) {
	const pid = Number(name.startsWith(PREFIX) && name.slice(PREFIX.length).split('-')[0]);

	if (!pid || alive(pid)) continue;

	const dir = path.join(ROOT, name);

	Bun.spawnSync(['pkill', '-KILL', '-f', `${dir}/`]);
	rmSync(dir, { recursive: true, force: true });
}

const run = mkdtempSync(path.join(ROOT, `${PREFIX}${process.pid}-`));

process.env.TMPDIR = run;
afterAll(() => rmSync(run, { recursive: true, force: true }));
