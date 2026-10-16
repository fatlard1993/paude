import os from 'os';

import { gh } from './gh';
import { GitError, defaultBase, gitAction, gitLog } from './git';
import { sessionEnvironment } from './sessions/PtySession';
import { claudeCommand } from './sessions/running';

// Pull requests through GitHub's own command, gh: the one for this branch with its checks, and opening one with a
// title and description Claude drafts.
const DRAFT_TIMEOUT_MS = 180_000;
const FIELDS = 'number,title,url,state,isDraft,baseRefName,headRefName,headRefOid,statusCheckRollup';

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

// How a walk-through of the change reads, for the description to follow
const walkThrough = tour =>
	[
		tour.overview,
		...tour.stops.map(
			stop =>
				`- ${stop.path} ${stop.from === stop.to ? `line ${stop.from}` : `lines ${stop.from}-${stop.to}`}${stop.side === 'old' ? ' (removed)' : ''}: ${stop.text}`,
		),
	].join('\n');

// The prompt for a draft: the commits and what they change, and where they're known, a walk-through of the change
// (`tour`) and whether it was tested (`tested`, a sentence)
export const draftPrompt = ({ commits, stat, tour, tested }) =>
	[
		'Write a pull request title and description for this branch.',
		'Reply with the title on the first line, a blank line, then the description in Markdown. Nothing before or after.',
		[
			'The description: what changes and why, briefly.',
			tour &&
				'Then a short "How to review it" list that follows the walk-through below, in its order, naming the files.',
			tested &&
				'Then "Testing": only what the testing line below says, in plain words; where it says no test ran or tests are stale or failing, say so rather than claiming they pass.',
		]
			.filter(Boolean)
			.join(' '),
		`Its commits:\n${commits.map(commit => `- ${commit.subject}`).join('\n')}`,
		`What it changes:\n${stat}`,
		tour && `A walk-through of the change, in the order that makes sense of it:\n${walkThrough(tour)}`,
		tested && `Testing, as seen in the session that made it: ${tested}`,
	]
		.filter(Boolean)
		.join('\n\n');

// How the drafting Claude runs: on its default model, as haiku.js runs Haiku, with no tools, none of the owner's
// settings (their hooks, permissions, MCP servers) and nothing saved, so a prompt made of commit subjects can only get
// text back
export const draftCommand = () => [
	claudeCommand(),
	'-p',
	'--output-format',
	'text',
	'--no-session-persistence',
	'--setting-sources',
	'',
	'--tools',
	'',
];

// A title and description for this branch's pull request, from its commits and what it changes, written by a Claude
// of its own (the session's conversation is left alone): { title, body }
export const draftPullRequest = async (root, { tour, tested } = {}) => {
	const base = await defaultBase(root);

	if (!base) throw new GitError('There is no branch to compare with');

	const commits = await gitLog(root, { ref: `${base}..HEAD`, limit: 100 });

	if (!commits.length) throw new GitError(`This branch has nothing ${base} doesn't`);

	const stat = Bun.spawnSync(['git', 'diff', '--stat', `${base}...HEAD`], { cwd: root }).stdout.toString();
	const prompt = draftPrompt({ commits, stat, tour, tested });
	const child = Bun.spawn(draftCommand(), {
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
