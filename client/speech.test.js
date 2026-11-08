import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

// A page's globals, as much of them as the voices touch
const press = () => document.dispatchEvent(new Event('pointerdown'));
let spoken;
let played;
// The page's globals the voices touch, put in for a test and put back after it: the files run in one process
const NAMES = [
	'document',
	'requestAnimationFrame',
	'cancelAnimationFrame',
	'navigator',
	'SpeechSynthesisUtterance',
	'speechSynthesis',
	'window',
	'Audio',
	'fetch',
];
const had = new Map();

beforeEach(() => {
	spoken = [];
	played = [];
	for (const name of NAMES) had.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	globalThis.document = new EventTarget();
	globalThis.requestAnimationFrame = () => 0;
	globalThis.cancelAnimationFrame = () => {};
	globalThis.navigator = { language: 'en-US' };
	globalThis.SpeechSynthesisUtterance = class {
		constructor(text) {
			this.text = text;
		}
	};
	globalThis.speechSynthesis = {
		getVoices: () => [{ lang: 'en-US', name: 'Test', localService: true }],
		speak: utterance => spoken.push(utterance),
		cancel() {},
		addEventListener() {},
	};
	globalThis.window = Object.assign(new EventTarget(), {
		speechSynthesis: globalThis.speechSynthesis,
		location: { origin: 'http://test' },
	});
	globalThis.Audio = class {
		constructor(src) {
			this.src = src;
			this.currentTime = 0;
			this.listeners = {};
		}

		addEventListener(type, listener) {
			this.listeners[type] = listener;
		}

		play() {
			played.push(this);

			// Refused until the page is pressed, as a browser refuses sound on a fresh page
			return played.length === 1
				? Promise.reject(Object.assign(new Error('play() failed'), { name: 'NotAllowedError' }))
				: Promise.resolve();
		}

		pause() {}
	};
	globalThis.fetch = async () => Response.json({ audio: 'QUJD', words: [{ start: 0, end: 0.2 }] });
});

afterEach(() => {
	for (const name of NAMES) {
		const before = had.get(name);

		if (before) Object.defineProperty(globalThis, name, before);
		else delete globalThis[name];
	}
});

const tick = () => new Promise(resolve => setTimeout(resolve, 20));

describe("a line the browser won't play before the page is pressed", () => {
	test("the server's voice keeps it and plays it on the first press, then the line ends as usual", async () => {
		const { speak } = await import('./speech');
		let ended = 0;

		speak('Tap the star', { session: 's1', onEnd: () => (ended += 1) });
		await tick();
		expect(played).toHaveLength(1);
		expect(ended).toBe(0);

		press();
		await tick();
		expect(played).toHaveLength(2);
		expect(played[1]).toBe(played[0]);

		played[0].listeners.ended();
		expect(ended).toBe(1);
	});

	test("the browser's own voice does the same, and a stop lets the held line go", async () => {
		const { speak } = await import('./speech');

		const saying = speak('Tap the star');

		expect(spoken).toHaveLength(1);
		spoken[0].onerror({ error: 'not-allowed' });
		press();
		expect(spoken).toHaveLength(2);

		const second = speak('Again');

		spoken[2].onerror({ error: 'not-allowed' });
		second.stop();
		press();
		expect(spoken).toHaveLength(3);
		expect(saying).toHaveProperty('stop');
	});
});
