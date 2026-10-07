const RULE = /^─{20,}$/;
const PROMPT = '❯';
// Claude's placeholder is dim; without colors it still reads "Try "..."
const PLACEHOLDER = /^Try "/;
const LOOK_BACK_ROWS = 200;

// What's typed in Claude's prompt box on a screen (an xterm buffer): the rows between its two rules, after the ❯.
// '' when it's empty (its placeholder hint is nothing typed); null when no prompt box shows, as when Claude is asking
// for a permission or an answer.
const promptDraft = buffer => {
	const textOf = y => buffer.getLine(y)?.translateToString(true).trim() ?? '';
	const last = buffer.length - 1;
	let bottom = last;

	while (bottom > Math.max(0, last - LOOK_BACK_ROWS) && !RULE.test(textOf(bottom))) bottom -= 1;

	let top = bottom - 1;

	while (top > 0 && !RULE.test(textOf(top))) top -= 1;

	if (top < 0 || bottom - top < 2 || !textOf(top + 1).startsWith(PROMPT)) return null;

	const rows = [];

	for (let y = top + 1; y < bottom; y++) {
		const line = buffer.getLine(y);
		let typed = '';

		for (let x = 0; x < line.length; x++) {
			const cell = line.getCell(x);

			if (!cell.isDim()) typed += cell.getChars() || ' ';
		}

		rows.push(typed.replace(y === top + 1 ? PROMPT : '', '').trim());
	}

	const draft = rows.join('\n').trim();

	return PLACEHOLDER.test(draft) ? '' : draft;
};

export default promptDraft;
