import { expect, test } from 'bun:test';

import { isTestCommand, sayVerdict, testRunsOf, verdictOf } from './verification';

test('test commands are told from the rest', () => {
	for (const command of [
		'bun test',
		'npm run test:e2e',
		'cd web && pnpm test',
		'pytest -x',
		'go test ./...',
		'cargo test',
		'make check',
		'npx vitest run',
		'cd sub && npm test',
		'CI=1 pytest -x',
		'python -m pytest',
		'./gradlew test',
		'FOO=1 BAR=2 bunx jest --ci',
		'time pnpm exec vitest',
		'git pull; make test-unit',
		'(cd web\nyarn test)',
	])
		expect(isTestCommand(command)).toBe(true);
	expect(isTestCommand("cat > a.js <<'EOF'\nrun('bun test')\nEOF\nbun test a.test.js")).toBe(true);
	for (const command of [
		'bun run build',
		'git status',
		'cat test.txt',
		'ls tests/',
		'echo latest',
		"python3 - <<'EOF'\ns = 'bun test'\nEOF",
		'cat jest.config.js',
		'ls tox.ini',
		'grep -rn pytest .',
		'git log --grep vitest',
		'echo bun test',
		'vim pytest.ini',
	])
		expect(isTestCommand(command)).toBe(false);
});

test("test runs come from Claude's commands and the Tasks panel, a declined or stopped one aside", () => {
	const turns = [
		{
			steps: [
				{
					tool: 'Bash',
					command: "cd web && cat > a.js <<'EOF'\nx\nEOF\nbun test",
					summary: 'Run tests',
					ok: false,
					endedAt: '2026-10-15T10:00:00Z',
				},
				{
					tool: 'Bash',
					command: 'bun test a.test.js 2>&1 | grep -E "pass|fail"',
					ok: true,
					output: ' 3 pass\n 1 fail',
					endedAt: '2026-10-15T10:00:30Z',
				},
				{
					tool: 'Bash',
					command: 'bun test',
					summary: 'Run tests',
					ok: false,
					declined: true,
					endedAt: '2026-10-15T10:01:00Z',
				},
				{ tool: 'Bash', command: 'git status', ok: true, endedAt: '2026-10-15T10:02:00Z' },
			],
		},
	];
	const tasks = [
		{ name: 'test', command: 'bun run test', code: 0, endedAt: Date.parse('2026-10-15T10:05:00Z') },
		{ name: 'lint', command: 'bun run lint', code: 0, endedAt: Date.parse('2026-10-15T10:06:00Z') },
		{ name: 'test', command: 'bun run test', code: 1, stopped: true, endedAt: Date.parse('2026-10-15T10:07:00Z') },
	];

	expect(testRunsOf(turns, tasks)).toEqual([
		{ at: Date.parse('2026-10-15T10:00:00Z'), ok: false, what: 'bun test' },
		{ at: Date.parse('2026-10-15T10:00:30Z'), ok: false, what: 'bun test a.test.js 2>&1 | grep -E "pass|fail"' },
		{ at: Date.parse('2026-10-15T10:05:00Z'), ok: true, what: 'test' },
	]);
});

test('the verdict: tested since the last change, changed since, failing, or never tested', () => {
	const run = (at, ok) => ({ at, ok, what: 'bun test' });
	const file = (path, at) => ({ path, at });

	expect(verdictOf({ runs: [], edited: [] })).toBeNull();
	expect(verdictOf({ runs: [run(10, true)], edited: [file('a.js', 5)] })).toMatchObject({
		state: 'current',
		edited: [],
	});
	expect(
		verdictOf({ runs: [run(10, true)], edited: [file('a.js', 5), file('b.js', 12), file('c.js', 15)] }),
	).toMatchObject({
		state: 'stale',
		edited: ['c.js', 'b.js'],
	});
	expect(verdictOf({ runs: [run(10, true), run(20, false)], edited: [file('a.js', 15)] })).toMatchObject({
		state: 'failing',
		edited: ['a.js'],
	});
	expect(verdictOf({ runs: [], edited: [file('a.js', 5)] })).toEqual({ state: 'untested', edited: ['a.js'] });

	expect(sayVerdict({ state: 'stale', run: run(Date.now(), true), edited: ['c.js', 'b.js'] })).toBe(
		'2 files changed since the last passing test run (bun test, just now): c.js, b.js.',
	);
	expect(sayVerdict({ state: 'untested', edited: ['a.js'] })).toBe(
		'1 file changed, and no test has run in this session.',
	);
});

test('a run passes only when it exits clean and its counts show no failures or errors', () => {
	const step = (ok, output) => ({ tool: 'Bash', command: 'bun test', ok, output, endedAt: '2026-10-15T10:00:00Z' });
	const oks = turns => testRunsOf([{ steps: turns }]).map(run => run.ok);

	expect(oks([step(false, ' 3 pass\n 0 fail')])).toEqual([false]);
	expect(oks([step(true, ' 3 pass\n 0 fail\n 1 error')])).toEqual([false]);
	expect(oks([step(true, ' 3 pass\n 0 fail')])).toEqual([true]);
	expect(oks([step(true, 'no counts here')])).toEqual([true]);
	expect(
		testRunsOf(
			[],
			[{ name: 'test', command: 'bun test', code: 0, tests: { passed: 3, failed: 0, errors: 1 }, endedAt: 5 }],
		).map(run => run.ok),
	).toEqual([false]);
});
