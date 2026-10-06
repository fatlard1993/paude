import { expect, test } from 'bun:test';

import { runningSummary } from './checkouts';

const main = (active = 0) => ({ name: null, main: true, active });
const worktree = (name, active = 0) => ({ name, main: false, active });

test('the summary says how many run, and where', () => {
	expect(runningSummary([main()])).toBe('No sessions are running here.');
	expect(runningSummary([main(1)])).toBe('1 session running: 1 in the main checkout.');
	expect(runningSummary([main(2), worktree('login-fix', 1), worktree('idle')])).toBe(
		'3 sessions running: 2 in the main checkout, 1 in worktree login-fix.',
	);
});
