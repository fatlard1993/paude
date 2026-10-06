const ESC = '\x1b';
const CTRL_C = '\x03';
export const ENTER_ALT_SCREEN = `${ESC}[?1049h${ESC}[?25l`;
export const LEAVE_ALT_SCREEN = `${ESC}[?25h${ESC}[?1049l`;
export const CLEAR = `${ESC}[H${ESC}[2J`;
export const HIDE_CURSOR = `${ESC}[?25l`;
// Claude turns mouse reporting on in this terminal; while paude's overlay is up, a brushed touchpad would otherwise
// arrive as keys. Snapshots carry Claude's modes, so returning to it restores reporting.
export const MOUSE_OFF = `${ESC}[?1000l${ESC}[?1002l${ESC}[?1003l${ESC}[?1006l`;
export const CLEAR_SCROLLBACK = `${ESC}[3J`;
// Claude Code switches on the kitty keyboard protocol, under which Esc arrives as an escape sequence rather than a
// bare ESC. The overlay pushes plain keys onto the terminal's keyboard-mode stack and pops back to Claude's on close.
export const PLAIN_KEYS = `${ESC}[>0u`;
export const RESTORE_KEYS = `${ESC}[<u`;

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
export const heading = text => `${ESC}[1;38;5;208m${text}${ESC}[0m`;
// A key to press, as a chip that reads apart from the text around it
export const keyCap = key => `${ESC}[1;38;5;16;48;5;208m ${key} ${ESC}[0m`;
const SEQUENCE = new RegExp(`${ESC}\\[[0-9;?<>]*[A-Za-z]`, 'g');

export const visibleLength = text => text.replace(SEQUENCE, '').length;

// Text on a background, padded to a width. Chips and headings inside end in a full reset, which would otherwise end
// the background with them.
export const onBackground = (text, width, color = 236) => {
	const background = `${ESC}[48;5;${color}m`;

	return `${background}${text.replaceAll(`${ESC}[0m`, `${ESC}[0m${background}`)}${background}${' '.repeat(Math.max(width - visibleLength(text), 0))}${ESC}[0m`;
};

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

// Breaks plain text into lines of at most `width` characters, at spaces where it can
export const wrap = (text, width) => {
	const lines = [];

	for (const paragraph of String(text).split('\n')) {
		let line = '';

		for (const word of paragraph.split(' ')) {
			if (line && line.length + 1 + word.length > width) {
				lines.push(line);
				line = '';
			}

			for (let rest = word; rest.length; rest = rest.slice(width)) {
				const piece = rest.slice(0, width);

				if (piece.length < width || !rest.slice(width)) line = line ? `${line} ${piece}` : piece;
				else lines.push(piece);
			}
		}

		lines.push(line);
	}

	return lines;
};
