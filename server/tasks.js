import { stat } from 'fs/promises';
import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { sessionProcesses } from './ports';
import { sessionEnvironment } from './sessions/PtySession';

// A project's own commands (its package.json scripts, Makefile targets, justfile recipes, and the usual Cargo, Go and
// Python checks) run as buttons, with what they print kept for each run, the problems in it found (file:line), and
// a test run's counts. What runs is marked with the session and the run, so a run's whole process tree can be
// stopped, and a server it starts is shared like any the session starts.
const MAX_RUNS = 20;
const MAX_OUTPUT = 512 * 1024;
const KEEP_HEAD = 64 * 1024;
const MAX_PROBLEMS = 200;
const STOP_AFTER_MS = 3000;

export class TaskError extends Error {}

const exists = async file => Boolean(await stat(file).catch(() => null));
const read = async file =>
	Bun.file(file)
		.text()
		.catch(() => '');

const LOCKFILES = [
	['bun.lock', 'bun'],
	['bun.lockb', 'bun'],
	['pnpm-lock.yaml', 'pnpm'],
	['yarn.lock', 'yarn'],
	['package-lock.json', 'npm'],
];

// How a project runs its package.json scripts: the package manager its lockfile names, or else the first one here
const scriptRunner = async cwd => {
	for (const [lockfile, manager] of LOCKFILES) if (await exists(path.join(cwd, lockfile))) return [manager, 'run'];

	return [['npm', 'bun', 'pnpm', 'yarn'].find(manager => Bun.which(manager)) ?? 'npm', 'run'];
};

// What a task is for, by its name: tests and checks are what problems come from
const kindOf = name => {
	if (/(^|[:-])(test|spec)s?([:-]|$)/.test(name)) return 'test';
	if (/(^|[:-])(lint|check|typecheck|types|tsc|vet|clippy|format:check)([:-]|$)/.test(name)) return 'check';
	if (/(^|[:-])(build|compile|bundle)([:-]|$)/.test(name)) return 'build';
	if (/(^|[:-])(dev|start|serve|watch|preview)([:-]|$)/.test(name)) return 'serve';

	return 'run';
};

const task = (source, name, command) => ({ id: `${source}:${name}`, name, source, command, kind: kindOf(name) });

// [{ id, name, source, command: [argv], kind }]
export const discoverTasks = async cwd => {
	const found = [];
	const manifest = await read(path.join(cwd, 'package.json'));

	if (manifest) {
		try {
			const runner = await scriptRunner(cwd);

			for (const name of Object.keys(JSON.parse(manifest).scripts ?? {}))
				if (!/^(pre|post)/.test(name) && !['prepare', 'prepublishOnly'].includes(name))
					found.push(task('package.json', name, [...runner, name]));
		} catch {
			// Not JSON this moment (someone is editing it)
		}
	}

	const makefile = (await read(path.join(cwd, 'Makefile'))) || (await read(path.join(cwd, 'makefile')));

	for (const [, name] of makefile.matchAll(/^([A-Za-z0-9][\w.-]*):(?!=)/gm))
		if (!name.startsWith('.')) found.push(task('Makefile', name, ['make', name]));

	const justfile = (await read(path.join(cwd, 'justfile'))) || (await read(path.join(cwd, 'Justfile')));

	for (const [, name] of justfile.matchAll(/^@?([A-Za-z][\w-]*)(?:\s+[^:=\n]*)?:(?!=)/gm))
		found.push(task('justfile', name, ['just', name]));

	if (await exists(path.join(cwd, 'Cargo.toml')))
		for (const name of ['test', 'build', 'clippy']) found.push(task('Cargo', name, ['cargo', name]));
	if (await exists(path.join(cwd, 'go.mod'))) {
		found.push(task('Go', 'test', ['go', 'test', './...']));
		found.push(task('Go', 'vet', ['go', 'vet', './...']));
	}
	if ((await exists(path.join(cwd, 'pyproject.toml'))) || (await exists(path.join(cwd, 'pytest.ini'))))
		found.push(task('Python', 'pytest', ['python3', '-m', 'pytest']));

	return [...new Map(found.map(each => [each.id, each])).values()];
};

// eslint-disable-next-line no-control-regex
const ESCAPES = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

export const plainOutput = text => text.replace(ESCAPES, '').replace(/\r(?!\n)/g, '\n');

// file:line(:column) in what a tool printed: compilers and linters (path:line:col: message, TypeScript's
// path(line,col): message, Rust's --> path:line:col, ESLint's stylish groups) and test stack traces. Only files in
// the project count. [{ file, line, column, message, severity }]
export const findProblems = async (text, cwd) => {
	const lines = plainOutput(text).split('\n');
	const problems = [];
	let stylishFile = null;
	const inProject = async candidate => {
		const absolute = path.resolve(cwd, candidate);
		const within = path.relative(cwd, absolute);

		if (within.startsWith('..') || path.isAbsolute(within) || within.includes('node_modules')) return null;

		return (await exists(absolute)) ? within : null;
	};
	const add = (file, line, column, message) =>
		problems.push({
			file,
			line: Number(line),
			column: column ? Number(column) : null,
			message: message.trim().slice(0, 300),
			severity: /warn/i.test(message) ? 'warning' : 'error',
		});

	for (let index = 0; index < lines.length && problems.length < MAX_PROBLEMS; index++) {
		const line = lines[index];
		const stylish = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*)$/.exec(line);

		if (stylish && stylishFile) {
			add(stylishFile, stylish[1], stylish[2], `${stylish[3]}: ${stylish[4]}`);
			continue;
		}

		const header = /^(\/\S+|[\w.][\w./-]*\.\w+)$/.exec(line.trim());

		if (header && (await inProject(header[1]))) {
			stylishFile = await inProject(header[1]);
			continue;
		}

		const typescript = /^([\w./-]+\.\w+)\((\d+),(\d+)\):\s*(.*)$/.exec(line.trim());
		const located =
			typescript ??
			/(?:^|\s|\(|-->\s)((?:\/|\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.\w+):(\d+)(?::(\d+))?\)?:?\s*(.*)$/.exec(line);

		if (!located) continue;

		const file = await inProject(located[1]);

		if (!file) continue;

		// A stack frame's own line says little; the error is a few lines up
		const said =
			located[4]?.trim() ||
			lines
				.slice(Math.max(0, index - 6), index)
				.reverse()
				.find(earlier => /error|fail|expect/i.test(earlier)) ||
			line;

		add(file, located[2], located[3], said);
	}

	return [
		...new Map(problems.map(problem => [`${problem.file}:${problem.line}:${problem.message}`, problem])).values(),
	];
};

// A test run's counts, from the common runners' summaries: { passed, failed } or null
export const testCounts = text => {
	const plain = plainOutput(text);
	const number = pattern => Number(pattern.exec(plain)?.[1] ?? 0);
	const bun = /^\s*(\d+) pass$/m.test(plain) && {
		passed: number(/^\s*(\d+) pass$/m),
		failed: number(/^\s*(\d+) fail$/m),
	};
	const jest = /Tests:\s+.*?(\d+) passed/.test(plain) && {
		passed: number(/Tests:.*?(\d+) passed/),
		failed: number(/Tests:.*?(\d+) failed/),
	};
	const pytest = /=+ .*?(\d+) passed/.test(plain) && { passed: number(/(\d+) passed/), failed: number(/(\d+) failed/) };
	const cargo = /test result: \w+\. (\d+) passed/.test(plain) && {
		passed: number(/(\d+) passed/),
		failed: number(/(\d+) failed/),
	};
	const go = /^(ok|FAIL)\s+\S+/m.test(plain) && {
		passed: (plain.match(/^ok\s+\S+/gm) ?? []).length,
		failed: (plain.match(/^FAIL\s+\S+/gm) ?? []).length,
	};

	return bun || jest || pytest || cargo || go || null;
};

// Per session, its runs, newest last: { id, taskId, name, command, startedAt, endedAt, code, output, process }
const runs = new Map();

const summary = run => ({
	id: run.id,
	taskId: run.taskId,
	name: run.name,
	command: run.command.join(' '),
	startedAt: run.startedAt,
	endedAt: run.endedAt,
	code: run.code,
	stopped: run.stopped ?? false,
	length: run.output.length,
	problems: run.problems ?? [],
	tests: run.tests ?? null,
});

export const runsOf = sessionId => (runs.get(sessionId) ?? []).map(summary);

export const runOutput = (sessionId, runId, from = 0) => {
	const run = (runs.get(sessionId) ?? []).find(found => found.id === runId);

	if (!run) throw new TaskError('No such run');

	return { ...summary(run), output: run.output.slice(Math.max(0, Number(from) || 0)) };
};

const listeners = new Set();

// Told when a run starts or ends, to pass on to whoever has the session open
export const onRunsChange = listener => listeners.add(listener);

const announce = sessionId => {
	for (const listener of listeners) listener(sessionId, runsOf(sessionId));
};

// What a run prints, kept to its first and last parts when it says a great deal
const append = (run, text) => {
	run.output += text;
	if (run.output.length > MAX_OUTPUT)
		run.output = `${run.output.slice(0, KEEP_HEAD)}\n[... cut ...]\n${run.output.slice(-(MAX_OUTPUT - KEEP_HEAD))}`;
};

const drain = async (stream, run) => {
	const decoder = new TextDecoder();

	for await (const chunk of stream) append(run, decoder.decode(chunk, { stream: true }));
};

export const runTask = async (sessionId, cwd, taskId) => {
	const found = (await discoverTasks(cwd)).find(each => each.id === taskId);

	if (!found) throw new TaskError('No such task in this project');

	const sessionRuns = runs.get(sessionId) ?? [];

	if (sessionRuns.some(run => run.taskId === taskId && run.code === undefined))
		throw new TaskError(`${found.name} is already running`);

	if (!Bun.which(found.command[0], { PATH: sessionEnvironment().PATH }))
		throw new TaskError(`${found.command[0]} isn't installed here, so ${found.name} can't run`);

	const id = crypto.randomUUID();
	const run = { id, taskId, name: found.name, command: found.command, startedAt: Date.now(), output: '' };
	const child = Bun.spawn(found.command, {
		cwd,
		env: {
			...sessionEnvironment(),
			PAUDE_SESSION: sessionId,
			PAUDE_TASK: id,
			NO_COLOR: '1',
			FORCE_COLOR: '0',
			CI: '1',
		},
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
	});

	run.process = child;
	runs.set(sessionId, [...sessionRuns, run].slice(-MAX_RUNS));
	announce(sessionId);

	(async () => {
		await Promise.all([drain(child.stdout, run), drain(child.stderr, run)]);
		run.code = await child.exited;
		run.endedAt = Date.now();
		run.problems = await findProblems(run.output, cwd);
		run.tests = testCounts(run.output);
		delete run.process;
		announce(sessionId);
	})().catch(error => console.error(`Task ${found.name} failed to run:`, error));

	return summary(run);
};

const signal = (pid, name) => {
	try {
		process.kill(pid, name);
	} catch {
		// Gone already
	}
};

// A run, with everything it started (marked with it), whatever they did with their process groups
export const stopRun = async (sessionId, runId) => {
	const run = (runs.get(sessionId) ?? []).find(found => found.id === runId);

	if (!run || run.code !== undefined) throw new TaskError('That run has finished');

	run.stopped = true;

	const tree = (await sessionProcesses()).filter(found => found.task === runId).map(found => found.pid);

	for (const pid of tree) signal(pid, 'SIGTERM');
	setTimeout(() => tree.forEach(pid => signal(pid, 'SIGKILL')), STOP_AFTER_MS).unref();
};

// A process the session runs (Claude itself excepted), on someone's say-so in the Tasks panel
export const stopProcess = async (sessionId, pid) => {
	const found = (await sessionProcesses()).find(each => each.pid === Number(pid) && each.session === sessionId);

	if (!found || found.own) throw new TaskError('Not a process of this session');

	signal(found.pid, 'SIGTERM');
};

// paude's own holder (dtach) keeps the session alive; it isn't something the session runs
const PLUMBING = new Set(['dtach']);

export const processesOf = async sessionId =>
	(await sessionProcesses())
		.filter(found => found.session === sessionId && !found.own && !PLUMBING.has(found.command))
		.map(({ pid, command, args, cpuSeconds, memoryBytes, startedAt, task: runId }) => ({
			pid,
			command,
			args,
			cpuSeconds,
			memoryBytes,
			startedAt,
			run: runId,
		}));

// Tasks that run after each of Claude's turns that edited something, per project: { [project]: [taskId] }
let afterTurnFile;
let afterTurn = {};

export const initTasks = async dataDir => {
	afterTurnFile = path.join(dataDir, 'after-turn-tasks.json');
	afterTurn = await readJsonFile(afterTurnFile, {});
};

export const afterTurnTasks = project => afterTurn[project] ?? [];

export const setAfterTurn = async (project, taskId, on) => {
	const now = new Set(afterTurnTasks(project));

	if (on) now.add(taskId);
	else now.delete(taskId);
	afterTurn = { ...afterTurn, [project]: [...now] };
	if (!afterTurn[project].length) delete afterTurn[project];
	await writeJsonFile(afterTurnFile, () => afterTurn);
};
