import { createHash } from 'crypto';
import { stat } from 'fs/promises';
import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { gamePort } from './gamePort';
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

// A test run's counts, from the common runners' summaries: { passed, failed, errors } or null. Errors are what broke
// outside a test (a file that wouldn't load, a fixture that threw, a suite that never ran).
export const testCounts = text => {
	const plain = plainOutput(text);
	const number = pattern => Number(pattern.exec(plain)?.[1] ?? 0);
	const bun = /^\s*(\d+) pass$/m.test(plain) && {
		passed: number(/^\s*(\d+) pass$/m),
		failed: number(/^\s*(\d+) fail$/m),
		errors: number(/^\s*(\d+) errors?$/m),
	};
	const jest = /Tests:\s+.*?(\d+) passed/.test(plain) && {
		passed: number(/Tests:.*?(\d+) passed/),
		failed: number(/Tests:.*?(\d+) failed/),
		errors: number(/Test Suites:.*?(\d+) failed/),
	};
	const pytest = /=+ .*?(\d+) passed/.test(plain) && {
		passed: number(/(\d+) passed/),
		failed: number(/(\d+) failed/),
		errors: number(/=+ .*?(\d+) errors?\b/),
	};
	const cargo = /test result: \w+\. (\d+) passed/.test(plain) && {
		passed: number(/(\d+) passed/),
		failed: number(/(\d+) failed/),
		errors: 0,
	};
	const go = /^(ok|FAIL)\s+\S+/m.test(plain) && {
		passed: (plain.match(/^ok\s+\S+/gm) ?? []).length,
		failed: (plain.match(/^FAIL\s+\S+/gm) ?? []).length,
		errors: 0,
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

const GAME_SERVER = 'package.json:dev';
const ARCADE_MARKER = '.paude-arcade.json';

// An arcade's dev server, running whenever its Claude works: started at each prompt and each question when it isn't
// (it died, or the project has only now been given a dev script), rather than only when someone opens the arcade's
// page, so Claude never builds for long against a server that's down. One someone stopped stays stopped. Whether it
// was started.
export const keepServing = async (sessionId, cwd, { start = runTask } = {}) => {
	const latest = (runs.get(sessionId) ?? []).findLast(run => run.taskId === GAME_SERVER);

	if (latest && (latest.code === undefined || latest.stopped)) return false;
	if (!(await readJsonFile(path.join(cwd, 'package.json'), null).catch(() => null))?.scripts?.dev) return false;

	await start(sessionId, cwd, GAME_SERVER);

	return true;
};

export const runTask = async (sessionId, cwd, taskId) => {
	const found = (await discoverTasks(cwd)).find(each => each.id === taskId);

	if (!found) throw new TaskError('No such task in this project');

	const sessionRuns = runs.get(sessionId) ?? [];

	if (sessionRuns.some(run => run.taskId === taskId && run.code === undefined))
		throw new TaskError(`${found.name} is already running`);

	if (!Bun.which(found.command[0], { PATH: sessionEnvironment().PATH }))
		throw new TaskError(`${found.command[0]} isn't installed here, so ${found.name} can't run`);

	// One left by an earlier paude would hold the game's port (moving this one to another) and run old code beside it
	await reapLeftoverRuns();

	const id = crypto.randomUUID();
	const run = { id, taskId, name: found.name, command: found.command, startedAt: Date.now(), output: '' };
	// An arcade game's server keeps one port, so starting over on a save doesn't move the game out from under its page
	const arcadeGame = taskId === GAME_SERVER && (await stat(path.join(cwd, ARCADE_MARKER)).catch(() => null));
	const port = arcadeGame ? gamePort(cwd) : null;
	// Its saves and its page its own, as it's built, apart from the live copy the house runs of the same folder (a game
	// on the mother hub): the two writing one file each overwrite the other's games, and the live copy serving the
	// working copy's newest page pairs it with an older server
	const saves = arcadeGame && dataDir ? workingSaves(cwd) : null;
	const page = arcadeGame && dataDir ? workingBuild(cwd) : null;
	const child = Bun.spawn(found.command, {
		cwd,
		env: {
			...sessionEnvironment(),
			...(port ? { PORT: String(port) } : {}),
			...(saves ? { GAME_DATABASE: saves } : {}),
			...(page ? { GAME_BUILD: page } : {}),
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

const terminate = pids => {
	for (const pid of pids) signal(pid, 'SIGTERM');
	setTimeout(() => pids.forEach(pid => signal(pid, 'SIGKILL')), STOP_AFTER_MS).unref();
};

// A run, with everything it started (marked with it), whatever they did with their process groups
export const stopRun = async (sessionId, runId) => {
	const run = (runs.get(sessionId) ?? []).find(found => found.id === runId);

	if (!run || run.code !== undefined) throw new TaskError('That run has finished');

	run.stopped = true;
	terminate((await sessionProcesses()).filter(found => found.task === runId).map(found => found.pid));
};

// What a process runs, or '' once it's gone
const commandOf = pid => {
	const { stdout } = Bun.spawnSync(['ps', '-o', 'command=', '-p', String(pid)]);

	return stdout.toString().trim();
};

const isPaude = pid => pid === process.pid || /\bserver\/index\.js\b.*--port/.test(commandOf(pid));

// Runs left by a paude that has since gone (restarted or crashed): nothing reads what they print or will stop them,
// and a game server among them keeps its port, its old code and its hold on the game's saves, beside the copy started
// in its place. A run's tree is left over once the top of it has no paude above it any more (another paude on this
// machine keeps its own). Stopped, and the pids returned once they're gone, or after a while.
export const reapLeftoverRuns = async ({ processes = sessionProcesses, wait = true } = {}) => {
	const runsOf = Map.groupBy(
		(await processes()).filter(found => found.task && found.parent),
		found => found.task,
	);
	const leftover = [...runsOf.values()].flatMap(tree => {
		const inTree = new Set(tree.map(({ pid }) => pid));
		const tops = tree.filter(({ parent }) => !inTree.has(parent));

		return tops.some(({ parent }) => isPaude(parent)) ? [] : tree.map(({ pid }) => pid);
	});

	if (!leftover.length) return [];
	console.log(`Stopping ${leftover.length} process(es) left running by an earlier paude: ${leftover.join(', ')}`);
	terminate(leftover);
	for (let waited = 0; wait && waited < STOP_AFTER_MS + 500; waited += 100) {
		if (leftover.every(pid => !commandOf(pid))) break;
		await Bun.sleep(100);
	}

	return leftover;
};

// Every run of a session, found by the mark its processes carry, so one started before paude last restarted (and
// so forgotten here) stops too
export const stopTasksOf = async sessionId => {
	for (const run of runs.get(sessionId) ?? []) if (run.code === undefined) run.stopped = true;
	terminate(
		(await sessionProcesses()).filter(found => found.session === sessionId && found.task).map(found => found.pid),
	);
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
let dataDir;

// Where an arcade game's working copy keeps its saves: in paude's data, one file per folder
const workingName = cwd => `${path.basename(cwd)}-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`;

export const workingSaves = cwd => path.join(dataDir, 'arcade-saves', `${workingName(cwd)}.json`);

// The working copy's built page (GAME_BUILD), outside the game's folder so it's never committed or hosted
export const workingBuild = cwd => path.join(dataDir, 'arcade-builds', workingName(cwd));

export const initTasks = async folder => {
	dataDir = folder;
	afterTurnFile = path.join(folder, 'after-turn-tasks.json');
	afterTurn = await readJsonFile(afterTurnFile, {});
	await reapLeftoverRuns({ wait: false }).catch(error => console.warn(`Leftover runs not stopped: ${error.message}`));
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
