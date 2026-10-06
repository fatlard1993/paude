import { expect, test } from 'bun:test';

import parseTitle from './claudeTitle';

// Recorded from Claude Code 2.1.291 in a PTY, idle, then working on a turn, then done
const RECORDED = [
	'✳ Claude Code',
	'◐ Claude Code',
	'◐ Sleep and echo test',
	'◑ Sleep and echo test',
	'✳ Sleep and echo test',
];

test("Claude Code's titles say whether it's working, and what the session is called", () => {
	expect(RECORDED.map(parseTitle)).toEqual([
		{ busy: false, title: 'Claude Code' },
		{ busy: true, title: 'Claude Code' },
		{ busy: true, title: 'Sleep and echo test' },
		{ busy: true, title: 'Sleep and echo test' },
		{ busy: false, title: 'Sleep and echo test' },
	]);
	expect(parseTitle('a plain title')).toEqual({ busy: false, title: 'a plain title' });
});
