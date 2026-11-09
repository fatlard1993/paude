import { describe, expect, test } from 'bun:test';

import sayQueue from './sayQueue';

// A voice that says nothing until told: each line's handle, and its end to fire
const fakeVoice = () => {
	const lines = [];
	const say = (text, { onEnd }) => {
		const handle = { text, stopped: false, stop: () => (handle.stopped = true), end: onEnd };

		// As speak() does: a new line stops the one before it, which fires its end
		const before = lines.at(-1);

		lines.push(handle);
		if (before && !before.stopped && !before.ended) {
			before.stopped = true;
			before.ended = true;
			before.end();
		}

		return handle;
	};
	const finish = handle => {
		handle.ended = true;
		handle.end();
	};

	return { lines, say, finish };
};

describe('sayQueue', () => {
	test('says lines one after another, each once the one before has ended', () => {
		const voice = fakeVoice();
		const queue = sayQueue({ say: voice.say });

		queue.enqueue('one');
		queue.enqueue('two');
		expect(voice.lines.map(({ text }) => text)).toEqual(['one']);
		voice.finish(voice.lines[0]);
		expect(voice.lines.map(({ text }) => text)).toEqual(['one', 'two']);
		voice.finish(voice.lines[1]);
		expect(queue.busy).toBe(false);
	});

	test("a line said again is said alone: the queue is cleared, and the stopped line's end does not start another", () => {
		const voice = fakeVoice();
		const queue = sayQueue({ say: voice.say });

		queue.enqueue('one');
		queue.enqueue('two');
		queue.enqueue('three');
		queue.sayNow('one again');
		// Stopping 'one' fired its end; 'two' must not have started under 'one again'
		expect(voice.lines.map(({ text }) => text)).toEqual(['one', 'one again']);
		expect(queue.pending).toBe(0);
		voice.finish(voice.lines[1]);
		expect(voice.lines).toHaveLength(2);
		expect(queue.busy).toBe(false);
	});

	test('says when the last queued line has ended, and not for a line said alone', () => {
		const voice = fakeVoice();
		let idle = 0;
		const queue = sayQueue({ say: voice.say, onIdle: () => (idle += 1) });

		queue.enqueue('one');
		queue.enqueue('two');
		voice.finish(voice.lines[0]);
		expect(idle).toBe(0);
		voice.finish(voice.lines[1]);
		expect(idle).toBe(1);
		queue.sayNow('again');
		voice.finish(voice.lines[2]);
		expect(idle).toBe(1);
	});

	test('lights the words of what it says, and clears them at the end', () => {
		const voice = fakeVoice();
		const queue = sayQueue({ say: voice.say });
		const lit = [];

		queue.enqueue('tap the star', { lightWord: index => lit.push(index) });
		voice.finish(voice.lines[0]);
		expect(lit).toEqual([-1]);
	});

	test('starts voicing each line the moment it is queued, not when its turn comes', () => {
		const voice = fakeVoice();
		const prepared = [];
		const queue = sayQueue({ say: voice.say, prepare: text => prepared.push(text) });

		queue.enqueue('one');
		queue.enqueue('two');
		queue.enqueue('three');
		expect(prepared).toEqual(['one', 'two', 'three']);
		expect(voice.lines).toHaveLength(1);
	});

	test('a line given up before its turn lets its card stop waiting', () => {
		const voice = fakeVoice();
		const queue = sayQueue({ say: voice.say });
		const waiting = [];

		queue.enqueue('one');
		queue.enqueue('two', { lightWord: index => waiting.push(index) });
		queue.sayNow('now instead');
		expect(waiting).toEqual([-1]);
	});
});
