import { printable } from './screen';

// Desktop notifications through the terminal itself, since nothing can be drawn over Claude's screen.
// kitty has its own protocol (OSC 99); iTerm2, WezTerm and others take OSC 9. Terminals with neither ignore them.
const kitty = Boolean(process.env.KITTY_WINDOW_ID) || process.env.TERM === 'xterm-kitty';
const QUIET_MS = 15_000;

const show = (title, body) => {
	// Control characters in someone else's message must not be able to end the sequence early
	const text = printable(`${title}: ${body}`).slice(0, 200);

	process.stdout.write(kitty ? `\x1b]99;;${text}\x1b\\` : `\x1b]9;${text}\x07`);
};

// The first message notifies at once; a burst after it becomes one summary when the quiet period ends
const notifier = () => {
	let quietUntil = 0;
	let held = 0;
	let timer;

	const flush = () => {
		if (held) show('paude', held === 1 ? '1 more message' : `${held} more messages`);
		held = 0;
	};

	return (title, body) => {
		const now = Date.now();

		if (now >= quietUntil) {
			show(title, body);
			quietUntil = now + QUIET_MS;
			clearTimeout(timer);
			timer = setTimeout(flush, QUIET_MS);
			timer.unref?.();

			return;
		}

		held += 1;
	};
};

export default notifier;
