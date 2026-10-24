import { expect, test } from 'bun:test';

import { draftCommand, draftPrompt } from './pullRequests';

const commits = [{ subject: 'add formatDistance' }];

test("a draft follows the change's walk-through and says only what was seen of its testing", () => {
	const prompt = draftPrompt({
		commits,
		stat: ' src/format.js | 2 ++',
		tour: {
			overview: 'It adds a distance formatter.',
			stops: [
				{ path: 'src/units.js', side: 'new', from: 1, to: 3, text: 'Miles from kilometres.' },
				{ path: 'src/format.js', side: 'old', from: 7, to: 7, text: 'The old rounding goes.' },
			],
		},
		tested: 'Tests passed after the last change (bun test, 2m ago).',
	});

	expect(prompt).toContain('"How to review it"');
	expect(prompt).toContain('- src/units.js lines 1-3: Miles from kilometres.');
	expect(prompt).toContain('- src/format.js line 7 (removed): The old rounding goes.');
	expect(prompt).toContain('Testing, as seen in the session that made it: Tests passed after the last change');
});

test('without a walk-through or a test result, a draft is from the commits alone', () => {
	const prompt = draftPrompt({ commits, stat: ' a | 1 +' });

	expect(prompt).not.toContain('How to review it');
	expect(prompt).not.toContain('Testing');
	expect(prompt).toContain('- add formatDistance');
});

test('a draft reads the commits oldest first with their messages, for the decisions they record', () => {
	const prompt = draftPrompt({
		commits: [
			{ subject: 'lock after five tries', body: 'Per user, not per session:\nsessions reset.' },
			{ subject: 'count failed logins', body: '' },
		],
		stat: ' auth.js | 9 +',
	});

	expect(prompt).toContain(
		'- count failed logins\n- lock after five tries\n  Per user, not per session:\n  sessions reset.',
	);
	expect(prompt).toContain('"Decisions"');
});

test('past what fits, the latest commits are named by subject alone', () => {
	const long = 'why '.repeat(3000);
	const prompt = draftPrompt({
		commits: ['third', 'second', 'first'].map(subject => ({ subject, body: long })),
		stat: ' a | 1 +',
	});

	expect(prompt).toContain(`- first\n  ${long.trim()}`);
	expect(prompt).toContain('- third\n');
	expect(prompt.split(long.trim()).length - 1).toBe(1);
});

test('the drafting Claude runs with no tools, no settings and nothing saved', () => {
	const argv = draftCommand();
	const after = flag => argv[argv.indexOf(flag) + 1];

	expect(argv).toContain('-p');
	expect(argv).toContain('--no-session-persistence');
	expect(after('--tools')).toBe('');
	expect(after('--setting-sources')).toBe('');
});
