import os from 'os';

import { gh } from './gh';
import { GitError, defaultBase, gitAction, gitLog } from './git';
import { sessionEnvironment } from './sessions/PtySession';
import { claudeCommand } from './sessions/running';

// Pull requests through GitHub's own command, gh: the one for this branch with its checks, and opening one with a
// title and description Claude drafts.
const DRAFT_TIMEOUT_MS = 180_000;
// The most of the commits' messages a draft is given; past it, the latest commits are named by subject alone
const MESSAGE_CHARACTERS = 16_000;
// The most of the design documents' changes a draft is given
const DESIGN_CHARACTERS = 12_000;
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

// The commits oldest first, each with its body while they fit: where a commit's why lives, the decisions in it
const commitList = commits => {
	let size = 0;

	return commits
		.toReversed()
		.map(({ subject, body }) => {
			const told = body ? `${subject}\n${body.replace(/^/gm, '  ')}` : subject;

			size += told.length;

			return `- ${size > MESSAGE_CHARACTERS ? subject : told}`;
		})
		.join('\n');
};

// The prompt for a draft: the commits, newest first as git lists them, and what they change, and where they're
// known, a walk-through of the change (`tour`), whether it was tested (`tested`, a sentence), and how the design
// documents' claims changed (`design`, their diff)
export const draftPrompt = ({ commits, stat, tour, tested, design }) =>
	[
		'Write a pull request title and description for this branch.',
		'Reply with the title on the first line, a blank line, then the description in Markdown. Nothing before or after.',
		[
			'The description: what changes and why, briefly.',
			design &&
				'Then "Design changes": each claim the design documents below add, change or drop, in a line, saying which document; this is how the intended behavior moved, so a reviewer reads it first.',
			'Then, where the commit messages record decisions (what was chosen over what, and why), a short "Decisions" list of those a reviewer would question; only what the messages say, and none at all when they record none.',
			tour &&
				'Then a short "How to review it" list that follows the walk-through below, in its order, naming the files.',
			tested &&
				'Then "Testing": only what the testing line below says, in plain words; where it says no test ran or tests are stale or failing, say so rather than claiming they pass.',
		]
			.filter(Boolean)
			.join(' '),
		`Its commits, oldest first, with their messages:\n${commitList(commits)}`,
		`What it changes:\n${stat}`,
		tour && `A walk-through of the change, in the order that makes sense of it:\n${walkThrough(tour)}`,
		tested && `Testing, as seen in the session that made it: ${tested}`,
		design && `How the design documents (.lld.md, the claims the code is held to) changed:\n${design}`,
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

	const commits = await gitLog(root, { ref: `${base}..HEAD`, limit: 100, bodies: true });

	if (!commits.length) throw new GitError(`This branch has nothing ${base} doesn't`);

	const stat = Bun.spawnSync(['git', 'diff', '--stat', `${base}...HEAD`], { cwd: root }).stdout.toString();
	const design = Bun.spawnSync(['git', 'diff', '--no-color', `${base}...HEAD`, '--', '*.lld.md'], { cwd: root })
		.stdout.toString()
		.slice(0, DESIGN_CHARACTERS);
	const prompt = draftPrompt({ commits, stat, tour, tested, design });
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
