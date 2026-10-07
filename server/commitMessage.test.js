import { expect, test } from 'bun:test';

import { cleanMessage, commitPrompt } from './commitMessage';

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
