// Shared session output goes straight to this person's own terminal, and anyone who can type in the session controls
// it. These OSC commands reach past the screen into the local machine (clipboard, notifications, iTerm2's file and
// command channel, kitty's), so they're dropped; titles and links pass through, as Claude uses them. Device control,
// application, privacy and start-of-string sequences (DCS, APC, PM, SOS: tmux passthrough, kitty graphics) and 8-bit
// C1 controls are dropped whole.
const BLOCKED_OSC = new Set([9, 52, 99, 777, 1337, 5522]);
const BEL = '\x07';
const STRING_STARTS = new Set([']', 'P', '_', '^', 'X']);
// 8-bit string sequences go whole (introducer to ST or BEL), then any C1 control left
const C1_STRING = new RegExp(`[\u0090\u0098\u009d\u009e\u009f][^\u009c${BEL}]*[\u009c${BEL}]`, 'g');
const C1 = /[\u0080-\u009f]/g;

const ST = '\x1b\\';

// OSC may end with BEL; the other string sequences only with ST
const terminatorAfter = (text, from, osc) => {
	const bel = osc ? text.indexOf(BEL, from) : -1;
	const st = text.indexOf(ST, from);

	if (bel === -1 && st === -1) return null;
	if (st === -1 || (bel !== -1 && bel < st)) return { at: bel, length: 1 };

	return { at: st, length: 2 };
};

const nextStringStart = (text, from) => {
	for (let at = text.indexOf('\x1b', from); at !== -1; at = text.indexOf('\x1b', at + 1)) {
		if (at + 1 >= text.length || STRING_STARTS.has(text[at + 1])) return at;
	}

	return -1;
};

// A clipboard write (never a read: '?' asks the terminal to send its clipboard back into the session)
const CLIPBOARD_WRITE = /^52;[a-z0-9]*;[A-Za-z0-9+/=]+$/;

const kept = (text, start, end, mayCopy) => {
	if (text[start + 1] !== ']') return false;

	const body = text.slice(start + 2, end.at);

	if (CLIPBOARD_WRITE.test(body)) return mayCopy();

	return !BLOCKED_OSC.has(Number.parseInt(body.split(';')[0], 10));
};

// Returns a function that filters one chunk at a time, holding back a sequence split across chunks. mayCopy says
// whether a clipboard write goes through now: Claude copies what's selected in its own screen that way, so it's let
// through just after this person's own click or key, which nobody else in the session can time.
const outputFilter = ({ mayCopy = () => false } = {}) => {
	const decoder = new TextDecoder();
	let carry = '';

	return chunk => {
		const text = (carry + decoder.decode(chunk, { stream: true })).replace(C1_STRING, '').replace(C1, '');
		let out = '';
		let index = 0;

		carry = '';

		while (index < text.length) {
			const start = nextStringStart(text, index);

			if (start === -1) {
				out += text.slice(index);
				break;
			}

			out += text.slice(index, start);

			// A lone ESC at the end may open a sequence still on its way
			if (start + 1 >= text.length) {
				carry = '\x1b';
				break;
			}

			const end = terminatorAfter(text, start + 2, text[start + 1] === ']');

			if (!end) {
				carry = text.slice(start);
				break;
			}

			if (kept(text, start, end, mayCopy)) out += text.slice(start, end.at + end.length);

			index = end.at + end.length;
		}

		return out;
	};
};

export const filterText = text => outputFilter()(new TextEncoder().encode(text));

export default outputFilter;
