// What the arcade reads aloud, one line at a time in the order it arrived: Claude's cards as they come, a question
// with its choices, a word to the kid. A line asked for again (a card's speaker button) is said now, alone: what was
// queued waits for the next thing. A line stopped for a newer one is over, but its end is not the queue's turn: the
// newer line has it, so nothing starts under it. `say` is speak() from speech.js, given rather than imported so the
// queue can be tested with a voice of the test's own.
const sayQueue = ({ session, say }) => {
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

	const next = () => {
		const line = queue.shift();

		if (!line) return;
		sayOne(line.text, line.target, next);
	};

	return {
		enqueue(text, target) {
			if (!text) return;
			queue.push({ text, target });
			if (!saying) next();
		},
		sayNow(text, target) {
			queue.length = 0;
			sayOne(text, target);
		},
		clear() {
			queue.length = 0;
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
