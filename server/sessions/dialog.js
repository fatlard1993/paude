const RULE = /^[─╌]{20,}$/;
const OPTION = /^\s*(?:❯\s*)?(\d+)\.\s+(.+)$/;
const FOOTER = /Esc to cancel/;
const LOOK_BACK_ROWS = 60;
// Answered by typing, not by a key: left to the terminal
const NEEDS_TYPING = /^(Type something|Chat about this)/i;

// What Claude is asking on a screen (an xterm buffer), read from its dialog: a title, what it says, the question and
// its numbered options, each answered by pressing its number. null when no dialog shows.
//
//  Bash command                               ← title, after the rule above the dialog
//  Write current Unix timestamp to stamp.txt  ← details
//  date +%s > stamp.txt
//  Do you want to proceed?                    ← question
//  ❯ 1. Yes                                   ← options; an indented line under one is its detail, or its
//    2. Yes, and always allow access to …       wrapped tail when the line above it ran to the edge
//  Esc to cancel · Tab to amend               ← footer
const readDialog = (buffer, cols) => {
	const textOf = y => buffer.getLine(y)?.translateToString(true) ?? '';
	const last = buffer.length - 1;
	let footer = last;

	while (footer > Math.max(0, last - LOOK_BACK_ROWS) && !FOOTER.test(textOf(footer))) footer -= 1;
	if (!FOOTER.test(textOf(footer))) return null;

	// Upward from the footer: option rows, the lines under them, rules between them
	const below = [];
	let y = footer - 1;

	for (; y >= 0; y--) {
		const text = textOf(y);

		if (RULE.test(text.trim()) || !text.trim()) continue;
		if (OPTION.test(text) || /^\s{2,}\S/.test(text)) below.unshift(text);
		else break;
	}

	const options = [];

	for (const [index, text] of below.entries()) {
		const option = OPTION.exec(text);

		if (option) options.push({ key: option[1], label: option[2].trim(), detail: '' });
		else if (options.length) {
			const previous = options.at(-1);
			const ranToEdge = below[index - 1].trimEnd().length >= cols - 2;

			if (ranToEdge && !previous.detail) previous.label += text.trim();
			else previous.detail = [previous.detail, text.trim()].filter(Boolean).join(' ');
		}
	}
	if (!options.length || y < 0) return null;

	const question = textOf(y).trim();
	const details = [];

	for (y -= 1; y >= 0 && !/^─{20,}$/.test(textOf(y).trim()); y--) {
		const text = textOf(y).trim();

		if (text && !RULE.test(text) && !text.startsWith('Tip:')) details.unshift(text);
	}

	return {
		title: details.shift() ?? '',
		details,
		question,
		options: options
			.filter(option => !NEEDS_TYPING.test(option.label))
			.map(option => ({ ...option, detail: option.detail === option.label ? '' : option.detail })),
	};
};

export default readDialog;
