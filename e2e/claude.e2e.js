// Ask Claude against the real Claude Code (bun run test:claude): it costs a few tokens, so it isn't in the usual run
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { centerOf, openBrowser, startServer } from './harness';

const wait = ms => Bun.sleep(ms);
const ANSWER_WAIT_MS = 90_000;

let server;

beforeAll(async () => {
	server = await startServer({ claude: Bun.which('claude') ?? 'claude' });
});
afterAll(() => server.stop());

const screenText = page =>
	page.evaluate(() => [...document.querySelectorAll('.xterm-rows > div')].map(row => row.textContent).join('\n'));

test("a message waits out a half-typed prompt, then Claude's answer comes back to the chat", async () => {
	const { browser, page } = await openBrowser('dom');

	try {
		await page.goto(await server.loginLink(`/sessions/${await server.newSession()}`));
		await page.waitForSelector('.xterm-rows');
		await wait(8000);
		// A new folder asks whether to trust it
		if ((await screenText(page)).includes('trust')) {
			await page.click('.xterm-screen');
			await page.keyboard.press('ArrowDown');
			await page.keyboard.press('Enter');
			await wait(6000);
		}

		await page.click('.xterm-screen');
		await page.keyboard.type('my draft');

		const chat = await centerOf(page, '[title="Chat and comments"]');

		await page.mouse.click(chat.x, chat.y);
		await wait(500);
		await (await page.$('.notes > .composer textarea')).type('Reply with just the word pong, nothing else.');
		await page.$eval('.notes > .composer .ask', ask => ask.click());
		await wait(4000);
		expect(await screenText(page)).not.toContain('[paude chat');

		await page.click('.xterm-screen');
		await page.keyboard.down('Control');
		await page.keyboard.press('u');
		await page.keyboard.up('Control');

		for (let waited = 0; waited < ANSWER_WAIT_MS && !(await page.$('.notes .from-claude')); waited += 1000)
			await wait(1000);

		expect(await page.$eval('.notes .from-claude .text', answer => answer.textContent.trim().toLowerCase())).toContain(
			'pong',
		);
	} finally {
		await browser.close();
	}
}, 180_000);
