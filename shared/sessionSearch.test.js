import { expect, test } from 'bun:test';

import { matchesFilter, matchesQuery } from './sessionSearch';

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

test('with no filter archived sessions are left out, unless searching; a filter picks running, watched or archived', () => {
	const sessions = [
		{ id: 'live', live: true },
		{ id: 'watched', watching: true },
		{ id: 'put-away', archived: true },
		{ id: 'plain' },
	];
	const shown = (filter, query) =>
		sessions.filter(session => matchesFilter(session, filter, query)).map(({ id }) => id);

	expect(shown()).toEqual(['live', 'watched', 'plain']);
	expect(shown(undefined, 'away')).toEqual(['live', 'watched', 'put-away', 'plain']);
	expect(shown('running')).toEqual(['live']);
	expect(shown('watching')).toEqual(['watched']);
	expect(shown('archived')).toEqual(['put-away']);
});
