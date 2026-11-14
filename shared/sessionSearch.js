// Every word of the query, in any order, somewhere in what a session is known by: its title, the prompt it began
// with, its project, branch and worktree, or its id
export const matchesQuery = (session, query) => {
	const words = String(query ?? '')
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);

	if (!words.length) return true;

	const known = [session.title, session.firstPrompt, session.project, session.gitBranch, session.worktree, session.id]
		.filter(Boolean)
		.join('\n')
		.toLowerCase();

	return words.every(word => known.includes(word));
};

export const FILTERS = ['running', 'watching', 'hidden', 'archived'];

// Which sessions a list shows: those running, watched, hidden or archived, or with no filter every one not archived. A
// search with no filter looks through the archived ones too, so nothing put away is lost. Hidden is what the ship leaves
// off: stopped and not watched by hand (a project's watch doesn't keep one aboard), going by `watching` for a paude too
// old to say `watchedByHand`.
export const matchesFilter = (session, filter, query) => {
	if (filter === 'running') return Boolean(session.live);
	if (filter === 'watching') return Boolean(session.watching);
	if (filter === 'hidden') return !session.live && !session.archived && !(session.watchedByHand ?? session.watching);
	if (filter === 'archived') return Boolean(session.archived);

	return !session.archived || Boolean(String(query ?? '').trim());
};
