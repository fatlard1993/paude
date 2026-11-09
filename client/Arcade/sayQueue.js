// What the arcade reads aloud, one line at a time in the order it arrived: Claude's cards as they come, a question
// with its choices, a word to the player. A line asked for again (a card's speaker button) is said now, alone: what was
// queued waits for the next thing. A line stopped for a newer one is over, but its end is not the queue's turn: the
// newer line has it, so nothing starts under it. `say` is speak() from speech.js, given rather than imported so the
// queue can be tested with a voice of the test's own; `prepare(text)`, when given, starts voicing a line the moment
// it's queued, so it's ready by its turn; `onIdle` hears when the last queued line has ended.
const sayQueue = ({ session, say, prepare, onIdle }) => {
	const queue = [];
	let saying = null;

	const light = (target, index) => {
		if (target?.lightWord) target.lightWord(index);
		else target?.words?.forEach((span, at) => span.classList.toggle('lit', at === index));
	};

	const sayOne = (text, target, then) => {
		const handle = say(text, {
			session,
			onWord: index => light(target, index),
			onEnd: () => {
				light(target, -1);
				if (saying !== handle) return;
				saying = null;
				then?.();
			},
		});

		saying = handle;

		return handle;
	};

	// Lines given up before their turn: their cards stop waiting on a voice that won't come
	const drop = () => {
		for (const line of queue.splice(0)) light(line.target, -1);
	};

	const next = () => {
		const line = queue.shift();

		if (!line) return onIdle?.();
		sayOne(line.text, line.target, next);
	};

	return {
		enqueue(text, target) {
			if (!text) return;
			prepare?.(text);
			queue.push({ text, target });
			if (!saying) next();
		},
		sayNow(text, target) {
			drop();
			sayOne(text, target);
		},
		clear() {
			drop();
		},
		get busy() {
			return saying !== null;
		},
		get pending() {
			return queue.length;
		},
	};
};

export default sayQueue;
