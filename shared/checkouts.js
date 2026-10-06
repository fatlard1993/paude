const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Where a new session goes is asked only when there's a choice: something already runs here, or a worktree exists.
// `checkouts` is null outside git.
export const choiceNeeded = checkouts =>
	Boolean(checkouts && (checkouts.some(({ active }) => active) || checkouts.length > 1));

// "3 sessions running: 2 in the main checkout, 1 in worktree login-fix."
export const runningSummary = checkouts => {
	const total = checkouts.reduce((sum, { active }) => sum + active, 0);

	if (!total) return 'No sessions are running here.';

	const places = checkouts
		.filter(({ active }) => active)
		.map(({ active, main, name }) => `${active} in ${main ? 'the main checkout' : `worktree ${name}`}`);

	return `${plural(total, 'session')} running: ${places.join(', ')}.`;
};
