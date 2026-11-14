import { expect, test } from 'bun:test';

import { ASK_BEFORE_STOPPING, endsWithQuestion, isPush } from './hooks';

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

test("an arcade turn that ends without a question is sent back once to ask one; any other session's isn't", async () => {
	const arcade = async () => true;
	const sentBack = await endsWithQuestion('s1', { hook_event_name: 'Stop' }, { arcade });

	expect(await sentBack.json()).toEqual({ decision: 'block', reason: ASK_BEFORE_STOPPING });
	expect(await endsWithQuestion('s1', { hook_event_name: 'Stop', stop_hook_active: true }, { arcade })).toBeNull();
	expect(await endsWithQuestion('s1', { hook_event_name: 'Stop' }, { arcade: async () => false })).toBeNull();
});
