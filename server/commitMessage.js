import os from 'os';
import path from 'path';

import { markInterruptions, steeringOf } from './catchUp';
import { GitError, gitStack } from './git';
import { sessionEnvironment } from './sessions/PtySession';
import { claudeCommand } from './sessions/running';
import { sessionTurns } from './timeline';
import gitEnvironment from './utils/gitEnvironment';

const MAX_DIFF_CHARACTERS = 60_000;
const RECENT_SUBJECTS = 15;
const TIMEOUT_MS = 180_000;
// The latest turns behind the staged changes that the message is written from
const TURNS_BEHIND = 6;
const ANSWERS = 600;

const gitOut = async (args, cwd) => {
	const child = Bun.spawn(['git', ...args], { cwd, env: gitEnvironment(), stdout: 'pipe', stderr: 'ignore' });
	const out = await new Response(child.stdout).text();

	return (await child.exited) === 0 ? out : '';
};

// What a turn said that a commit could keep: what was asked, how the person steered, what they answered, what Claude
// ended with
const turnText = (turn, index) =>
	[
		`Turn ${index + 1}`,
		`  Asked: ${turn.prompt}`,
		steeringOf(turn).length && `  The person ${steeringOf(turn).join(', ')}.`,
		...turn.steps
			.filter(step => step.tool === 'AskUserQuestion' && step.output)
			.map(step => `  Answered: ${step.output.replace(/\s+/g, ' ').slice(0, ANSWERS)}`),
		turn.said && `  Claude ended with: ${turn.said}`,
	]
		.filter(Boolean)
		.join('\n');

// What Claude is asked: the staged changes, the repository's recent subjects for its style, and the turns of the
// conversation they came from, for the why the diff can't hold
export const commitPrompt = ({ subjects, stat, patch, turns = [], into }) =>
	[
		into
			? `The staged changes fold into an earlier commit, not pushed yet. Write that commit's whole message anew: keep what it says that still holds, and add what these changes decide. Its message now:\n${into}`
			: 'Write a git commit message for the staged changes below.',
		'Reply with only the message: no quotes, no code fences, nothing before or after it.',
		subjects.trim()
			? `Match the form of this repository's recent subjects (their casing, tense and prefixes):\n${subjects.trim()}`
			: 'Keep the subject under 65 characters.',
		turns.length
			? [
					'The subject says what changed. Add a body only when the change holds a decision: it shaped the design, a naive implementer would get it wrong, and you can say what was chosen and what was rejected. Then write it in plain sentences: what was chosen, what was rejected, and why. Where the person steered (stopped, redirected, turned something down, answered a question), that is usually the rejection: keep it.',
					'The body is read later, from blame, by someone who was never in the conversation: say what the code does and why, not how the conversation went. No "you asked", no "then we tried". No decision, no body.',
					`The conversation the changes came from:\n${turns.map(turnText).join('\n\n')}`,
				].join('\n\n')
			: '',
		`Staged changes:\n${stat.trim()}\n\n${patch.length > MAX_DIFF_CHARACTERS ? `${patch.slice(0, MAX_DIFF_CHARACTERS)}\n[cut short]` : patch}`,
	]
		.filter(Boolean)
		.join('\n\n');

// The session's turns that changed any of the staged files since `since` (an ISO time), the latest few, oldest first:
// by an edit, or by a command that names the file (a sed, a script), as git or the session's folder names it
export const turnsBehind = (turns, { cwd, root, files, since }) => {
	const staged = new Set(files.map(file => path.join(root, file)));
	const named = files.flatMap(file => [file, path.relative(cwd, path.join(root, file))]);
	const changes = step =>
		(step.edits && step.file && staged.has(path.resolve(cwd, step.file))) ||
		(step.command && named.some(file => step.command.includes(file)));

	return markInterruptions(turns)
		.filter(turn => (!since || turn.at > since) && turn.steps.some(changes))
		.slice(-TURNS_BEHIND);
};

// The reply, as a message: without fences or quotes Claude may wrap it in anyway
export const cleanMessage = reply =>
	reply
		.trim()
		.replace(/^```\w*\n([\s\S]*?)\n```$/, '$1')
		.replace(/^(["'])([\s\S]*)\1$/, '$2')
		.trim();

// A commit message for what's staged, written by a Claude of its own (claude -p): the session's conversation stays
// as it was, and it works while that Claude is busy. It runs outside the project so it isn't listed among its
// sessions. Given the session, it reads the turns that made the staged changes since the commit they'd follow (the
// one before the last, when amending).
export const draftCommitMessage = async (root, { sessionId, cwd, amend = false, into } = {}) => {
	const [subjects, stat, patch, names, since] = await Promise.all([
		gitOut(['log', `-${RECENT_SUBJECTS}`, '--format=%s'], root),
		gitOut(['diff', '--cached', '--stat', '--no-color'], root),
		gitOut(['diff', '--cached', '--no-color'], root),
		gitOut(['diff', '--cached', '--name-only', '-z'], root),
		gitOut(['log', '-1', '--format=%cI', amend ? 'HEAD~1' : 'HEAD'], root),
	]);

	if (!patch.trim()) throw new GitError('Stage something first, and Claude will describe it');

	const concern = into && (await gitStack(root)).concerns.find(open => open.hash === into);

	const turns =
		sessionId && cwd
			? turnsBehind(await sessionTurns(sessionId, cwd), {
					cwd,
					root,
					files: names.split('\0').filter(Boolean),
					since: since.trim() && new Date(since.trim()).toISOString(),
				})
			: [];
	const child = Bun.spawn([claudeCommand(), '-p', '--output-format', 'text'], {
		cwd: os.tmpdir(),
		env: sessionEnvironment(),
		stdin: new TextEncoder().encode(
			commitPrompt({
				subjects,
				stat,
				patch,
				turns,
				into: concern && [concern.subject, concern.body].filter(Boolean).join('\n\n'),
			}),
		),
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: TIMEOUT_MS,
	});
	const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);

	if ((await child.exited) !== 0 || !out.trim())
		throw new GitError(`Claude couldn't write one: ${(err || out).trim().slice(0, 500) || 'no answer'}`);

	return cleanMessage(out);
};
