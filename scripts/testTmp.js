import { afterAll } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

// Every test run gets its own temp folder, and everything the run started (test servers, the sessions they hold open,
// a game's dev server) carries it as TMPDIR. A run's processes go when it ends; a run killed before then (a timeout,
// ^C) is reaped by the next, found by the TMPDIR its processes still carry and the dead run's pid in its name.
const ROOT = os.tmpdir();
const PREFIX = 'paude-test-';
const RUN_DIR = new RegExp(`(?:^|\\0| )TMPDIR=(${ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${PREFIX}(\\d+)-[^\\0 /]+)`);

const alive = pid => {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
};

// [{ pid, dir, runPid }] for every process started by a test run
const runProcesses = () => {
	const entries =
		process.platform === 'linux'
			? readdirSync('/proc')
					.filter(name => /^\d+$/.test(name))
					.map(pid => {
						try {
							return [Number(pid), readFileSync(`/proc/${pid}/environ`, 'latin1')];
						} catch {
							return null;
						}
					})
			: Bun.spawnSync(['ps', '-A', '-E', '-ww', '-o', 'pid=,command='])
					.stdout.toString()
					.split('\n')
					.map(line => /^\s*(\d+)\s(.*)$/.exec(line))
					.map(found => found && [Number(found[1]), found[2]]);

	return entries.flatMap(entry => {
		const found = entry && RUN_DIR.exec(entry[1]);

		return found && entry[0] !== process.pid ? [{ pid: entry[0], dir: found[1], runPid: Number(found[2]) }] : [];
	});
};

const kill = pids => {
	for (const pid of pids)
		try {
			process.kill(pid, 'SIGKILL');
		} catch {
			// Gone already
		}
};

const reap = dirs => {
	const doomed = new Set(dirs);

	kill(runProcesses().flatMap(found => (doomed.has(found.dir) ? [found.pid] : [])));
	for (const dir of doomed) rmSync(dir, { recursive: true, force: true });
};

const deadRun = name => {
	const pid = Number(name.startsWith(PREFIX) && name.slice(PREFIX.length).split('-')[0]);

	return pid && !alive(pid);
};

reap([
	...readdirSync(ROOT)
		.filter(deadRun)
		.map(name => path.join(ROOT, name)),
	...runProcesses()
		.filter(found => !alive(found.runPid))
		.map(found => found.dir),
]);

const run = mkdtempSync(path.join(ROOT, `${PREFIX}${process.pid}-`));

process.env.TMPDIR = run;
afterAll(() => reap([run]));
