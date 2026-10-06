const ESC = '\x1b';
const CTRL_C = '\x03';
export const ENTER_ALT_SCREEN = `${ESC}[?1049h${ESC}[?25l`;
export const LEAVE_ALT_SCREEN = `${ESC}[?25h${ESC}[?1049l`;
export const CLEAR = `${ESC}[H${ESC}[2J`;
export const CLEAR_SCROLLBACK = `${ESC}[3J`;

// Modes Claude Code may switch on in this terminal through the stream; a detach turns them all back off
export const RESET_MODES = [
	`${ESC}[?2004l`, // bracketed paste
	`${ESC}[?1004l`, // focus reporting
	`${ESC}[?1000l${ESC}[?1002l${ESC}[?1003l${ESC}[?1006l`, // mouse tracking
	`${ESC}[<u`, // kitty keyboard protocol
	`${ESC}[>4;0m`, // modifyOtherKeys
	`${ESC}[?25h`, // cursor visible
	`${ESC}[0m`,
].join('');

export const KEYS = {
	up: [`${ESC}[A`, `${ESC}OA`, 'k'],
	down: [`${ESC}[B`, `${ESC}OB`, 'j'],
	enter: ['\r', '\n'],
	back: [ESC, 'q', CTRL_C],
};

export const is = (key, name) => KEYS[name].includes(key);

export const write = text => process.stdout.write(text);

export const size = () => ({ cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 });

export const bold = text => `${ESC}[1m${text}${ESC}[22m`;
export const dim = text => `${ESC}[2m${text}${ESC}[22m`;
export const inverse = text => `${ESC}[7m${text}${ESC}[27m`;
export const orange = text => `${ESC}[38;5;208m${text}${ESC}[39m`;
export const green = text => `${ESC}[32m${text}${ESC}[39m`;

// Text from other people (chat, names, quotes) printed raw could carry escape sequences that drive this terminal.
// Drops C0 and C1 control characters and DEL; newlines and tabs become spaces.
export const printable = text =>
	[...String(text ?? '')]
		.map(character => {
			const code = character.codePointAt(0);

			if (code === 0x0a || code === 0x09) return ' ';

			return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? '' : character;
		})
		.join('');

const ESCAPE_SEQUENCE = new RegExp(`(${ESC}\\[[0-9;?<>]*[A-Za-z])`);

// Cuts to a visible width, ignoring escape sequences when counting
export const fit = (text, width) => {
	let visible = 0;
	let out = '';

	for (const part of text.split(ESCAPE_SEQUENCE)) {
		if (part.startsWith(ESC)) {
			out += part;
			continue;
		}

		const room = width - visible;

		if (part.length > room) return `${out}${part.slice(0, Math.max(room - 1, 0))}…${ESC}[0m`;

		out += part;
		visible += part.length;
	}

	return out;
};

export const rawInput = onKey => {
	const listener = data => onKey(data.toString('utf8'));

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on('data', listener);

	return () => {
		process.stdin.off('data', listener);
		process.stdin.setRawMode(false);
		process.stdin.pause();
	};
};

export const readHidden = label =>
	new Promise(resolve => {
		let value = '';

		process.stdout.write(label);
		process.stdin.setRawMode(true);
		process.stdin.resume();

		const onData = data => {
			for (const character of data.toString('utf8')) {
				if (character === '\r' || character === '\n') {
					process.stdin.off('data', onData);
					process.stdin.setRawMode(false);
					process.stdin.pause();
					process.stdout.write('\n');

					return resolve(value);
				}

				if (character === '\x03') process.exit(130);

				value = character === '\x7f' ? value.slice(0, -1) : value + character;
			}
		};

		process.stdin.on('data', onData);
	});
