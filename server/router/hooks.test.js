import { expect, test } from 'bun:test';

import { isPush } from './hooks';

test('a push is git push anywhere in the command, options and all; nothing else is', () => {
	for (const command of [
		'git push',
		'git -C ../lib push origin main',
		'cd /repo && git push 2>&1 | tail -5',
		'git fetch -q; git -c core.hooksPath=/dev/null push',
		'(git push)',
	])
		expect(isPush(command)).toBe(true);
	for (const command of ['git status', 'echo git push', 'git log --grep=push', 'git stash push -m wip', undefined])
		expect(isPush(command)).toBe(false);
});
