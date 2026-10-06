// Shared session output goes straight to this person's own terminal, and anyone who can type in the session controls
// it. These OSC commands reach past the screen into the local machine (clipboard, notifications, iTerm2's file and
// command channel), so they're dropped. Titles and links pass through: Claude uses them.
const BLOCKED_OSC = new Set(['52', '9', '99', '777', '1337']);

const OSC_START = '\x1b]';
const BEL = '\x07';
const ST = '\x1b\\';

const terminatorAfter = (text, from) => {
	const bel = text.indexOf(BEL, from);
	const st = text.indexOf(ST, from);

	if (bel === -1 && st === -1) return null;
	if (st === -1 || (bel !== -1 && bel < st)) return { at: bel, length: 1 };

	return { at: st, length: 2 };
};

// Returns a function that filters one chunk at a time, holding back an OSC sequence split across chunks
const outputFilter = () => {
	const decoder = new TextDecoder();
	let carry = '';

	return chunk => {
		const text = carry + decoder.decode(chunk, { stream: true });
		let out = '';
		let index = 0;

		carry = '';

		while (index < text.length) {
			const start = text.indexOf(OSC_START, index);

			if (start === -1) {
				out += text.slice(index);
				break;
			}

			out += text.slice(index, start);

			const end = terminatorAfter(text, start + 2);

			if (!end) {
				carry = text.slice(start);
				break;
			}

			const command = text.slice(start + 2, end.at).split(';')[0];

			if (!BLOCKED_OSC.has(command)) out += text.slice(start, end.at + end.length);

			index = end.at + end.length;
		}

		// A lone trailing ESC may be the start of an OSC still on its way
		if (!carry && out.endsWith('\x1b')) {
			carry = '\x1b';
			out = out.slice(0, -1);
		}

		return out;
	};
};

export default outputFilter;
