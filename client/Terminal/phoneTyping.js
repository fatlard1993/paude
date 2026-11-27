const DEL = '\x7f';

// What a phone keyboard did to the text it's been typing into, as keys for a terminal: a backspace for each character
// it took back past what the two still share at the start, then what it put in their place. A word swapped for its
// suggestion or correction is the word erased and the new one typed, not the whole text again.
export const typed = (before, after) => {
	let shared = 0;

	while (shared < before.length && shared < after.length && before[shared] === after[shared]) shared++;

	return DEL.repeat(before.length - shared) + after.slice(shared).replace(/\r?\n/g, '\r');
};

// On a touch screen, what's typed into xterm is read from the text its hidden textarea holds rather than left to
// xterm, which takes a phone keyboard's every change as text added at the end: a word autocompleted or corrected
// sent the textarea's whole content again. Keys a keyboard sends as keys (Enter, Backspace, arrows) are still xterm's.
// A desktop's input methods are left to xterm as well. Listened for on the terminal's element, ahead of the textarea.
export const phoneTyping = terminal => {
	const { element, textarea } = terminal;

	if (!element || !textarea || !window.matchMedia?.('(pointer: coarse)').matches) return;

	let before = textarea.value;
	const mine = event => event.target === textarea;
	const swallow = event => {
		if (mine(event)) event.stopPropagation();
	};

	for (const name of ['compositionstart', 'compositionupdate', 'compositionend'])
		element.addEventListener(name, swallow, true);
	element.addEventListener(
		'beforeinput',
		event => {
			if (mine(event)) before = textarea.value;
		},
		true,
	);
	element.addEventListener(
		'input',
		event => {
			if (!mine(event)) return;
			event.stopPropagation();

			const keys = typed(before, textarea.value);

			before = textarea.value;
			if (keys) terminal.input(keys);
			// A line sent leaves nothing for the keyboard to correct: started afresh, the textarea doesn't hold every
			// line typed since the page opened
			if (keys.includes('\r')) before = textarea.value = '';
		},
		true,
	);
	// A keyboard that names no key (229) has changed the text, read from it on input; xterm would read it too
	element.addEventListener(
		'keydown',
		event => {
			if (mine(event) && (event.keyCode === 229 || event.key === 'Unidentified')) event.stopPropagation();
		},
		true,
	);
};
