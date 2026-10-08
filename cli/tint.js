import { folderTints } from '../shared/folderColor';

// kitty keeps a stack of colors: the window's own are pushed before a session's tint and popped after, so whatever
// tinted the window before (kitty-bg's color for the folder it's in) comes back. Elsewhere there's no stack to come
// back from, so nothing is tinted.
const kitty = Boolean(process.env.KITTY_WINDOW_ID) || process.env.TERM === 'xterm-kitty';

const PUSH = '\x1b]30001\x1b\\';
const POP = '\x1b]30101\x1b\\';

// The session's folder color on the window, as kitty-bg would have it: background, foreground and cursor
export const tintFor = hue => {
	const tints = kitty && folderTints(hue);

	return tints ? `${PUSH}\x1b]11;${tints.background}\x07\x1b]10;${tints.foreground}\x07\x1b]12;${tints.accent}\x07` : '';
};

export const UNTINT = POP;
