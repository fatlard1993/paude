import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { discoverTasks, findProblems, runOutput, runTask, runsOf, stopRun, testCounts } from './tasks';

let cwd;

beforeAll(async () => {
	cwd = await mkdtemp(path.join(os.tmpdir(), 'paude-tasks-'));
	await mkdir(path.join(cwd, 'src'));
	await writeFile(path.join(cwd, 'src', 'app.ts'), 'x\n'.repeat(20));
	await writeFile(path.join(cwd, 'src', 'app.test.js'), 'x\n'.repeat(20));
	await writeFile(
		path.join(cwd, 'package.json'),
		JSON.stringify({
			scripts: {
				test: 'bun test',
				lint: 'eslint .',
				dev: 'vite',
				pretest: 'echo',
				slow: 'sleep 30',
				hello: 'echo hello',
			},
		}),
	);
	await writeFile(path.join(cwd, 'bun.lock'), '');
	await writeFile(path.join(cwd, 'Makefile'), 'build:\n\tcc main.c\n.PHONY: build\nCC := gcc\n');
	await writeFile(path.join(cwd, 'justfile'), 'deploy target:\n\techo {{target}}\n');
});

afterAll(() => rm(cwd, { recursive: true, force: true }));

test("finds the project's own tasks, run its way, and what each is for", async () => {
	const tasks = await discoverTasks(cwd);

	expect(tasks.map(({ id, kind }) => [id, kind])).toEqual([
		['package.json:test', 'test'],
		['package.json:lint', 'check'],
		['package.json:dev', 'serve'],
		['package.json:slow', 'run'],
		['package.json:hello', 'run'],
		['Makefile:build', 'build'],
		['justfile:deploy', 'run'],
	]);
	expect(tasks[0].command).toEqual(['bun', 'run', 'test']);
});

test('finds problems in what compilers, linters and test runners print, in project files only', async () => {
	const printed = [
		'src/app.ts(3,7): error TS2322: Type string is not assignable to type number.',
		`${cwd}/src/app.ts`,
		'   5:1  error  Unexpected var  no-var',
		'  12:4  warning  Unused x  no-unused-vars',
		'error: expect(received).toBe(expected)',
		`      at <anonymous> (${cwd}/src/app.test.js:9:12)`,
		'node_modules/lib/index.js:1:1: error: not ours',
		'elsewhere/missing.ts:4:2: error: not a file here',
	].join('\n');

	expect((await findProblems(printed, cwd)).map(({ file, line, severity }) => [file, line, severity])).toEqual([
		['src/app.ts', 3, 'error'],
		['src/app.ts', 5, 'error'],
		['src/app.ts', 12, 'warning'],
		['src/app.test.js', 9, 'error'],
	]);
});

test("reads a test run's counts from the usual runners", () => {
	expect(testCounts('\n 41 pass\n 2 fail\n')).toEqual({ passed: 41, failed: 2 });
	expect(testCounts('Tests:       1 failed, 30 passed, 31 total')).toEqual({ passed: 30, failed: 1 });
	expect(testCounts('===== 3 failed, 10 passed in 0.5s =====')).toEqual({ passed: 10, failed: 3 });
	expect(testCounts('test result: ok. 5 passed; 0 failed; 0 ignored')).toEqual({ passed: 5, failed: 0 });
	expect(testCounts('ok  \texample.com/a\t0.1s\nFAIL\texample.com/b\t0.2s')).toEqual({ passed: 1, failed: 1 });
	expect(testCounts('built in 2s')).toBeNull();
});

test('runs a task, keeps what it prints, and stops one with what it started', async () => {
	const done = await runTask('session-a', cwd, 'package.json:hello');

	for (let tries = 0; runsOf('session-a')[0].code === undefined && tries < 50; tries++) await Bun.sleep(100);
	expect(runOutput('session-a', done.id).output).toContain('hello');
	expect(runsOf('session-a')[0].code).toBe(0);

	const slow = await runTask('session-a', cwd, 'package.json:slow');

	await expect(runTask('session-a', cwd, 'package.json:slow')).rejects.toThrow('already running');
	await Bun.sleep(300);
	await stopRun('session-a', slow.id);
	for (let tries = 0; runsOf('session-a')[1].code === undefined && tries < 50; tries++) await Bun.sleep(100);
	expect(runsOf('session-a')[1]).toMatchObject({ stopped: true });
	expect(runsOf('session-a')[1].code).not.toBe(0);
});
