// Claude Code titles its terminal "✳ <title>" when idle and alternates ◐ ◑ while working
const TITLE_GLYPH = /^[✳◐◑]\s+/;
const BUSY_TITLE = /^[◐◑]/;

const parseTitle = terminalTitle => ({
	busy: BUSY_TITLE.test(terminalTitle),
	title: terminalTitle.replace(TITLE_GLYPH, ''),
});

export default parseTitle;
