// The arcade against the fake Claude, which asks as the real one does (bun run test:e2e): the loop a kid plays in,
// from a question up to the game alone, the big button, a choice confirmed or dropped, the turn's snapshot, and
// picking again. Read-aloud is off here: the rest after a question comes from its unspoken moment.
import { writeFile } from 'fs/promises';
import path from 'path';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import { eventually, openBrowser, startServer } from './harness';

const TIMEOUT_MS = 120_000;
const sh = (cwd, command) => Bun.spawnSync(['sh', '-c', command], { cwd }).stdout.toString().trim();

let server;

beforeAll(async () => {
	server = await startServer();
	await writeFile(
		path.join(server.project, '.paude-arcade.json'),
		JSON.stringify({ title: 'Demo', player: 'Ada', reading: 'learning' }),
	);
	await writeFile(path.join(server.project, 'Game.js'), 'export default 1;\n');
	sh(server.project, 'git add -A && git commit -q -m scaffold');
});
afterAll(() => server?.stop());

test(
	'a question is shown as Claude wrote it, the talk folds away once taken in, the big button brings it back, a choice opens to confirm, no drops it, yes answers; the turn is kept as a snapshot named for the answer, and Pick again puts it back',
	async () => {
		const id = await server.newSession();
		const { browser, page } = await openBrowser('dom');
		const playing = () => page.$eval('.stage', stage => stage.parentElement.classList.contains('playing'));
		const choices = () =>
			page.$$eval('.choices button.choice', buttons => buttons.map(button => button.textContent.trim()));
		const pressChoice = text =>
			page.evaluate(
				text =>
					[...document.querySelectorAll('.choices button.choice')].find(b => b.textContent.includes(text)).click(),
				text,
			);

		try {
			await page.goto(await server.loginLink(''));
			await page.waitForSelector('textarea');
			// Turned off for this arcade's way of writing (read aloud, left to itself)
			await page.evaluate(() => localStorage.setItem('paude.arcade.speak.learning', 'no'));
			await page.goto(`${server.url}/#/arcade/${id}`);
			// The page has seen the session idle before the question comes: a question arriving later is read (here, taken
			// in over its unspoken moment), not treated as one found up on arrival
			await page.waitForSelector('.arcade-talk .lamp.ready');
			await writeFile(path.join(server.project, '.ask'), '');

			// The question, its labels and details from the transcript's own record of the call
			await eventually(async () => expect(await choices()).toEqual(['🐸A frog', '⭐A star', '🎲More ideas']), 30_000);
			expect(await page.$eval('.choices .question', node => node.textContent)).toContain('What should happen next?');
			expect(await playing()).toBe(false);

			// Taken in: the game alone, and the big button in the bar
			await eventually(async () => expect(await playing()).toBe(true), 15_000);
			expect(await page.$eval('.change-button', button => getComputedStyle(button).display)).not.toBe('none');
			await page.click('.change-button');
			expect(await playing()).toBe(false);
			expect(await choices()).toHaveLength(3);

			// A choice opens to confirm, with its detail; no drops it from the list
			await pressChoice('A star');
			expect(await page.$eval('.choices .confirm .detail', node => node.textContent)).toBe('A star to catch');
			await page.click('.choices button.no');
			expect(await choices()).toEqual(['🐸A frog', '🎲More ideas']);

			// Yes answers: the choice shows as the kid's own, Claude works, and asks the next question
			await pressChoice('A frog');
			await page.click('.choices button.yes');
			await eventually(async () =>
				expect(
					await page.$$eval('.feed .card.you.chosen', cards =>
						cards.map(c => c.firstChild.textContent + c.childNodes[2].textContent),
					),
				).toEqual(['🐸A frog']),
			);
			await eventually(async () => expect(await choices()).toEqual(['🌙A moon', '🌧️Rain', '🎲More ideas']), 30_000);
			// Shown once, from the page; the transcript's record of the same answer is not a second card
			expect(await page.$$eval('.feed .card.you.chosen', cards => cards.length)).toBe(1);

			// The turn's snapshot, named for the answer, taken when the next question was asked
			expect(sh(server.project, 'git log --format=%s -1')).toBe('turn: 🐸 A frog');
			expect(sh(server.project, 'cat Game.js')).toBe('export default "🐸 A frog";');

			// Pick again: the snapshot put back as a new commit, Claude told, and a fresh question after
			await eventually(async () => expect(await playing()).toBe(true), 15_000);
			await page.click('.change-button');
			await page.click('.feed .card.you.chosen button');
			await pressChoice('Yes, pick again');
			await eventually(async () =>
				expect(sh(server.project, 'git log --format=%s -1')).toMatch(/^Revert "turn: 🐸 A frog"/),
			);
			expect(sh(server.project, 'git show HEAD:Game.js').trim()).toBe('export default 1;');
			await eventually(async () =>
				expect(
					await page.$$eval('.feed .card.you', cards =>
						cards.some(c => c.textContent.startsWith('Pick again instead of')),
					),
				).toBe(true),
			);
			await eventually(async () => expect(await choices()).toHaveLength(3), 30_000);
		} finally {
			await browser.close();
		}
	},
	TIMEOUT_MS,
);
