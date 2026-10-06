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
