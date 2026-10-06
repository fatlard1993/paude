const ESC = '\x1b';
const STRING_END = `(?:\\x07|${ESC}\\\\)`;

// What a terminal sends on its own when a program asks it something: cursor position, device attributes, mode and
// keyboard-protocol reports, window sizes, and OSC/DCS answers (colors, version, capabilities)
const REPLY = [
	`${ESC}\\[\\d+;\\d+R`,
	`${ESC}\\[[?>=][\\d;]*c`,
	`${ESC}\\[\\d+n`,
	`${ESC}\\[\\??[\\d;]+\\$y`,
	`${ESC}\\[\\?\\d*u`,
	`${ESC}\\[\\d+(?:;\\d+)*t`,
	`${ESC}\\][^\\x07${ESC}]*${STRING_END}`,
	`${ESC}P[^${ESC}]*${ESC}\\\\`,
].join('|');

// Produced by pointing and switching windows, not typing
const POINTER = [`${ESC}\\[<\\d+;\\d+;\\d+[Mm]`, `${ESC}\\[M[\\s\\S]{3}`, `${ESC}\\[[IO]`].join('|');

const ONLY_REPLIES = new RegExp(`^(?:${REPLY})+$`);
const ONLY_POINTER = new RegExp(`^(?:${POINTER}|${REPLY})+$`);

export const FOCUS_IN = `${ESC}[I`;

// 'reply': the terminal answering a query. 'pointer': mouse and focus reports (replies may ride along).
// 'typing': anything a person typed, which is what decides who drives the session's size.
const inputKind = data => {
	if (ONLY_REPLIES.test(data)) return 'reply';
	if (ONLY_POINTER.test(data)) return 'pointer';

	return 'typing';
};

export default inputKind;
