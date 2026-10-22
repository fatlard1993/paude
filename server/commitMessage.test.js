import { expect, test } from 'bun:test';

import { cleanMessage, commitPrompt, turnsBehind } from './commitMessage';

test("asks in the repository's own style, with the staged changes", () => {
	const prompt = commitPrompt({ subjects: 'fix login\nadd picker\n', stat: ' a.js | 2 +-', patch: '+new' });

	expect(prompt).toContain("Match the form of this repository's recent subjects");
	expect(prompt).toContain('fix login\nadd picker');
	expect(prompt).toContain('+new');
});

test('takes the message out of fences or quotes Claude added anyway', () => {
	expect(cleanMessage('```\nfix the picker\n```')).toBe('fix the picker');
	expect(cleanMessage('"fix the picker"\n')).toBe('fix the picker');
	expect(cleanMessage('fix the picker\n\nIt crashed on empty lists.')).toBe(
		'fix the picker\n\nIt crashed on empty lists.',
	);
});

test('asks for the why from the turns behind the changes, and for a body only when they hold a decision', () => {
	const prompt = commitPrompt({
		subjects: '',
		stat: ' a.js | 2 +-',
		patch: '+new',
		turns: [
			{
				prompt: 'count failed logins',
				stopped: true,
				steps: [{ tool: 'AskUserQuestion', output: 'User has answered: per user' }],
				said: 'Locked per user.',
			},
		],
	});

	expect(prompt).toContain('Asked: count failed logins');
	expect(prompt).toContain('The person stopped partway.');
	expect(prompt).toContain('Answered: User has answered: per user');
	expect(prompt).toContain('Claude ended with: Locked per user.');
	expect(prompt).toContain('No decision, no body.');
});

test('without a conversation, asks from the diff alone', () => {
	expect(commitPrompt({ subjects: '', stat: '', patch: '+new' })).not.toContain('No decision, no body.');
});

test('the turns behind are those that edited a staged file since the commit they follow', () => {
	const turn = (at, file, extra = {}) => ({ at, prompt: at, steps: [{ tool: 'Edit', edits: true, file }], ...extra });
	const turns = [
		turn('2026-10-22T10:00:00.000Z', 'a.js'),
		turn('2026-10-22T12:00:00.000Z', 'a.js'),
		turn('2026-10-22T12:30:00.000Z', 'other.js'),
		{ at: '2026-10-22T12:40:00.000Z', prompt: '[Request interrupted by user]', interrupted: true, steps: [] },
		turn('2026-10-22T12:45:00.000Z', '/repo/sub/b.js'),
	];
	const behind = turnsBehind(turns, {
		cwd: '/repo',
		root: '/repo',
		files: ['a.js', 'sub/b.js'],
		since: '2026-10-22T11:00:00.000Z',
	});

	expect(behind.map(found => found.at)).toEqual(['2026-10-22T12:00:00.000Z', '2026-10-22T12:45:00.000Z']);
	expect(behind[1].redirect).toBe(true);
});

test('a command that names a staged file counts as changing it', () => {
	const turns = [
		{ at: '2026-10-22T12:00:00.000Z', prompt: 'p', steps: [{ tool: 'Bash', command: "sed -i 's/a/b/' sub/b.js" }] },
		{ at: '2026-10-22T12:10:00.000Z', prompt: 'q', steps: [{ tool: 'Bash', command: 'ls sub' }] },
	];

	expect(turnsBehind(turns, { cwd: '/repo/sub', root: '/repo', files: ['sub/b.js'] }).map(t => t.prompt)).toEqual([
		'p',
	]);
});
