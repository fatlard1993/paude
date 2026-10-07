import os from 'os';

import { GitError } from './git';
import { sessionEnvironment } from './sessions/PtySession';
import { claudeCommand } from './sessions/running';
import gitEnvironment from './utils/gitEnvironment';

const MAX_DIFF_CHARACTERS = 60_000;
const RECENT_SUBJECTS = 15;
const TIMEOUT_MS = 180_000;

const gitOut = async (args, cwd) => {
	const child = Bun.spawn(['git', ...args], { cwd, env: gitEnvironment(), stdout: 'pipe', stderr: 'ignore' });
	const out = await new Response(child.stdout).text();

	return (await child.exited) === 0 ? out : '';
};

// What Claude is asked: the staged changes, and the repository's recent subjects for its style
export const commitPrompt = ({ subjects, stat, patch }) =>
	[
		'Write a git commit message for the staged changes below.',
		'Reply with only the message: no quotes, no code fences, nothing before or after it.',
		subjects.trim()
			? `Match the form of this repository's recent subjects (their casing, tense and prefixes):\n${subjects.trim()}`
			: 'Keep the subject under 65 characters.',
		`Staged changes:\n${stat.trim()}\n\n${patch.length > MAX_DIFF_CHARACTERS ? `${patch.slice(0, MAX_DIFF_CHARACTERS)}\n[cut short]` : patch}`,
	].join('\n\n');

// The reply, as a message: without fences or quotes Claude may wrap it in anyway
export const cleanMessage = reply =>
	reply
		.trim()
		.replace(/^```\w*\n([\s\S]*?)\n```$/, '$1')
		.replace(/^(["'])([\s\S]*)\1$/, '$2')
		.trim();

// A commit message for what's staged, written by a Claude of its own (claude -p): the session's conversation stays
// as it was, and it works while that Claude is busy. It runs outside the project so it isn't listed among its
// sessions.
export const draftCommitMessage = async root => {
	const [subjects, stat, patch] = await Promise.all([
		gitOut(['log', `-${RECENT_SUBJECTS}`, '--format=%s'], root),
		gitOut(['diff', '--cached', '--stat', '--no-color'], root),
		gitOut(['diff', '--cached', '--no-color'], root),
	]);

	if (!patch.trim()) throw new GitError('Stage something first, and Claude will describe it');

	const child = Bun.spawn([claudeCommand(), '-p', '--output-format', 'text'], {
		cwd: os.tmpdir(),
		env: sessionEnvironment(),
		stdin: new TextEncoder().encode(commitPrompt({ subjects, stat, patch })),
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: TIMEOUT_MS,
	});
	const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);

	if ((await child.exited) !== 0 || !out.trim())
		throw new GitError(`Claude couldn't write one: ${(err || out).trim().slice(0, 500) || 'no answer'}`);

	return cleanMessage(out);
};
