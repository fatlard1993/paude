// How much of its context a Claude session has left before it compacts itself, in percent, as Claude prints it under
// its prompt ("12% until auto-compact"): read off the screen rather than worked out, since the point Claude compacts
// at moves with its model, its settings and the window it resolved. null when the screen doesn't say.
const COUNTDOWN = /(\d+)% until auto-compact/;
const LOOK_BACK_ROWS = 8;

const untilCompact = buffer => {
	for (let y = buffer.length - 1; y >= Math.max(0, buffer.length - LOOK_BACK_ROWS); y--) {
		const found = COUNTDOWN.exec(buffer.getLine(y)?.translateToString(true) ?? '');

		if (found) return Number(found[1]);
	}

	return null;
};

export default untilCompact;
