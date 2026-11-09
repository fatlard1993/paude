// The game counts as settled once its frame has gone this long without loading again: each save rebuilds the page
// and starts the server over, and the frame reloads with each, often more than once in quick succession
const SETTLED_AFTER_MS = 3000;
// However busy the reloading, the game is shown after this long
const SETTLE_AT_MOST_MS = 20_000;

// Whether the game may be shown: no game up (a room says why), quiet long enough since its last load, or waited for
// as long as it's ever waited for
export const settledYet = ({ hasGame, loadedAt, began, now }) =>
	!hasGame || now - loadedAt >= SETTLED_AFTER_MS || now - began >= SETTLE_AT_MOST_MS;
