// The web client against a fake Claude that draws as the real one does (bun run test:e2e). Each runs in every
// browser variant: these bugs showed only on a GPU renderer, a Mac, or a session that's printing.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

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
