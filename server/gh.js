import { GitError } from './git';
import { sessionEnvironment } from './sessions/PtySession';

// GitHub's own command, gh, with the login and PATH Claude's sessions have. Whatever gh says when it can't (not
// installed, not logged in, not GitHub) comes back to show.
const GH_TIMEOUT_MS = 60_000;

export const hasGh = () => Boolean(Bun.which('gh', { PATH: sessionEnvironment().PATH }));

// { code, out, err }; `input` goes to its stdin (a request body for `gh api --input -`)
export const gh = async (args, cwd, { input } = {}) => {
	if (!hasGh()) throw new GitError("GitHub's gh command isn't installed here");

	const child = Bun.spawn(['gh', ...args], {
		cwd,
		env: { ...sessionEnvironment(), GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
		stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input),
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: GH_TIMEOUT_MS,
	});
	const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);

	return { code: await child.exited, out, err: err.trim() };
};
