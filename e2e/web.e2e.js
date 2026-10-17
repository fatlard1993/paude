// The web client against a fake Claude that draws as the real one does (bun run test:e2e). Each runs in every
// browser variant: these bugs showed only on a GPU renderer, a Mac, or a session that's printing.
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { sessionHue, tintsOf } from '../shared/hues';
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

				// Clear of all the line, not only its done time: Claude goes on after it
				const lineEnd = await cellCenter(
					page,
					10,
					'✻ Cogitated for 1m 3s · done 10:25 AM · 1 shell still running'.length - 1,
				);
				const lastFork = await page.$$eval('.fork-here', buttons => buttons.at(-1).getBoundingClientRect().left);

				expect(lastFork).toBeGreaterThan(lineEnd.x);

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
		"the side shell copies a selection with Ctrl+C or its Copy button, as Claude's screen does",
		async () => {
			const { browser, page } = await openSession(variant, servers.turns);

			try {
				await page.click('button[title^="Terminal:"]');
				await page.waitForFunction(() => document.querySelectorAll('.xterm-screen').length === 2, { timeout: 20_000 });
				await wait(1500);
				await page.keyboard.type('clear; echo side-shell-copy\n');
				await wait(800);

				const shell = await page.$$eval('.xterm-screen', screens => {
					const { x, y, width, height } = screens[1].getBoundingClientRect();

					return { x, y, width, height };
				});
				// Each from its own corner: two presses on one spot in quick succession are a double click
				const selectAll = inset =>
					drag(
						page,
						{ x: shell.x + inset, y: shell.y + inset },
						{ x: shell.x + shell.width - inset, y: shell.y + shell.height - inset },
					);

				await page.evaluate(() => navigator.clipboard.writeText('before'));
				await selectAll(2);
				await page.keyboard.down('Control');
				await page.keyboard.press('c');
				await page.keyboard.up('Control');
				await wait(500);
				expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('side-shell-copy');

				await page.evaluate(() => navigator.clipboard.writeText('before'));
				await selectAll(6);
				await page.click('.bar button[title^="Copy the selected"]');
				await wait(500);
				expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('side-shell-copy');
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

// Each session wears its own color, with kitty-bg's tints: the screen and the bar's edge
test(
	'a session is tinted with its own color',
	async () => {
		const { browser, page } = await openSession('dom', servers.turns);
		const id = page.url().split('/sessions/')[1];
		const { background, accent } = tintsOf(sessionHue(id));

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
			expect(await git('.bar .repository')).toBe('demo');
			expect(await git('.body')).toContain('server/app.js');

			await page.type('.git .commit-box textarea', 'first from the panel');
			await press('.git .commit-box button', 'Commit');
			expect(await git('.body')).toContain('Nothing changed since the last commit');

			await press('.git .tabs button', 'History');
			expect(await git('.body')).toContain('first from the panel');

			// A big project's file list loads after the commit's diff, and leaves the diff showing
			const slowList = request =>
				new URL(request.url()).pathname.endsWith('/files')
					? setTimeout(() => request.continue(), 1500)
					: request.continue();

			await page.setRequestInterception(true);
			page.on('request', slowList);
			await press('.git .history-item');
			expect(await page.$eval('.files', panel => panel.classList.contains('open'))).toBe(true);
			await wait(1500);
			expect(await page.$eval('.files .viewer', viewer => viewer.textContent)).toContain('first from the panel');
			page.off('request', slowList);
			await page.setRequestInterception(false);

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

// A screenshot dropped on the terminal is saved on the server and its path typed into the prompt
test(
	'a file dropped on the terminal goes to Claude by its path',
	async () => {
		const { browser, page } = await openSession('dom', servers.turns);
		const screenText = () =>
			page.evaluate(() => [...document.querySelectorAll('.xterm-rows > div')].map(row => row.textContent).join('\n'));

		try {
			await page.evaluate(() => {
				const files = new DataTransfer();

				files.items.add(new File(['png bytes'], 'Screen Shot.png', { type: 'image/png' }));
				document
					.querySelector('.xterm')
					.parentElement.dispatchEvent(new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true }));
			});
			await wait(1000);

			const saved = /\/\S+\/attachments\/\S+-Screen-Shot\.png/.exec(await screenText())?.[0];

			expect(saved).toBeTruthy();
			expect(await Bun.file(saved).text()).toBe('png bytes');
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
	"the tab names the session and its project, then the project, then nothing past paude's own name",
	async () => {
		const { browser, page } = await openSession('dom', servers.turns);

		try {
			await page.waitForFunction(() => document.querySelector('.breadcrumbs a.trail')?.offsetParent, {
				timeout: 20_000,
			});

			const [name, project] = await page.evaluate(() => [
				document.querySelector('.title .name').textContent,
				document.querySelector('.breadcrumbs a.trail').textContent,
			]);

			expect(await page.title()).toStartWith(name === project ? `${name} · ` : `${name} · ${project} · `);
			expect(await page.title()).toEndWith('paude');

			await page.evaluate(target => (window.location.hash = `#/projects/${encodeURIComponent(target)}`), project);
			await wait(800);
			expect(await page.title()).toStartWith(`${project} · `);

			await page.evaluate(() => (window.location.hash = '#/'));
			await wait(800);
			expect(await page.title()).not.toContain(project);
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);
test(
	"the breadcrumb counts the sessions waiting for you on their project's crumb, and opens one",
	async () => {
		const server = servers.turns;
		const waiting = await server.newSession();

		await server.api(`/api/sessions/${waiting}/watch`, { method: 'PUT', body: JSON.stringify({ watching: true }) });
		await server.hook(waiting, { hook_event_name: 'Notification', notification_type: 'permission_prompt' });

		const { browser, page } = await openSession('dom', server);

		try {
			// The waiting session is in this one's project: counted on the project's crumb, not beside paude
			await page.waitForFunction(() => document.querySelector('.breadcrumbs a.trail + .waiting')?.offsetParent, {
				timeout: 20_000,
			});
			expect(await page.$eval('.breadcrumbs a.trail + .waiting', badge => badge.textContent)).toBe('1');
			expect(await page.$eval('.breadcrumbs .server-switch + .waiting', badge => badge.offsetParent)).toBeNull();

			const badge = await centerOf(page, '.breadcrumbs a.trail + .waiting');

			await page.mouse.click(badge.x, badge.y);
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
	"a comment on a file's lines says where it is, marks them, follows them, and opens them again",
	async () => {
		const server = servers.turns;
		const original = await Bun.file(`${server.project}/server/app.js`).text();

		// A comment follows its lines from the commit it was written at
		Bun.spawnSync(['git', 'commit', '-q', '--allow-empty', '-m', 'before the comment'], { cwd: server.project });
		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};

		try {
			await press('[title="Project files"]');
			await page.type('.files .bar input', 'app.js');
			await wait(500);
			await press('.files .entry', 'app.js');
			await press('.files .gutter div', '1');
			await press('.files .head button', 'Comment');
			await page.type('.notes .draft textarea', 'why here?');
			await page.keyboard.press('Enter');
			await wait(800);

			expect(await page.$eval('.notes .comment .place', place => place.textContent)).toContain('server/app.js line 1');
			expect(await page.$$eval('.files .comment-mark', marks => marks.length)).toBe(1);

			// The bar is over the line numbers: pressing it opens the comment rather than picking the line
			await press('.files .source .comment-mark');
			expect(await page.$$eval('.notes .comment.flash', comments => comments.length)).toBe(1);

			await press('.files .back');
			await press('.notes .comment .place .where');
			expect(await page.$eval('.files .viewer .path', path => path.textContent)).toBe('server/app.js');
			expect(await page.$eval('.files .band', band => band.style.top)).toBe('0px');

			// A line added above it: the comment moves down with its line
			await Bun.write(`${server.project}/server/app.js`, `line 0\n${original}`);
			await press('.notes .comment .place .where');
			expect(await page.$eval('.files .band', band => band.style.top)).toBe('20px');
			expect(await page.$eval('.files .comment-mark', mark => mark.style.top)).toBe('20px');

			// Its own line changed: it no longer marks it
			await Bun.write(
				`${server.project}/server/app.js`,
				`line 0\nline one\n${original.split('\n').slice(1).join('\n')}`,
			);
			await press('.notes .comment .place .where');
			expect(await page.$$eval('.files .comment-mark', marks => marks.length)).toBe(0);
		} finally {
			await Bun.write(`${server.project}/server/app.js`, original);
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	'a comment on a change in a diff takes both sides, marks them, and opens in that diff again',
	async () => {
		const server = servers.turns;
		const original = await Bun.file(`${server.project}/server/app.js`).text();
		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};

		try {
			Bun.spawnSync(['git', 'commit', '-q', '--allow-empty', '-m', 'before the change'], { cwd: server.project });
			await Bun.write(`${server.project}/server/app.js`, original.replace('line 3', 'line three'));
			await press('[title="Project files"]');
			await page.type('.files .bar input', 'app.js');
			await wait(500);
			await press('.files .entry', 'app.js');
			await press('.files .head button', 'Changes');

			// From the removed line to the one that replaced it, side by side or unified as the panel's width has it
			await press('.files .diff .side.removed .number, .files .diff .line.removed .numbers');
			await page.keyboard.down('Shift');
			await press('.files .diff .side.added .number, .files .diff .line.added .numbers');
			await page.keyboard.up('Shift');
			await press('.files .head button', 'Comment');
			await page.type('.notes .draft textarea', 'why rename it?');
			await page.keyboard.press('Enter');
			await wait(1000);

			expect(await page.$eval('.notes .comment .place', place => place.textContent)).toContain(
				'server/app.js line 3, and line 3 before the change',
			);
			// A bar on each side of the change
			expect(await page.$$eval('.files .diff .comment-mark', marks => marks.length)).toBe(2);

			await press('.files .diff .added .comment-mark');
			expect(await page.$$eval('.notes .comment.flash', comments => comments.length)).toBe(1);

			// Opened from the comments, it's back in the diff with its lines picked, both sides of the change
			await press('.files .back');
			await press('.notes .comment .place .where');
			expect(await page.$$eval('.files .diff', diffs => diffs.length)).toBe(1);
			expect(await page.$$eval('.files .diff .picked', rows => rows.length)).toBe(2);
		} finally {
			await Bun.write(`${server.project}/server/app.js`, original);
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	'walking through a file: an overview with what it leaves out, then each stop on its lines',
	async () => {
		const server = servers.turns;
		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};

		try {
			await press('[title="Project files"]');
			await page.type('.files .bar input', 'app.js');
			await wait(500);
			await press('.files .entry', 'app.js');
			await press('.files .head button', 'Walk me through');
			await press('button', 'This file');
			await wait(1500);

			const strip = () => page.$eval('.files .tour-strip', card => card.innerText);

			expect(await strip()).toContain('It sets lines up, one after another.');
			expect(await strip()).toContain('Not in it: No stop is on lines 6-20.');

			await press('.files .tour-strip button', 'Start the tour');
			expect(await strip()).toContain('The first two lines.');
			expect(await page.$eval('.files .band', band => band.style.top)).toBe('0px');

			await press('.files .tour-strip button', 'Next');
			expect(await strip()).toContain('Two more, a little further on.');
			expect(await page.$eval('.files .band', band => band.style.top)).toBe('60px');

			await press('.files .tour-strip button', 'Done');
			expect(await page.$$eval('.files .tour-strip', strips => strips.length)).toBe(0);
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	"walking through a change picks each stop's lines in the diff",
	async () => {
		const server = servers.turns;
		const original = await Bun.file(`${server.project}/server/app.js`).text();
		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};

		try {
			Bun.spawnSync(['git', 'commit', '-q', '--allow-empty', '-m', 'before the change'], { cwd: server.project });
			await Bun.write(`${server.project}/server/app.js`, original.replace('line 3', 'line three'));
			await press('[title="Project files"]');
			await page.type('.files .bar input', 'app.js');
			await wait(500);
			await press('.files .entry', 'app.js');
			await press('.files .head button', 'Changes');
			await press('.files .head button', 'Walk me through');
			await wait(1500);
			await press('.files .tour-strip button', 'Start the tour');

			expect(await page.$eval('.files .tour-strip', card => card.innerText)).toContain('server/app.js');
			expect(await page.$$eval('.files .body .picked', rows => rows.length)).toBeGreaterThan(0);
		} finally {
			await Bun.write(`${server.project}/server/app.js`, original);
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	"a commit's files read in reading order, each saying what it is, the lock file folded until asked",
	async () => {
		const server = servers.turns;
		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};
		const git = (...args) => Bun.spawnSync(['git', ...args], { cwd: server.project });

		try {
			git('commit', '-q', '--allow-empty', '-m', 'before the web app');
			await Bun.write(`${server.project}/web/app.js`, "import { twice } from './lib.js';\ntwice(2);\n");
			await Bun.write(`${server.project}/web/lib.js`, 'export const twice = n => n * 2;\n');
			await Bun.write(`${server.project}/web/lib.test.js`, "import { twice } from './lib.js';\n");
			await Bun.write(`${server.project}/bun.lock`, 'one\ntwo\nthree\n');
			git('add', 'web', 'bun.lock');
			git('commit', '-q', '-m', 'add the web app');

			await press('[title^="Git"]');
			await press('.git .tabs button', 'History');
			await press('.git .history-item', 'add the web app');

			const heads = () =>
				page.$$eval('.files .diff .file-head', rows =>
					rows.map(row => [
						row.querySelector('.file-path').textContent,
						row.querySelector('.file-label')?.textContent ?? '',
					]),
				);

			expect(await heads()).toEqual([
				['web/lib.js', ''],
				['web/lib.test.js', 'tests lib.js'],
				['web/app.js', ''],
				['bun.lock', 'generated'],
			]);
			expect(await page.$eval('.files .diff', diff => diff.textContent)).not.toContain('three');

			await press('.files .diff .file-head button', 'Show 3 changed lines');
			expect(await page.$eval('.files .diff', diff => diff.textContent)).toContain('three');

			await press('.files .head button', 'Reading order');
			await press('button', 'Alphabetical');
			expect((await heads()).map(([path]) => path)).toEqual([
				'bun.lock',
				'web/app.js',
				'web/lib.js',
				'web/lib.test.js',
			]);
		} finally {
			await page.evaluate(() => localStorage.removeItem('paude.diffOrder'));
			await browser.close();
			// The project is shared with the tests after this one
			git('rm', '-rq', 'web', 'bun.lock');
			git('commit', '-q', '-m', 'without the web app');
		}
	},
	TIMEOUT_MS,
);

test(
	'a rename swept across files is told once, and a change reads function by function',
	async () => {
		const server = servers.turns;
		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};
		const git = (...args) => Bun.spawnSync(['git', ...args], { cwd: server.project });
		const write = (file, text) => Bun.write(`${server.project}/kit/${file}`, text);
		const groups = () => page.$$eval('.files .diff .group-head', heads => heads.map(head => head.textContent));

		try {
			await write('lib.js', 'export const scale = (n, by) => n * by;\n');
			await write('app.js', "import { scale } from './lib.js';\nscale(2, 3);\n");
			await write('one.js', 'const total = sumUp(1);\n');
			await write('two.js', 'const total = sumUp(2);\n');
			git('add', 'kit');
			git('commit', '-q', '-m', 'the kit');
			await write('lib.js', 'export const scale = (n, by = 2) => n * by;\n');
			await write('app.js', "import { scale } from './lib.js';\nscale(2);\n");
			await write('one.js', 'const total = addUp(1);\n');
			await write('two.js', 'const total = addUp(2);\n');
			git('add', 'kit');
			git('commit', '-q', '-m', 'scale by two, and addUp');

			await press('[title^="Git"]');
			await press('.git .tabs button', 'History');
			await press('.git .history-item', 'scale by two, and addUp');

			expect(await groups()).toEqual(['Renamed sumUp → addUp in 2 files']);
			expect(await page.$eval('.files .diff', diff => diff.textContent)).not.toContain('addUp(1)');

			await press('.files .head button', 'Reading order');
			await press('button', 'By function');
			expect(await groups()).toEqual([
				'scale in kit/lib.js: its signature changed',
				'Renamed sumUp → addUp in 2 files',
			]);
			expect(await page.$eval('.files .diff', diff => diff.textContent)).toContain('uses scale');
		} finally {
			await page.evaluate(() => localStorage.removeItem('paude.diffOrder'));
			await browser.close();
			git('rm', '-rq', 'kit');
			git('commit', '-q', '-m', 'without the kit');
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
			// The script takes as long as it takes to start and fail: waited for, not given a second
			await page.waitForFunction(() => document.querySelector('.tasks .run-head')?.textContent.includes('failed'), {
				timeout: 20_000,
			});
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
	"before opening a pull request: the work not committed (in the branch's diff, left out of the pull request), open comments, and tests",
	async () => {
		const server = await startServer({ noPullRequest: true });
		const git = (...args) => Bun.spawnSync(['git', ...args], { cwd: server.project });

		git('commit', '-qm', 'first');
		git('switch', '-q', '-c', 'feature');
		await Bun.write(`${server.project}/server/app.js`, 'mine\n');
		git('commit', '-qam', 'my change');
		await Bun.write(`${server.project}/server/extra.js`, 'not committed\n');

		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(1000);
		};
		const body = () => page.$eval('.git .body', node => node.textContent);

		try {
			await press('[title^="Git"]');
			await press('.git .tabs button', 'Review');
			expect(await body()).toContain('1 commit beyond main, and 1 file not committed');
			expect(await body()).toContain('1 file changed and not committed, which it leaves out: server/extra.js');
			expect(await body()).toContain('No comments open.');
			expect(await page.$$eval('.git .ready-item.todo', items => items.length)).toBeGreaterThan(0);

			// The branch's diff reads with the work not committed
			await press('.git .body button', 'Show the changes');
			expect(await page.$eval('.files .viewer', viewer => viewer.textContent)).toContain(
				'1 commit beyond main, and 1 file changed and not committed',
			);
			expect(await page.$eval('.files .viewer', viewer => viewer.textContent)).toContain('server/extra.js');

			// Committed, it's ready on that count
			git('add', '-A');
			git('commit', '-qm', 'extra');
			await press('.git .tabs button', 'Changes');
			await press('.git .tabs button', 'Review');
			expect(await body()).toContain('Everything is committed.');
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
			// The replace's toast stacks in the corner the Show button sits in; a tap clears it, as a person would
			await press('[popover]', 'Replaced');
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
	"on a phone the bar is the breadcrumb (paude, the project, the session's name) and a menu holding the rest",
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

			expect(visible).toEqual(['Menu']);
			expect(await page.$eval('.breadcrumbs', crumbs => crumbs.innerText.replace(/\s+/g, ' ').trim())).toMatch(
				/\/ demo (\d+ )?\/ New session$/,
			);

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

			// Haiku describes each in the background; the panel looks again until it has
			const described = () => page.$$eval('.links .link-context', lines => lines.map(line => line.textContent));

			for (let tries = 0; tries < 20 && !(await described()).includes('described docs.acme.dev'); tries++)
				await wait(500);
			expect(await described()).toEqual(['described docs.acme.dev', 'described github.com']);

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
			expect(await page.$eval('.project-links .body', body => body.clientHeight >= body.scrollHeight - 1)).toBe(true);
		} finally {
			await browser.close();
			await server.stop();
		}
	},
	TIMEOUT_MS,
);

test(
	'an image a session made opens over the page, a step from the others, and closes back to the list',
	async () => {
		const server = await startServer();
		const id = await server.newSession();
		const folder = await mkdtemp(path.join(os.tmpdir(), 'paude-images-'));
		const pixel = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			'base64',
		);
		const wrote = (file, second) => ({
			type: 'assistant',
			timestamp: new Date(Date.now() - (10 - second) * 1000).toISOString(),
			message: { content: [{ type: 'tool_use', id: file, name: 'Write', input: { file_path: file } }] },
		});
		const [first, second] = [path.join(folder, 'first.png'), path.join(folder, 'second.png')];

		// The last line counts once another follows it, as one still being written might not be whole
		await server.writeTranscript(id, [
			wrote(first, 1),
			wrote(second, 2),
			{ type: 'user', message: { content: 'thanks' } },
		]);
		await Promise.all([Bun.write(first, pixel), Bun.write(second, pixel)]);

		const { browser, page } = await openBrowser('dom');
		const shown = () => page.$eval('.viewer-name', name => name.textContent).catch(() => null);

		try {
			await page.goto(await server.loginLink('/projects/demo'));
			await page.waitForSelector('[data-tab=artifacts]');
			await page.click('[data-tab=artifacts]');
			// Shown, not only there: a preview has no size until its image loads
			await page.waitForSelector('.artifact-preview', { visible: true });
			await page.click('.artifact-preview');
			await page.waitForSelector('.stage img');
			expect(page.url()).toContain('/projects/demo');

			const opened = await shown();

			await page.keyboard.press('ArrowRight');
			expect(await shown()).not.toBe(opened);
			expect(await page.$eval('.viewer-count', count => count.textContent)).toMatch(/ of 2$/);

			await page.keyboard.press('Escape');
			expect(await shown()).toBeNull();
		} finally {
			await browser.close();
			await server.stop();
			await rm(folder, { recursive: true, force: true });
		}
	},
	TIMEOUT_MS,
);

test(
	'the paude crumb names this server and switches to the others, landing on their home page logged in',
	async () => {
		const [here, there] = await Promise.all([startServer(), startServer()]);

		await here.logInto(there, 'workshop');

		const { browser, page } = await openBrowser('dom');

		try {
			await page.goto(await here.loginLink('/projects/demo'));
			await page.waitForSelector('.server-switch:not([style*="none"])');
			await page.click('.server-switch');
			await page.waitForSelector('button .label');

			const items = await page.$$eval('button .label', labels => labels.map(label => label.textContent));

			expect(items.at(-1)).toBe('workshop');
			await (await page.$$('button .label')).at(-1).click();
			await page.waitForFunction(origin => window.location.origin === origin, {}, there.url);
			await page.waitForSelector('.breadcrumbs span.root');
			expect(new URL(page.url()).hash).toBe('#/');
		} finally {
			await browser.close();
			await Promise.all([here.stop(), there.stop()]);
		}
	},
	TIMEOUT_MS,
);

test(
	'the catch-up tour says what it is and starts only once asked',
	async () => {
		const server = servers.turns;
		const { browser, page } = await openSession('dom', server);
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(500);
		};
		const touring = () => page.$eval('.limit-overlay.tour', card => card.classList.contains('shown'));

		try {
			await press('[title^="Catch me up"]');
			expect(await page.$eval('body', body => body.innerText)).toContain('Catch up on this session?');
			await press('button', 'Not now');
			expect(await touring()).toBe(false);

			await press('[title^="Catch me up"]');
			await press('button', 'Take the tour');
			expect(await touring()).toBe(true);
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);

test(
	"a file a session made reads in the files panel: one of the project's as any other, one outside it read-only",
	async () => {
		const server = await startServer();
		const id = await server.newSession();
		const folder = await mkdtemp(path.join(os.tmpdir(), 'paude-made-'));
		const [outside, inside] = [path.join(folder, 'notes.txt'), path.join(server.project, 'report.txt')];
		const wrote = (file, second) => ({
			type: 'assistant',
			timestamp: new Date(Date.now() - (10 - second) * 1000).toISOString(),
			message: { content: [{ type: 'tool_use', id: file, name: 'Write', input: { file_path: file } }] },
		});

		// The last line counts once another follows it, as one still being written might not be whole
		await server.writeTranscript(id, [
			wrote(outside, 1),
			wrote(inside, 2),
			{ type: 'user', message: { content: 'ok' } },
		]);
		await Promise.all([Bun.write(outside, 'made outside\n'), Bun.write(inside, 'made inside\n')]);

		const { browser, page } = await openBrowser('dom');
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};
		const reading = () => page.$eval('.files', panel => panel.innerText);

		try {
			await page.goto(await server.loginLink(`/sessions/${id}`));
			await page.waitForSelector('.xterm-screen');
			await wait(1500);
			await press('[title^="Artifacts"]');

			await press('.links .artifact .name', 'notes.txt');
			expect(page.url()).toContain(`/sessions/${id}`);
			expect(await page.$eval('.files', panel => panel.classList.contains('open'))).toBe(true);
			expect(await reading()).toContain('made outside');
			expect(await reading()).not.toContain('Edit');

			// The list stays open beside the files on a wide screen
			await press('.links .artifact .name', 'report.txt');
			expect(await reading()).toContain('made inside');
			expect(await reading()).toContain('Edit');
		} finally {
			await browser.close();
			await server.stop();
			await rm(folder, { recursive: true, force: true });
		}
	},
	TIMEOUT_MS,
);

test(
	"a pull request that brings Claude Code's own files asks before starting Claude, and Don't start leaves the worktree",
	async () => {
		const server = await startServer({ noGh: true });
		const origin = await mkdtemp(path.join(os.tmpdir(), 'paude-origin-'));
		const git = (...args) => Bun.spawnSync(['git', ...args], { cwd: server.project });

		git('commit', '-q', '-m', 'start');
		Bun.spawnSync(['git', 'init', '-q', '--bare', origin]);
		git('remote', 'add', 'origin', origin);
		git('push', '-q', 'origin', 'main');
		git('switch', '-q', '-c', 'theirs');
		await Bun.write(path.join(server.project, '.claude', 'settings.json'), '{"hooks":{}}');
		git('add', '-A');
		git('commit', '-q', '-m', 'a hook');
		git('push', '-q', 'origin', 'theirs:refs/pull/5/head');
		git('switch', '-q', 'main');
		git('branch', '-q', '-D', 'theirs');

		const { browser, page } = await openBrowser('dom');
		const press = async (selector, text) => {
			const where = await centerOf(page, selector, text);

			await page.mouse.click(where.x, where.y);
			await wait(800);
		};
		const sessions = async () => (await (await server.api('/api/projects/demo/sessions')).json()).length;
		const worktree = path.join(server.project, '.paude', 'worktrees', 'pr-5');

		try {
			await page.goto(await server.loginLink('/projects/demo'));
			await page.waitForSelector('button.chip:has(.fa-code-branch)', { visible: true });
			await press('button.chip:has(.fa-code-branch)');
			await press('button', 'A new worktree from a branch or PR');
			await page.type('input[placeholder^="branch, tag"]', '#5');
			await press('button', 'Start session');
			await page.waitForFunction(() => document.body.innerText.includes('Start Claude in this pull request?'), {
				timeout: 20_000,
			});
			expect(await page.evaluate(() => document.body.innerText)).toContain(
				'This pull request adds or changes files Claude Code reads and can run on start: .claude/settings.json.',
			);
			expect(await sessions()).toBe(0);

			await press('button', "Don't start");
			expect(await page.evaluate(() => document.body.innerText)).toContain(
				`Claude wasn't started. The worktree is at ${worktree}`,
			);
			expect(await Bun.file(path.join(worktree, '.claude', 'settings.json')).exists()).toBe(true);
			expect(await sessions()).toBe(0);

			// The worktree is picked, so starting is one press away once it's been looked over
			await press('button', 'Start session');
			await page.waitForFunction(() => window.location.hash.startsWith('#/sessions/'), { timeout: 10_000 });
			expect(await sessions()).toBe(1);
		} finally {
			await browser.close();
			await server.stop();
			await rm(origin, { recursive: true, force: true });
		}
	},
	TIMEOUT_MS,
);
