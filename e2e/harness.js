import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import puppeteer from 'puppeteer-core';

const ROOT = path.join(import.meta.dir, '..');
const FAKE_CLAUDE = path.join(import.meta.dir, 'fakeClaude.js');
const CHROMES = [
	process.env.CHROME,
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

// What a Claude started from this shell would inherit from a Claude session running the tests (no transcript, no color)
const CLAUDE_ENVIRONMENT = /^(CLAUDE|NO_COLOR$|FORCE_COLOR$)/;

const freePort = () => {
	const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
	const { port } = listener;

	listener.stop();

	return port;
};

// A throwaway paude: its own data, settings and a git project ("demo") with a file the fake names. `claude` is the
// real one when given; the fake otherwise, `fake` choosing how it behaves.
// `noPullRequest`: a gh that finds no pull request for any branch, so the Review tab offers to open one
// `noGh`: no gh at all, so a pull request comes from GitHub's own ref for it on origin
export const startServer = async ({
	claude = FAKE_CLAUDE,
	fake = 'turns',
	noPullRequest = false,
	noGh = false,
} = {}) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'paude-e2e-'));
	const project = path.join(dir, 'projects', 'demo');
	const port = freePort();
	const previewPort = freePort();

	await mkdir(path.join(project, 'server'), { recursive: true });
	await writeFile(
		path.join(project, 'server', 'app.js'),
		Array.from({ length: 20 }, (_, n) => `line ${n + 1}`).join('\n'),
	);
	Bun.spawnSync(['git', 'init', '-q', '-b', 'main'], { cwd: project });
	Bun.spawnSync(['git', 'config', 'user.name', 'Tester'], { cwd: project });
	Bun.spawnSync(['git', 'config', 'user.email', 'tester@example.com'], { cwd: project });
	Bun.spawnSync(['git', 'config', 'commit.gpgsign', 'false'], { cwd: project });
	Bun.spawnSync(['git', 'add', '-A'], { cwd: project });

	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !CLAUDE_ENVIRONMENT.test(key)));

	if (noGh)
		env.PATH = env.PATH.split(':')
			.filter(folder => !Bun.spawnSync(['test', '-e', path.join(folder, 'gh')]).success)
			.join(':');
	if (noPullRequest) {
		await mkdir(path.join(dir, 'bin'));
		await writeFile(path.join(dir, 'bin', 'gh'), '#!/bin/sh\necho "no pull requests found for branch" >&2\nexit 1\n', {
			mode: 0o755,
		});
		env.PATH = `${path.join(dir, 'bin')}:${env.PATH}`;
	}
	const server = Bun.spawn(
		[
			'bun',
			'server/index.js',
			'--projects',
			path.join(dir, 'projects'),
			'--port',
			String(port),
			'--data',
			path.join(dir, 'data'),
			'--claude',
			claude,
			'--preview-port',
			String(previewPort),
		],
		{
			cwd: ROOT,
			env: {
				...env,
				NODE_ENV: 'production',
				XDG_CONFIG_HOME: path.join(dir, 'config'),
				PAUDE_E2E_FAKE: fake,
				// The fake writes no transcript; a test writes one here. The real Claude keeps its own (its login is there).
				...(claude === FAKE_CLAUDE && { CLAUDE_CONFIG_DIR: path.join(dir, 'claude') }),
			},
			stdout: 'ignore',
			stderr: 'ignore',
		},
	);
	const url = `http://127.0.0.1:${port}`;

	// Slow to start on a loaded machine
	for (const until = Date.now() + 30_000; !(await fetch(`${url}/api/auth`).catch(() => null))?.ok;) {
		if (Date.now() > until) throw new Error('The test server never answered');
		await Bun.sleep(100);
	}

	const token = (await Bun.file(path.join(dir, 'data', 'local-token')).text()).trim();
	const api = (route, init = {}) =>
		fetch(`${url}${route}`, {
			...init,
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
		});

	// What Claude Code's hooks would post about a session: { hook_event_name, notification_type, ... }
	const hook = async (sessionId, payload) => {
		const secret = (await Bun.file(path.join(dir, 'data', 'hook-secret')).text()).trim();

		return fetch(`${url}/api/hooks/${secret}/${sessionId}`, { method: 'POST', body: JSON.stringify(payload) });
	};

	// A transcript as Claude Code keeps one, for a session the fake runs
	// Each line names its session and folder, as Claude Code writes them
	const writeTranscript = (sessionId, lines) =>
		Bun.write(
			path.join(dir, 'claude', 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`),
			lines.map(line => JSON.stringify({ sessionId, cwd: project, ...line })).join('\n'),
		);

	return {
		url,
		hook,
		writeTranscript,
		// Logs this server's machine into another, as `paude login` would, under a name
		logInto: (other, name) =>
			Bun.write(
				path.join(dir, 'config', 'paude', 'credentials.json'),
				JSON.stringify({ default: other.url, tokens: { [other.url]: other.token }, names: { [other.url]: name } }),
			),
		token,
		previewUrl: `http://127.0.0.1:${previewPort}`,
		project,
		api,
		newSession: async () =>
			(await (await api('/api/projects/demo/sessions', { method: 'POST', body: '{}' })).json()).id,
		// A link that logs a browser in as the owner and lands on `to`
		loginLink: async to =>
			`${url}/#/handoff/${(await (await api('/api/handoff', { method: 'POST' })).json()).code}${to}`,
		stop: async () => {
			server.kill();
			await server.exited;
			// Sessions outlive their server on purpose, held open to come back to; a test's own end with it
			Bun.spawnSync(['pkill', '-KILL', '-f', `${dir}/`]);
			await rm(dir, { recursive: true, force: true });
		},
	};
};

const MAC_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// The ways a browser draws paude differently: xterm's DOM renderer, its GPU renderer (which a test machine's software
// GL would otherwise turn off), and a Mac
export const VARIANTS = ['dom', 'webgl', 'mac'];

export const openBrowser = async variant => {
	const executablePath = CHROMES.find(candidate => candidate && Bun.file(candidate).size);
	const browser = await puppeteer.launch({
		executablePath,
		// Over a pipe, Chrome quits when the test process dies however it dies; over a port, a killed run leaves it
		pipe: true,
		args:
			variant === 'webgl'
				? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
				: ['--disable-webgl'],
	});
	const page = await browser.newPage();

	await page.setViewport({ width: 1300, height: 800 });
	if (variant === 'mac') {
		await page.setUserAgent(MAC_AGENT);
		await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
	}
	if (variant === 'webgl')
		await page.evaluateOnNewDocument(() => {
			const read = WebGL2RenderingContext.prototype.getParameter;

			// paude keeps xterm off software GL; claiming a real GPU puts its WebGL renderer to the test
			WebGL2RenderingContext.prototype.getParameter = function getParameter(name) {
				return name === 0x9246 ? 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)' : read.call(this, name);
			};
		});

	return { browser, page };
};

// The middle of the cell at a 0-based row and column of the session's screen, as page coordinates. xterm sizes its
// hidden text input to one cell, under either renderer; the screen's scale covers a session shrunk to fit.
export const cellCenter = async (page, row, column) =>
	page.evaluate(
		({ row, column }) => {
			const screen = document.querySelector('.xterm-screen');
			const box = screen.getBoundingClientRect();
			const input = document.querySelector('.xterm-helper-textarea').style;
			const scale = box.width / screen.offsetWidth;

			return {
				x: box.left + (column + 0.5) * parseFloat(input.width) * scale,
				y: box.top + (row + 0.5) * parseFloat(input.height) * scale,
			};
		},
		{ row, column },
	);

// How long a test waits on the page before it gives up: a loaded machine draws slowly
export const PATIENCE_MS = 15_000;

const boxOf = (page, selector, text) =>
	page.evaluate(
		({ selector, text }) => {
			const found = [...document.querySelectorAll(selector)].find(node => !text || node.textContent.includes(text));

			// Scrolled to first, as a person would, when it's down a panel's list
			found?.scrollIntoView({ block: 'center' });

			const box = found?.getBoundingClientRect();

			if (!box?.width) return null;

			const x = box.x + box.width / 2;
			const y = box.y + box.height / 2;
			const hit = document.elementFromPoint(x, y);

			// What a click there would reach: this, or something it holds
			return { x, y, reached: Boolean(hit && (found.contains(hit) || hit.contains(found))) };
		},
		{ selector, text },
	);

// Where a button is, to click it as a person would: some of paude's buttons act on the press, not on click(). Once
// it's there, has stopped moving and a click would reach it: a panel slides in, a menu fades in over what's under it,
// and a click at where it was mid-way lands on something else.
export const centerOf = async (page, selector, text) => {
	const until = Date.now() + PATIENCE_MS;
	let last;

	for (;;) {
		const now = await boxOf(page, selector, text);
		const settled = now?.reached && last && now.x === last.x && now.y === last.y;

		if (settled) return { x: now.x, y: now.y };
		if (Date.now() > until) {
			if (!now) throw new Error(`Nothing to press: ${selector}${text ? ` with "${text}"` : ''}`);
			// Covered on purpose, or always moving: where it is, as a person would aim at it anyway
			return { x: now.x, y: now.y };
		}
		last = now;
		await Bun.sleep(100);
	}
};

// Reads until the checks in it pass, rather than once after a guess at how long the page takes
export const eventually = async (check, timeout = PATIENCE_MS) => {
	const until = Date.now() + timeout;

	for (;;) {
		try {
			return await check();
		} catch (error) {
			if (Date.now() > until) throw error;
			await Bun.sleep(200);
		}
	}
};

// Typed into the dialog just opened, once its input has the focus: it takes it a moment after it opens
export const typeInDialog = async (page, text) => {
	await page.waitForFunction(() => document.activeElement?.matches('dialog[open] input'), { timeout: PATIENCE_MS });
	await page.keyboard.type(text);
};
