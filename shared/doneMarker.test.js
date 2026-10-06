import { expect, test } from 'bun:test';

import DONE_MARKER from './doneMarker';

test("matches Claude's done lines in either clock, with or without a day", () => {
	for (const line of [
		'✻ Cooked for 2s · done 2:48 PM',
		'✻ Worked for 1m 9s · done 11:02 AM',
		'  Churned for 1s · done 14:05',
		'✻ Cooked for 3s · done Mon 2:48 PM',
		'✻ Cooked for 1h 2m · done Oct 3, 14:05',
		'✻ Churned for 3s · done 10:48 AM · 1 shell still running',
	])
		expect(DONE_MARKER.test(line)).toBe(true);

	for (const line of ['✻ Cooked for 2s · 3 tasks', 'done 2:48 PM', 'Cooked for 2s'])
		expect(DONE_MARKER.test(line)).toBe(false);
});
