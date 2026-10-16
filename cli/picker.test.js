import { expect, test } from 'bun:test';

import { leftWorktree, startAnywayRows } from './picker';

const warning =
	'This pull request adds or changes files Claude Code reads and can run on start: .claude/settings.json, CLAUDE.md. Look at them before starting Claude here.';

test("a pull request with Claude Code's own files shows the warning, then Don't start ahead of Start anyway", () => {
	const rows = startAnywayRows({ warning, worktree: '/code/app/.paude/worktrees/pr-3' }, 40);
	const notes = rows.filter(row => row.note).map(row => row.note);

	expect(notes.join(' ')).toBe(warning);
	expect(notes.every(note => note.length <= 40)).toBe(true);
	expect(rows.filter(row => row.value).map(({ label, value }) => [label, value])).toEqual([
		["Don't start", 'leave'],
		['Start anyway', 'start'],
	]);
	// Notes come first, so the cursor starts on Don't start
	expect(rows.findIndex(row => row.value)).toBe(notes.length);
});

test("Don't start says where the worktree is", () => {
	expect(leftWorktree('/code/app/.paude/worktrees/pr-3')).toContain(
		'The worktree is at /code/app/.paude/worktrees/pr-3;',
	);
	expect(startAnywayRows({ warning: 'hooks\x1b[2J here' }, 80)[0].note).not.toContain('\x1b');
});
