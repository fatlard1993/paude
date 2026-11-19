import { describe, expect, test } from 'bun:test';

import { LISTED, SHIP_LISTED, tidyBrief, tidyShipBrief } from './tidy';

const session = (id, more = {}) => ({
	id,
	title: `session ${id}`,
	live: false,
	archived: false,
	status: 'ready',
	attached: 0,
	worktree: null,
	gitBranch: 'main',
	lastModified: Date.UTC(2026, 10, 15, 9, 30),
	...more,
});

describe('tidyBrief', () => {
	test('lists each session with what paude knows of it', () => {
		const brief = tidyBrief({
			project: 'shop',
			cwd: '/p/shop',
			sessions: [
				session('a', { live: true, status: 'working', attached: 1, worktree: 'fix', gitBranch: 'fix' }),
				session('b', { archived: true, watching: true }),
				session('c', { live: true, status: 'waiting', asking: { question: 'which?' } }),
			],
			checkouts: [
				{ main: true, path: '/p/shop', branch: 'main', paude: false, active: 1 },
				{ main: false, name: 'fix', path: '/p/shop/.paude/worktrees/fix', branch: 'fix', paude: true, active: 1 },
			],
		});

		expect(brief).toContain('Tidy up the project shop (/p/shop)');
		expect(brief).toContain(
			'- a "session a" · running (working), 1 attached · in worktree fix · on fix · last active 2026-11-15 09:30 UTC',
		);
		expect(brief).toContain('- b "session b" · stopped, archived · watched · in the main checkout');
		expect(brief).toContain('- c "session c" · running (waiting) · asking a question');
		expect(brief).toContain('- worktree fix: /p/shop/.paude/worktrees/fix · on fix · made by paude · 1 running');
		expect(brief).toContain('`paude delete <id>...`');
	});

	test('lists the newest sessions only, and says how many more there are', () => {
		const many = Array.from({ length: LISTED + 3 }, (_, at) => session(`s${at}`));
		const brief = tidyBrief({ project: 'shop', cwd: '/p/shop', sessions: many, checkouts: null });

		expect(brief).toContain(`newest first (${LISTED + 3})`);
		expect(brief).toContain(`- s${LISTED - 1} `);
		expect(brief).not.toContain(`- s${LISTED} `);
		expect(brief).toContain('(and 3 older, not listed');
		expect(brief).toContain('not the top of a git repository');
	});
});

describe('tidyShipBrief', () => {
	const main = path => ({ main: true, path, branch: 'main', paude: false, active: 0 });

	test('goes over every project with sessions or other checkouts, a section each, and names the rest', () => {
		const brief = tidyShipBrief({
			machine: 'dellbook',
			projects: [
				{ project: 'shop', cwd: '/p/shop', sessions: [session('a')], checkouts: [main('/p/shop')] },
				{
					project: 'yard',
					cwd: '/p/yard',
					sessions: [],
					checkouts: [main('/p/yard'), { main: false, name: 'old', path: '/p/yard/old', branch: 'old', paude: true }],
				},
				{ project: 'attic', cwd: '/p/attic', sessions: [], checkouts: [main('/p/attic')] },
				{ project: 'notes', cwd: '/p/notes', sessions: [], checkouts: null },
			],
		});

		expect(brief).toContain('Tidy up every project on dellbook');
		expect(brief).toContain('## shop (/p/shop)');
		expect(brief).toContain('- a "session a"');
		expect(brief).toContain('## yard (/p/yard)');
		expect(brief).toContain('- worktree old: /p/yard/old');
		expect(brief).not.toContain('## attic');
		expect(brief).toContain('Nothing to go over (no sessions, no other checkouts): attic, notes.');
		expect(brief).toContain('`paude delete <id>...`');
		expect(brief).toContain('grouped by project');
	});

	test("lists fewer of each project's sessions than a project's own tidy-up", () => {
		const many = Array.from({ length: SHIP_LISTED + 2 }, (_, at) => session(`s${at}`));
		const brief = tidyShipBrief({
			machine: 'm',
			projects: [{ project: 'shop', cwd: '/p/shop', sessions: many, checkouts: null }],
		});

		expect(brief).toContain(`- s${SHIP_LISTED - 1} `);
		expect(brief).not.toContain(`- s${SHIP_LISTED} `);
		expect(brief).toContain('(and 2 older, not listed');
	});
});
