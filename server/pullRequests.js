import os from 'os';

import { GitError, defaultBase, gitAction, gitLog } from './git';
import { sessionEnvironment } from './sessions/PtySession';
import { claudeCommand } from './sessions/running';

// Pull requests through GitHub's own command, gh: the one for this branch with its checks, and opening one with a
// title and description Claude drafts. Whatever gh says when it can't (not installed, not logged in, not GitHub)
// comes back to show.
const GH_TIMEOUT_MS = 60_000;
const DRAFT_TIMEOUT_MS = 180_000;
const FIELDS = 'number,title,url,state,isDraft,baseRefName,headRefName,statusCheckRollup';

const gh = async (args, root) => {
	if (!Bun.which('gh', { PATH: sessionEnvironment().PATH }))
		throw new GitError("GitHub's gh command isn't installed here");

	const child = Bun.spawn(['gh', ...args], {
		cwd: root,
		env: { ...sessionEnvironment(), GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: GH_TIMEOUT_MS,
	});
	const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);

	return { code: await child.exited, out, err: err.trim() };
};

// One check, whichever kind GitHub reports it as (a workflow run, or a commit status)
const checkOf = check => ({
	name: check.name ?? check.context,
	state: (check.conclusion || check.state || check.status || '').toLowerCase(),
	url: check.detailsUrl ?? check.targetUrl ?? null,
});

// The pull request for this branch, or null; { unavailable } when gh can't say
export const pullRequest = async root => {
	try {
		const { code, out, err } = await gh(['pr', 'view', '--json', FIELDS], root);

		if (code !== 0) return /no pull requests found/i.test(err) ? null : { unavailable: err || 'gh could not look' };

		const found = JSON.parse(out);

		return { ...found, checks: (found.statusCheckRollup ?? []).map(checkOf), statusCheckRollup: undefined };
	} catch (error) {
		if (error instanceof GitError) return { unavailable: error.message };
		throw error;
	}
};

// Pushed first (tracking origin the first time), then opened against the base
export const openPullRequest = async (root, { title, body, draft, base }) => {
	if (typeof title !== 'string' || !title.trim()) throw new GitError('Give it a title');

	const pushed = await gitAction(root, 'push');

	if (!pushed.ok) throw new GitError(pushed.output);

	const against = (base || (await defaultBase(root)) || '').replace(/^origin\//, '');
	const { code, out, err } = await gh(
		[
			'pr',
			'create',
			'--title',
			title.trim(),
			'--body',
			body ?? '',
			...(draft ? ['--draft'] : []),
			...(against ? ['--base', against] : []),
		],
		root,
	);

	if (code !== 0) throw new GitError(err || 'gh could not open it');

	return { url: out.trim().split('\n').at(-1) };
};

// A title and description for this branch's pull request, from its commits and what it changes, written by a Claude
// of its own (the session's conversation is left alone): { title, body }
export const draftPullRequest = async root => {
	const base = await defaultBase(root);

	if (!base) throw new GitError('There is no branch to compare with');

	const commits = await gitLog(root, { ref: `${base}..HEAD`, limit: 100 });

	if (!commits.length) throw new GitError(`This branch has nothing ${base} doesn't`);

	const stat = Bun.spawnSync(['git', 'diff', '--stat', `${base}...HEAD`], { cwd: root }).stdout.toString();
	const prompt = [
		'Write a pull request title and description for this branch.',
		'Reply with the title on the first line, a blank line, then the description in Markdown: what changes and why, briefly. Nothing before or after.',
		`Its commits:\n${commits.map(commit => `- ${commit.subject}`).join('\n')}`,
		`What it changes:\n${stat}`,
	].join('\n\n');
	const child = Bun.spawn([claudeCommand(), '-p', '--output-format', 'text'], {
		cwd: os.tmpdir(),
		env: sessionEnvironment(),
		stdin: new TextEncoder().encode(prompt),
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: DRAFT_TIMEOUT_MS,
	});
	const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);

	if ((await child.exited) !== 0 || !out.trim())
		throw new GitError(`Claude couldn't write one: ${(err || out).trim().slice(0, 500)}`);

	const [title, ...rest] = out
		.trim()
		.replace(/^#+\s*/, '')
		.split('\n');

	return { title: title.replace(/^title:\s*/i, '').trim(), body: rest.join('\n').trim() };
};
