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
export const startServer = async ({ claude = FAKE_CLAUDE, fake = 'turns' } = {}) => {
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

	for (let tries = 0; !(await fetch(`${url}/api/auth`).catch(() => null))?.ok; tries++) {
		if (tries > 50) throw new Error('The test server never answered');
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

		await fetch(`${url}/api/hooks/${secret}/${sessionId}`, { method: 'POST', body: JSON.stringify(payload) });
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

// Where a button is, to click it as a person would: some of paude's buttons act on the press, not on click()
export const centerOf = async (page, selector, text) =>
	page.evaluate(
		({ selector, text }) => {
			const found = [...document.querySelectorAll(selector)].find(node => !text || node.textContent.includes(text));

			// Scrolled to first, as a person would, when it's down a panel's list
			found?.scrollIntoView({ block: 'center' });

			const box = found?.getBoundingClientRect();

			return box && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		},
		{ selector, text },
	);
