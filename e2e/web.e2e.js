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
