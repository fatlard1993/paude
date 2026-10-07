// Claude Code's line at the end of each turn: its verb and time taken, then when it finished, which can carry a day
// and use either clock. It starts its row (after a spinner glyph), so one quoted in the middle of a reply isn't it.
const DONE_MARKER =
	/^\s*(?:\S\s+)?\S+ for (?:\d+[hms] ?)+ · done (?:[A-Za-z]{3},? (?:\d{1,2}, )?)?\d{1,2}:\d{2}(?:\s?[AP]M)?/;

export default DONE_MARKER;
