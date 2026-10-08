// The web client against a fake Claude that draws as the real one does (bun run test:e2e). Each runs in every
// browser variant: these bugs showed only on a GPU renderer, a Mac, or a session that's printing.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { folderHue, folderTints } from '../shared/folderColor';
import { VARIANTS, cellCenter, centerOf, openBrowser, startServer } from './harness';

const TIMEOUT_MS = 60_000;
const wait = ms => Bun.sleep(ms);

const servers = {};

beforeAll(async () => {
	[servers.turns, servers.busy] = await Promise.all([startServer(), startServer({ fake: 'busy' })]);
});
afterAll(() => Promise.all(Object.values(servers).map(server => server.stop())));

const openSession = async (variant, server) => {
	const { browser, page } = await openBrowser(variant);
	const id = await server.newSession();

	await browser
		.defaultBrowserContext()
		.overridePermissions(server.url, ['clipboard-read', 'clipboard-sanitized-write']);
	await page.goto(await server.loginLink(`/sessions/${id}`));
	await page.waitForSelector('.xterm-screen');
	await wait(2000);

	return { browser, page };
};

const drag = async (page, from, to) => {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 6 });
	await page.mouse.up();
	await wait(300);
};

describe.each(VARIANTS)('%s', variant => {
	test(
		'every done line gets a new-session button, on the alternate screen too, and it asks first',
		async () => {
			const { browser, page } = await openSession(variant, servers.turns);

			try {
				expect(await page.$$eval('.fork-here', buttons => buttons.length)).toBe(2);

				const fork = await centerOf(page, '.fork-here');

				await page.mouse.click(fork.x, fork.y);
				await wait(800);
				expect(await page.evaluate(() => document.body.innerText)).toMatch(/New session from here\?|Could not/);
			} finally {
				await browser.close();
			}
		},
		TIMEOUT_MS,
	);

	test(
		"the selection's Copy takes the click while Claude prints, and copies",
		async () => {
			const { browser, page } = await openSession(variant, servers.busy);

			try {
				await drag(page, await cellCenter(page, 2, 2), await cellCenter(page, 2, 14));

				const copy = await centerOf(page, 'button', 'Copy');

				expect(copy).toBeTruthy();
				await page.mouse.click(copy.x, copy.y);
				await wait(500);
				expect((await page.evaluate(() => navigator.clipboard.readText())).length).toBeGreaterThan(5);
			} finally {
				await browser.close();
			}
		},
		TIMEOUT_MS,
	);

	test(
		'a file path opens the files panel at its line, and Esc closes it',
		async () => {
			const { browser, page } = await openSession(variant, servers.turns);

			try {
				const where = await cellCenter(page, 2, 30);

				await page.mouse.move(where.x, where.y);
				await wait(300);
				await page.mouse.click(where.x, where.y);
				await wait(1000);
				expect(await page.$eval('.files', panel => panel.classList.contains('open'))).toBe(true);
				expect(await page.$eval('.files .band', band => band.style.top)).toBe('40px');

				await page.keyboard.press('Escape');
				await wait(300);
				expect(await page.$eval('.files', panel => panel.classList.contains('open'))).toBe(false);
			} finally {
				await browser.close();
			}
		},
		TIMEOUT_MS,
	);
});

// The session wears its folder's color, as kitty-bg would tint a terminal started there: the screen and the bar's edge
test(
	"a session is tinted with its folder's color",
	async () => {
		const { browser, page } = await openSession('dom', servers.turns);
		const { background, accent } = folderTints(folderHue(servers.turns.project));

		try {
			const painted = await page.$eval('.tinted', view => ({
				background: view.style.getPropertyValue('--session-background'),
				accent: view.style.getPropertyValue('--session-accent'),
			}));

			expect(painted).toEqual({ background, accent });
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

// Plain page elements, so one browser does: the Git panel commits, shows the history and a commit's diff, branches,
// and discards an edit after asking
test(
	'git: commit, history, a commit in the diff view, a branch, and a discard',
	async () => {
		const { browser, page } = await openSession('dom', servers.turns);
		const git = selector => page.$eval(`.git ${selector}`, node => node.textContent);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};

		try {
			await press('[title^="Git"]');
			expect(await page.$eval('.git', panel => panel.classList.contains('open'))).toBe(true);
			expect(await git('.body')).toContain('server/app.js');

			await page.type('.git .commit-box textarea', 'first from the panel');
			await press('.git .commit-box button', 'Commit');
			expect(await git('.body')).toContain('Nothing changed since the last commit');

			await press('.git .tabs button', 'History');
			expect(await git('.body')).toContain('first from the panel');

			await press('.git .history-item');
			expect(await page.$eval('.files', panel => panel.classList.contains('open'))).toBe(true);
			expect(await page.$eval('.files .viewer', viewer => viewer.textContent)).toContain('first from the panel');

			await press('.git .tabs button', 'Branches');
			await page.type('.git .new-branch input', 'idea');
			await press('.git .new-branch button', 'Create');
			expect(await git('.bar .branch')).toBe('idea');

			await Bun.write(`${servers.turns.project}/server/app.js`, 'edited\n');
			await press('.git .tabs button', 'Changes');
			await press('.git .file [title="Discard"]');
			await press('button', 'Discard');
			expect(await Bun.file(`${servers.turns.project}/server/app.js`).text()).toStartWith('line 1');
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

// A dev server as the session would start one (marked with its PAUDE_SESSION), resolving to its port once it listens
const startDevServer = async (server, sessionId) => {
	const dev = Bun.spawn(['bun', `${import.meta.dir}/fixtures/devServer.js`], {
		env: { ...process.env, PAUDE_SESSION: sessionId },
		stdout: 'pipe',
	});
	const port = Number(new TextDecoder().decode((await dev.stdout.getReader().read()).value).trim());

	return { dev, port };
};

const sharesOf = async (server, id, until) => {
	for (let tries = 0; tries < 30; tries++) {
		const { shares } = await (await server.api(`/api/sessions/${id}/shares`)).json();

		if (until(shares)) return shares;
		await wait(500);
	}

	throw new Error('The shares never showed up');
};

test(
	"shares: a session's dev server is found and served, its absolute paths and WebSocket too, out of paude's reach and only to a login",
	async () => {
		const server = servers.turns;
		const id = await server.newSession();
		const { dev, port } = await startDevServer(server, id);
		const { browser, page } = await openBrowser('dom');
		const stranger = await openBrowser('dom');

		try {
			const [share] = await sharesOf(server, id, shares => shares.some(found => found.port === port));
			const link = share.url.replace(/^https?:\/\/[^/]+/, server.previewUrl);

			await page.goto(await server.loginLink(`/sessions/${id}`));
			await page.waitForSelector('.xterm-screen');
			await page.goto(link);
			await wait(1500);
			expect(await page.title()).toBe('app loaded');
			expect(await page.evaluate(() => document.body.dataset.echo)).toBe('echo ping');

			const reachedPaude = await page.evaluate(async origin => {
				try {
					await fetch(`${origin}/api/auth`, { credentials: 'include' });

					return true;
				} catch {
					return false;
				}
			}, server.url);

			expect(reachedPaude).toBe(false);

			await stranger.page.goto(link);
			expect(await stranger.page.title()).toBe('Log in to paude first');
		} finally {
			dev.kill();
			await Promise.all([browser.close(), stranger.browser.close()]);
		}
	},
	TIMEOUT_MS,
);

test(
	'shares panel: a file to download and a folder as a site, listed with their links',
	async () => {
		const server = servers.turns;

		await Bun.write(`${server.project}/site/index.html`, '<title>the site</title><p>hello');

		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};

		try {
			await press('[title^="Shared"]');
			await page.type('.shares form:last-of-type input', 'server/app.js');
			await press('.shares form:last-of-type button', 'Download');
			await page.type('.shares form:last-of-type input', 'site');
			await press('.shares form:last-of-type button', 'Site');

			const links = await page.$$eval('.shares .share a', anchors =>
				anchors.map(anchor => [anchor.textContent, anchor.href]),
			);

			expect(links.map(([label]) => label)).toEqual(['server/app.js', 'site, as a site']);

			const sitePage = await browser.newPage();

			await sitePage.goto(links[1][1].replace(/^https?:\/\/[^/]+/, server.previewUrl));
			expect(await sitePage.title()).toBe('the site');

			const download = await sitePage.evaluate(
				async url => (await fetch(url)).headers.get('content-disposition'),
				links[0][1].replace(/^https?:\/\/[^/]+/, server.previewUrl),
			);

			expect(download).toContain("attachment; filename*=UTF-8''app.js");
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	'back offers the sessions waiting for you, and opens one',
	async () => {
		const server = servers.turns;
		const waiting = await server.newSession();

		await server.api(`/api/sessions/${waiting}/watch`, { method: 'PUT', body: JSON.stringify({ watching: true }) });
		await server.hook(waiting, { hook_event_name: 'Notification', notification_type: 'permission_prompt' });

		const { browser, page } = await openSession('dom', server);

		try {
			await page.waitForFunction(() => document.querySelector('[title^="Back, or one of"]'), { timeout: 20_000 });

			const back = await centerOf(page, '[title^="Back, or one of"]');

			await page.mouse.click(back.x, back.y);
			await wait(400);

			const rows = await page.$$eval('button', buttons =>
				buttons.filter(row => row.querySelector('.detail')).map(row => row.textContent),
			);

			expect(rows.length).toBe(1);
			await page.click('button:has(.detail)');
			await wait(800);
			expect(await page.evaluate(() => window.location.hash)).toBe(`#/sessions/${waiting}`);
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	"the files viewer shows a file's history and blame; Claude drafts the commit message",
	async () => {
		const server = servers.turns;
		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};

		try {
			await Bun.write(`${server.project}/notes.txt`, 'one\ntwo\n');
			Bun.spawnSync(['git', 'add', 'notes.txt'], { cwd: server.project });
			await press('[title^="Git"]');
			await press('.git button', 'Claude, write it');
			expect(await page.$eval('.git .commit-box textarea', box => box.value)).toBe('describe the staged change');
			await press('.git .commit-box button', 'Commit');

			await press('[title="Project files"]');
			await page.type('.files .bar input', 'notes.txt');
			await wait(500);
			await press('.files .entry', 'notes.txt');
			await press('.files .head button', 'Blame');
			expect(await page.$eval('.files .blame', column => column.textContent)).toContain('Tester');
			await press('.files .head button', 'History');
			expect(await page.$eval('.files .file-history', list => list.textContent)).toContain(
				'describe the staged change',
			);
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	'a found service is named for its project and port, and can be renamed',
	async () => {
		const server = servers.turns;
		const id = await server.newSession();
		const { dev, port } = await startDevServer(server, id);

		try {
			const [share] = await sharesOf(server, id, shares => shares.some(found => found.port === port));

			expect(share.name).toBe(`demo-${port}`);

			const renamed = await (
				await server.api(`/api/sessions/${id}/shares/${share.id}`, {
					method: 'PATCH',
					body: JSON.stringify({ name: 'My Shop' }),
				})
			).json();

			expect(renamed.url).toEndWith('/s/my-shop/');
			expect((await (await server.api(`/api/sessions/${id}/shares`)).json()).shares[0].name).toBe('my-shop');
		} finally {
			dev.kill();
		}
	},
	TIMEOUT_MS,
);

test(
	"activity: the turns, their steps, a command's output and the context in use",
	async () => {
		const server = servers.turns;
		const id = await server.newSession();
		const at = second => `2026-10-07T12:00:${String(second).padStart(2, '0')}.000Z`;

		await server.writeTranscript(id, [
			{ type: 'user', uuid: 'p1', timestamp: at(0), message: { content: 'run the tests' } },
			{
				type: 'assistant',
				timestamp: at(2),
				message: {
					model: 'claude-opus-5-5',
					usage: { input_tokens: 10, cache_read_input_tokens: 41_990, output_tokens: 5 },
					content: [
						{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'bun test', description: 'Run the tests' } },
					],
				},
			},
			{
				type: 'user',
				timestamp: at(7),
				message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '3 pass\n1 fail', is_error: true }] },
			},
		]);

		const { browser, page } = await openBrowser('dom');

		try {
			await page.goto(await server.loginLink(`/sessions/${id}`));
			await page.waitForSelector('.xterm-screen');

			const open = await centerOf(page, '[title^="Activity"]');

			await page.mouse.click(open.x, open.y);
			await wait(800);
			expect(await page.$eval('.activity .bar', bar => bar.textContent)).toContain('context 42k tokens');
			expect(await page.$eval('.activity .turn-head', head => head.textContent)).toContain('1 failed');

			const step = await centerOf(page, '.activity .step-line');

			await page.mouse.click(step.x, step.y);
			await wait(300);
			expect(await page.$eval('.activity .step-output', output => output.textContent)).toBe('3 pass\n1 fail');
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	"tasks: the project's scripts run from the panel, their problems open the file, and the output streams",
	async () => {
		const server = servers.turns;

		await Bun.write(
			`${server.project}/package.json`,
			JSON.stringify({
				scripts: { check: 'echo "server/app.js:4:2: error: something is off" && exit 1', hello: 'echo hi there' },
			}),
		);

		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(1000);
		};

		try {
			await press('[title^="Tasks"]');
			expect(await page.$$eval('.tasks .task-name', names => names.map(name => name.textContent.trim()))).toEqual([
				'check',
				'hello',
			]);

			await press('.tasks .task [title^="Run "][title$="run check"]');
			expect(await page.$eval('.tasks .run-head', head => head.textContent)).toContain('failed');
			expect(await page.$eval('.tasks .run-output', output => output.textContent)).toContain('something is off');

			await press('.tasks .run-head [title="Back to the tasks"]');
			expect(await page.$eval('.tasks .problem', problem => problem.textContent)).toContain('server/app.js:4');

			await press('.tasks .problem');
			expect(await page.$eval('.files .band', band => band.style.top)).toBe('60px');
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	'code navigation: symbols search, an outline, Ctrl+click to a definition, and its uses',
	async () => {
		const server = servers.turns;

		await Bun.write(
			`${server.project}/lib/math.js`,
			'export const add = (a, b) => a + b;\n\nexport class Totals {\n\tsum(list) {\n\t\treturn list.reduce(add, 0);\n\t}\n}\n',
		);
		await Bun.write(`${server.project}/lib/use.js`, "import { add } from './math';\n\nconsole.log(add(1, 2));\n");
		Bun.spawnSync(['git', 'add', 'lib'], { cwd: server.project });

		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};

		try {
			await press('[title="Project files"]');
			await press('.files .bar button', 'Symbols');
			await page.type('.files .bar input', 'Tot');
			await wait(1000);
			expect(await page.$eval('.files .list', list => list.textContent)).toContain('lib/math.js:3');

			await page.$eval('.files .bar input', input => (input.value = ''));
			await press('.files .bar button', 'Names');
			await page.type('.files .bar input', 'use.js');
			await wait(500);
			await press('.files .entry', 'use.js');

			// Ctrl+click on "add" in the last line
			const where = await page.evaluate(() => {
				const code = document.querySelector('.files .source code');
				const text = code.firstChild;
				const at = text.textContent.lastIndexOf('add(');
				const range = document.createRange();

				range.setStart(text, at + 1);
				range.setEnd(text, at + 2);

				const box = range.getBoundingClientRect();

				return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
			});

			await page.keyboard.down('Control');
			await page.mouse.click(where.x, where.y);
			await page.keyboard.up('Control');
			await wait(1000);
			expect(await page.$eval('.files .viewer .path', path => path.textContent)).toBe('lib/math.js');

			await press('.files .head button', 'Outline');
			expect(await page.$eval('.files .list', list => list.textContent)).toContain('Totals');

			// Selecting a name (a double-click here, a long press on a phone) offers where it's used
			const name = await page.evaluate(() => {
				const text = document.querySelector('.files .source code').firstChild;
				const at = text.textContent.indexOf('add');
				const range = document.createRange();

				range.setStart(text, at + 1);
				range.setEnd(text, at + 2);

				const box = range.getBoundingClientRect();

				return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
			});

			await page.mouse.click(name.x, name.y, { count: 2, clickCount: 2 });
			await wait(300);
			await press('.files .name-actions button', 'Uses');
			expect(await page.$eval('.files .list', list => list.textContent)).toContain('uses of add');
			expect(await page.$eval('.files .list', list => list.textContent)).toContain('lib/use.js:3');
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	'git review: what a branch adds, with its diff; a conflict settled with one side and the merge carried on',
	async () => {
		const server = await startServer();
		const git = (...args) => Bun.spawnSync(['git', ...args], { cwd: server.project });

		git('commit', '-qm', 'first');
		git('switch', '-q', '-c', 'theirs');
		await Bun.write(`${server.project}/server/app.js`, 'theirs\n');
		git('commit', '-qam', 'their change');
		git('switch', '-q', 'main');
		git('switch', '-q', '-c', 'feature');
		await Bun.write(`${server.project}/server/app.js`, 'mine\n');
		git('commit', '-qam', 'my change');

		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(1000);
		};

		try {
			await press('[title^="Git"]');
			await press('.git .tabs button', 'Review');
			expect(await page.$eval('.git .body', body => body.textContent)).toContain('1 commit beyond main');
			expect(await page.$eval('.git .body', body => body.textContent)).toContain('my change');
			await press('.git .body button', 'Show the changes');
			expect(await page.$eval('.files .viewer', viewer => viewer.textContent)).toContain('1 commit beyond main');

			git('merge', 'theirs');
			await press('.git .tabs button', 'Changes');
			expect(await page.$eval('.git .output', output => output.textContent)).toContain('A merge is half done');
			await press('.git .file button', 'Theirs');
			await press('.git .output button', 'Continue');
			expect(await Bun.file(`${server.project}/server/app.js`).text()).toBe('theirs\n');
			expect(git('log', '-1', '--format=%s').stdout.toString()).toContain('Merge');
		} finally {
			await browser.close();
			await server.stop();
		}
	},
	TIMEOUT_MS,
);

test(
	'replace across the project after asking, the to-dos, and the environment with its secrets masked',
	async () => {
		const server = await startServer();

		await Bun.write(`${server.project}/lib/a.js`, '// TODO: rename\nconst oldName = 1;\nexport default oldName;\n');
		await Bun.write(`${server.project}/.env`, 'API_TOKEN=supersecret\n');
		Bun.spawnSync(['git', 'add', '-A'], { cwd: server.project });

		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(900);
		};

		try {
			await press('[title="Project files"]');
			await press('.files .bar button', 'Contents');
			await press('.files .list button', 'list the to-dos');
			expect(await page.$eval('.files .list', list => list.textContent)).toContain('lib/a.js:1');

			await page.type('.files .bar input', 'oldName');
			await wait(800);
			await page.type('.files .replace input', 'newName');
			await press('.files .replace button', 'Replace all');

			// The confirmation's button, the last on the page
			const confirm = await page.evaluate(() => {
				const box = [...document.querySelectorAll('button')]
					.filter(found => found.textContent.trim() === 'Replace all')
					.at(-1)
					.getBoundingClientRect();

				return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
			});

			await page.mouse.click(confirm.x, confirm.y);
			await wait(1000);
			expect(await Bun.file(`${server.project}/lib/a.js`).text()).toBe(
				'// TODO: rename\nconst newName = 1;\nexport default newName;\n',
			);

			await press('[title^="Tasks"]');
			await press('.tasks .section-head button', 'Show');

			const shown = await page.$eval('.tasks .body', body => body.textContent);

			expect(shown).toContain('API_TOKEN');
			expect(shown).not.toContain('supersecret');
		} finally {
			await browser.close();
			await server.stop();
		}
	},
	TIMEOUT_MS,
);

test(
	"on a phone the bar is back, the session's name and a menu holding the rest",
	async () => {
		const { browser, page } = await openBrowser('dom');

		try {
			await page.setViewport({ width: 390, height: 760, isMobile: true, hasTouch: true });
			await page.goto(await servers.turns.loginLink(`/sessions/${await servers.turns.newSession()}`));
			await page.waitForSelector('.xterm-screen');
			await wait(1500);

			const visible = await page.$$eval('.ghost', buttons =>
				buttons.filter(button => button.offsetParent).map(button => button.title.split(':')[0]),
			);

			// Back says how many sessions wait for you, when any do
			expect(visible.length).toBe(2);
			expect(visible[0]).toStartWith('Back');
			expect(visible[1]).toBe('Menu');

			const menu = await centerOf(page, '.ghost.tools');

			await page.touchscreen.tap(menu.x, menu.y);
			await wait(400);

			const chat = await centerOf(page, 'button', 'Chat and comments');

			await page.touchscreen.tap(chat.x, chat.y);
			await wait(600);
			expect(await page.$eval('.notes', notes => notes.classList.contains('open'))).toBe(true);
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	"links: what came up, by kind, with commands' own on asking; pinned to the top",
	async () => {
		const server = servers.turns;
		const id = await server.newSession();

		await server.writeTranscript(id, [
			{
				type: 'user',
				timestamp: '2026-10-07T12:00:00.000Z',
				message: { content: 'fix https://github.com/acme/shop/issues/12 please' },
			},
			{
				type: 'assistant',
				timestamp: '2026-10-07T12:00:05.000Z',
				message: { content: [{ type: 'text', text: 'Per https://docs.acme.dev/api the call changed.' }] },
			},
			{
				type: 'user',
				timestamp: '2026-10-07T12:00:09.000Z',
				message: {
					content: [{ type: 'tool_result', tool_use_id: 'b', content: 'fetched https://registry.acme.dev/x' }],
				},
			},
		]);

		const { browser, page } = await openBrowser('dom');
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(700);
		};
		const shown = () => page.$$eval('.links .link a', anchors => anchors.map(anchor => anchor.textContent));

		try {
			await page.goto(await server.loginLink(`/sessions/${id}`));
			await page.waitForSelector('.xterm-screen');
			await press('[title^="Links"]');
			expect(await shown()).toEqual(['docs.acme.dev/api', 'github.com/acme/shop/issues/12']);

			await press('.links .body button', 'Include what only commands printed');
			expect((await shown()).length).toBe(3);

			await press('.links .tabs button', 'Tickets');
			expect(await shown()).toEqual(['github.com/acme/shop/issues/12']);

			// Newest first, until the oldest is pinned
			await press('.links .tabs button', 'All');
			expect((await shown()).at(-1)).toBe('github.com/acme/shop/issues/12');
			await press('.links .link:last-of-type [title="Pin it to the top"]');
			expect((await shown())[0]).toBe('github.com/acme/shop/issues/12');
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	"a project's page lists the links all its sessions brought up, each naming where",
	async () => {
		const server = await startServer();
		const [first, second] = [await server.newSession(), await server.newSession()];
		const said = (text, second) => ({
			type: 'user',
			timestamp: `2026-10-07T12:00:0${second}.000Z`,
			message: { content: text },
		});

		await server.writeTranscript(first, [said('see https://github.com/acme/shop/issues/12', 1)]);
		await server.writeTranscript(second, [
			said('also https://github.com/acme/shop/issues/12 and https://docs.acme.dev/api', 2),
		]);

		const { browser, page } = await openBrowser('dom');

		try {
			await page.goto(await server.loginLink('/projects/demo'));
			await page.waitForSelector('.project-links .link');

			const links = Object.fromEntries(
				await page.$$eval('.project-links .link', rows =>
					rows.map(row => [row.querySelector('a').textContent, row.querySelectorAll('.link-sessions a').length]),
				),
			);

			// The ticket came up in both sessions, the docs in one; each session named by what began it
			expect(links).toEqual({ 'github.com/acme/shop/issues/12': 2, 'docs.acme.dev/api': 1 });
			expect(await page.$eval('.project-links .link-sessions', line => line.textContent)).toContain('see https://');
			// Shown, not only there: the panel's body is sized for a session's side and could collapse to nothing here
			expect(
				await page.$eval('.project-links .body', body => body.clientHeight >= body.scrollHeight - 1),
			).toBe(true);
		} finally {
			await browser.close();
			await server.stop();
		}
	},
	TIMEOUT_MS,
);
