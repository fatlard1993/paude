import { expect, test } from 'bun:test';

import { projectSummary } from './projects';

test('a project with no sessions left still says when it was last active', () => {
	const hourAgo = Date.now() - 60 * 60_000;

	expect(projectSummary({ sessionCount: 2, lastActivity: hourAgo })).toBe('2 sessions · 1h ago');
	expect(projectSummary({ sessionCount: 0, lastActivity: hourAgo })).toBe('no sessions · 1h ago');
	expect(projectSummary({ sessionCount: 0, lastActivity: null })).toBe('no sessions');
});
