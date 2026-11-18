import { closeSync, openSync } from 'fs';
import { readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import { join } from 'path';

import gitEnvironment from './utils/gitEnvironment';

const FETCH_EVERY_MS = 60_000;
const GIT_TIMEOUT_MS = 60_000;
const INCOMING_SHOWN = 20;
const LOG_LINES_SHOWN = 12;
const EXIT_MARK = 'paude-update-exit';

// What the installer set up runs this paude: the unit or agent it writes names the folder it runs from
const SERVICE_FILES = {
	linux: join('.config', 'systemd', 'user', 'paude.service'),
	darwin: join('Library', 'LaunchAgents', 'com.github.fatlard1993.paude.plist'),
};

let setup;
let fetchedAt = 0;

export const initSelfUpdate = ({ app = process.cwd(), data, projects, port, home = os.homedir() }) => {
	setup = {
		app,
		data,
		projects,
		port,
		service: SERVICE_FILES[process.platform] && join(home, SERVICE_FILES[process.platform]),
	};
	fetchedAt = 0;
};

const logFile = () => join(setup.data, 'update.log');
const pidFile = () => join(setup.data, 'update.pid');

const git = async (args, { timeout = GIT_TIMEOUT_MS } = {}) => {
	const child = Bun.spawn(['git', ...args], {
		cwd: setup.app,
		env: { ...gitEnvironment(), GIT_TERMINAL_PROMPT: '0' },
		stdout: 'pipe',
		stderr: 'ignore',
		timeout,
	});
	const out = await new Response(child.stdout).text();

	return (await child.exited) === 0 ? out.trim() : null;
};

const alive = pid => {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
};

const runningPid = async () => {
	const pid = Number((await readFile(pidFile(), 'utf8').catch(() => '')).trim());

	return pid > 0 && alive(pid) ? pid : null;
};

// The last run's output, and how it ended (null while it runs, or when it never got to say)
const lastRun = async () => {
	const text = await readFile(logFile(), 'utf8').catch(() => null);

	if (text === null) return null;

	const lines = text.trimEnd().split('\n');
	const ended = new RegExp(`^${EXIT_MARK} (\\d+)$`).exec(lines.at(-1) ?? '');

	return {
		log: (ended ? lines.slice(0, -1) : lines).slice(-LOG_LINES_SHOWN).join('\n'),
		exit: ended ? Number(ended[1]) : null,
	};
};

// How this paude runs: 'installed' (the installer's service, from a clone it can pull), 'development' (a checkout,
// which updates as it's saved), or 'manual' (started by hand, which the installer would set up anew instead)
const kindOf = async () => {
	if (process.env.NODE_ENV !== 'production') return 'development';
	if ((await git(['rev-parse', '--is-inside-work-tree'])) !== 'true') return 'manual';

	const service = await readFile(setup.service ?? '', 'utf8').catch(() => '');

	return service.includes(setup.app) ? 'installed' : 'manual';
};

// Where this paude stands against what it would pull: asked of its remote at most once a minute, or now when `fresh`
export const updateState = async ({ fresh = false } = {}) => {
	const kind = await kindOf();
	const [running, last] = [Boolean(await runningPid()), await lastRun()];

	if (kind !== 'installed') return { kind, running, last };

	if (fresh || Date.now() - fetchedAt > FETCH_EVERY_MS) {
		fetchedAt = Date.now();
		await git(['fetch', '--quiet']);
	}

	const [head, upstream] = await Promise.all([git(['rev-parse', 'HEAD']), git(['rev-parse', '@{u}'])]);
	const incoming = upstream
		? ((await git(['log', '--format=%h%x09%s', `-n${INCOMING_SHOWN}`, 'HEAD..@{u}'])) ?? '')
				.split('\n')
				.filter(Boolean)
				.map(line => {
					const [sha, ...subject] = line.split('\t');

					return { sha, subject: subject.join('\t') };
				})
		: [];
	const behind = upstream ? Number(await git(['rev-list', '--count', 'HEAD..@{u}'])) : 0;

	return { kind, running, last, head: head?.slice(0, 7) ?? null, behind, incoming };
};

export class UpdateError extends Error {}

// The installer, run as from a terminal, on this paude's own folders and port. It restarts the service under itself:
// the service stops its main process alone (systemd's KillMode=process, launchd's AbandonProcessGroup), so the run
// outlives the server it replaces and says how it ended in the log the new server reads.
export const startUpdate = async () => {
	if ((await kindOf()) !== 'installed') throw new UpdateError('This paude is not run by the installer');
	if (await runningPid()) throw new UpdateError('An update is already running');

	const { app, data, projects, port } = setup;
	const { NODE_ENV: _, ...environment } = process.env;
	const log = openSync(logFile(), 'w');

	try {
		const child = Bun.spawn(
			['sh', '-c', `sh scripts/install.sh; code=$?; echo "${EXIT_MARK} $code"; rm -f "$0"; exit $code`, pidFile()],
			{
				cwd: app,
				env: {
					...environment,
					PAUDE_APP: app,
					PAUDE_DATA: data,
					PAUDE_PROJECTS: projects,
					PAUDE_PORT: String(port),
				},
				stdio: ['ignore', log, log],
				detached: true,
			},
		);

		child.unref();
		await writeFile(pidFile(), `${child.pid}\n`);
	} catch (error) {
		await rm(pidFile(), { force: true });
		throw error;
	} finally {
		closeSync(log);
	}
};
