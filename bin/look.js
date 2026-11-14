#!/usr/bin/env bun
// A look at a page the way a player sees it, for an arcade's Claude (its rules name it as $PAUDE_LOOK): opened in a
// headless Chrome at each size asked, tapped and typed into as told, then a screenshot of each and what went wrong on
// the way (console errors, exceptions, failed requests), its frame rate, and the words it shows.
//
//   bun "$PAUDE_LOOK" http://localhost:41234 --size 390x844 --size 1300x800 --tap "Play" --wait 1500 --out shots
//
// --size WxH    a screen to look at it on, any number of them (a phone and a computer when none is given)
// --tap TEXT    press the button or link showing TEXT, or the element a CSS selector names, in order
// --type TEXT   type into whatever has focus
// --key KEY     press a key (ArrowLeft, Space, Enter, ...)
// --wait MS     wait that long, there or between steps (600 after each step otherwise)
// --out DIR     where the screenshots go (the current folder otherwise)
import { mkdir } from 'fs/promises';
import path from 'path';

import puppeteer from 'puppeteer-core';

const CHROMES = [
	process.env.CHROME,
	'/usr/bin/google-chrome',
	'/usr/bin/google-chrome-stable',
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const SIZES = ['390x844', '1300x800'];
const STEP_MS = 600;
const SHOWN_WORDS = 600;

const parse = argv => {
	const asked = { url: null, sizes: [], steps: [], out: '.' };

	for (let at = 0; at < argv.length; at++) {
		const flag = argv[at];
		const value = argv[at + 1];

		if (flag === '--size') asked.sizes.push(value);
		else if (flag === '--out') asked.out = value;
		else if (['--tap', '--type', '--key', '--wait'].includes(flag)) asked.steps.push({ kind: flag.slice(2), value });
		else if (!flag.startsWith('--') && !asked.url) {
			asked.url = flag;
			continue;
		} else throw new Error(`Not understood: ${flag}`);
		at++;
	}
	if (!asked.url) throw new Error('Say which page to look at: bun look.js <url> [--size WxH] [--tap TEXT] ...');
	if (!asked.sizes.length) asked.sizes = SIZES;

	return asked;
};

// A button or link by the words it shows, else whatever a selector names
const tap = async (page, text) => {
	const pressed = await page.evaluate(wanted => {
		const visible = element => element.offsetParent !== null || element.getClientRects().length;
		const words = element => (element.innerText || element.value || element.getAttribute('aria-label') || '').trim();
		const pressable = [...document.querySelectorAll('button, a, [role="button"], input[type="submit"], [onclick]')];
		const found =
			pressable.find(element => visible(element) && words(element) === wanted) ??
			pressable.find(element => visible(element) && words(element).includes(wanted));

		if (!found) return false;
		found.scrollIntoView({ block: 'center' });
		found.click();

		return true;
	}, text);

	if (pressed) return;

	const bySelector = await page.$(text).catch(() => null);

	if (!bySelector) throw new Error(`Nothing to tap shows "${text}"`);
	await bySelector.click();
};

const framesPerSecond = page =>
	page.evaluate(
		() =>
			new Promise(resolve => {
				let frames = 0;
				const started = performance.now();
				const count = () => {
					frames++;
					if (performance.now() - started < 1000) requestAnimationFrame(count);
					else resolve(Math.round((frames * 1000) / (performance.now() - started)));
				};

				requestAnimationFrame(count);
			}),
	);

const lookAt = async (browser, { url, steps, out }, size) => {
	const [width, height] = size.split('x').map(Number);
	const context = await browser.createBrowserContext();
	const page = await context.newPage();
	const trouble = [];

	// The browser asks for /favicon.ico by itself; a page that links its own icon never uses it
	const own = address => !address.endsWith('/favicon.ico');

	page.on('console', message => {
		if (message.type() === 'error' && own(message.location()?.url ?? '')) trouble.push(`console: ${message.text()}`);
	});
	page.on('pageerror', error => trouble.push(`exception: ${error.message}`));
	page.on('requestfailed', request => trouble.push(`failed: ${request.url()} (${request.failure()?.errorText})`));
	page.on('response', response => {
		if (response.status() >= 400 && own(response.url())) trouble.push(`${response.status()}: ${response.url()}`);
	});

	await page.setViewport({ width, height, isMobile: width < 700, hasTouch: width < 700 });
	await page.goto(url, { waitUntil: 'networkidle2', timeout: 20_000 }).catch(error => trouble.push(error.message));
	await Bun.sleep(STEP_MS);

	for (const step of steps) {
		try {
			if (step.kind === 'wait') await Bun.sleep(Number(step.value) || 0);
			else {
				if (step.kind === 'tap') await tap(page, step.value);
				if (step.kind === 'type') await page.keyboard.type(step.value);
				if (step.kind === 'key') await page.keyboard.press(step.value);
				await Bun.sleep(STEP_MS);
			}
		} catch (error) {
			trouble.push(`step ${step.kind} "${step.value}": ${error.message}`);
		}
	}

	const shot = path.resolve(out, `look-${size}.png`);

	await page.screenshot({ path: shot });

	const fps = await framesPerSecond(page).catch(() => null);
	const words = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');

	await context.close();

	return { size, shot, fps, trouble, words: words.replace(/\s+/g, ' ').trim().slice(0, SHOWN_WORDS) };
};

const asked = parse(process.argv.slice(2));
const executablePath = CHROMES.find(candidate => candidate && Bun.file(candidate).size);

if (!executablePath) {
	console.error('No Chrome found here: set CHROME to one.');
	process.exit(2);
}

await mkdir(asked.out, { recursive: true });

const browser = await puppeteer.launch({
	executablePath,
	pipe: true,
	args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
let troubled = false;

try {
	for (const size of asked.sizes) {
		const seen = await lookAt(browser, asked, size);

		troubled ||= seen.trouble.length > 0;
		console.log(`== ${seen.size}: ${seen.shot}`);
		console.log(`frames: ${seen.fps ?? '?'} a second`);
		console.log(`shows: ${seen.words || '(no words)'}`);
		console.log(seen.trouble.length ? seen.trouble.map(line => `! ${line}`).join('\n') : 'no errors');
	}
} finally {
	await browser.close();
}

process.exit(troubled ? 1 : 0);
