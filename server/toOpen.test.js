import { expect, test } from 'bun:test';

import { openPrompt, parseOpenings, pathsFor } from './toOpen';

const surface = {
	viewing: 'server/auth.js',
	changes: [{ path: 'server/auth.js', status: 'modified' }],
	turns: [
		{ id: 't1', prompt: 'look around', edited: [], read: ['README.md'] },
		{ id: 't2', prompt: 'lock accounts after five failures', edited: ['server/auth.js'], read: [] },
	],
	commits: [{ hash: 'abc1234def', short: 'abc1234', subject: 'count failed logins' }],
	files: ['README.md', 'server/auth.js', 'server/auth.test.js'],
	paths: ['README.md', 'server/auth.js', 'server/auth.test.js'],
	screen: 'Claude: done, see server/auth.test.js',
};
const lineOf = async (path, name) => (path === 'server/auth.js' && name === 'lockout' ? 40 : null);
const reply = open => JSON.stringify({ said: 'Found it.', open });

test('what to open is asked with the work in view: what is open, what changed, the turns, commits and screen', () => {
	const prompt = openPrompt('the test for this', surface);

	expect(prompt).toContain('"the test for this"');
	expect(prompt).toContain('Open now: server/auth.js');
	expect(prompt).toContain('server/auth.js (modified)');
	expect(prompt).toContain('Turn 2: lock accounts after five failures\n  changed server/auth.js');
	expect(prompt).toContain('abc1234 count failed logins');
	expect(prompt).toContain('see server/auth.test.js');
});

test('each pick opens only what is there: a file (at a symbol it defines), a change, a commit, a turn that edited', async () => {
	const found = await parseOpenings(
		reply([
			{ file: 'server/auth.test.js' },
			{ file: 'server/auth.js', symbol: 'lockout' },
			{ file: 'server/auth.js', symbol: 'nowhere' },
			{ change: 'server/auth.js' },
			{ commit: 'abc1234' },
			{ turn: 2 },
		]),
		surface,
		lineOf,
	);

	expect(found.said).toBe('Found it.');
	expect(found.dropped).toBe(0);
	expect(found.opened).toEqual([
		{ file: 'server/auth.test.js', title: 'server/auth.test.js' },
		{ file: 'server/auth.js', line: 40, title: 'lockout in server/auth.js' },
		{ file: 'server/auth.js', title: 'server/auth.js' },
		{ diff: { source: 'changes', path: 'server/auth.js' }, title: 'Changes to server/auth.js' },
		{ diff: { source: 'commit', ref: 'abc1234def' }, title: 'abc1234 count failed logins' },
		{ diff: { source: 'turn', turn: 't2' }, title: 'Turn: lock accounts after five failures' },
	]);
});

test('picks of what is not there are dropped and counted, the same pick opens once, and at most six are read', async () => {
	const found = await parseOpenings(
		reply([
			{ file: 'missing.js' },
			{ change: 'README.md' },
			{ commit: 'fff0000' },
			{ commit: 'ab' },
			{ turn: 1 },
			{ file: 'README.md' },
			{ file: 'README.md' },
		]),
		surface,
		lineOf,
	);

	expect(found.opened).toEqual([{ file: 'README.md', title: 'README.md' }]);
	expect(found.dropped).toBe(5);
	expect((await parseOpenings(reply([{ turn: 2 }, { turn: 2 }]), surface, lineOf)).opened).toEqual([
		{ diff: { source: 'turn', turn: 't2' }, title: 'Turn: lock accounts after five failures' },
	]);
});

test('a reply without a list to open is no answer', async () => {
	expect(await parseOpenings('I could not tell.', surface, lineOf)).toBeNull();
	expect(await parseOpenings('{"said": "hm"}', surface, lineOf)).toBeNull();
});

test("a big project's paths are cut to the work and the words asked first", () => {
	const files = Array.from({ length: 3000 }, (_, index) => `src/file${index}.js`).concat(['src/login/form.js']);
	const paths = pathsFor(files, 'the login form', ['src/file2999.js']);

	expect(paths).toHaveLength(1500);
	expect(paths.slice(0, 2)).toEqual(['src/file2999.js', 'src/login/form.js']);
	expect(pathsFor(['a.js'], 'anything', [])).toEqual(['a.js']);
});
