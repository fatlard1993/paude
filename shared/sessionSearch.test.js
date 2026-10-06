import { expect, test } from 'bun:test';

import { matchesQuery } from './sessionSearch';

const session = {
	id: '6ef0e339-eb4b',
	title: 'Fix the login redirect',
	firstPrompt: 'the login page loops after a password reset',
	project: 'home-page',
	gitBranch: 'auth-fixes',
	worktree: 'login-fix',
};

test('every word has to be somewhere the session is known by, in any order and any case', () => {
	expect(matchesQuery(session, '')).toBe(true);
	expect(matchesQuery(session, 'LOGIN home')).toBe(true);
	expect(matchesQuery(session, 'password auth-fixes')).toBe(true);
	expect(matchesQuery(session, '6ef0e339')).toBe(true);
	expect(matchesQuery(session, 'login minecraft')).toBe(false);
});
