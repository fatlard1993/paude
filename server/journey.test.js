import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test } from 'bun:test';

import { initJourney, journeyOf, noteDelivered } from './journey';

test('how far the work has come: each delivery weighed, kept on disk, and the last hour for how fast', async () => {
	const data = await mkdtemp(path.join(os.tmpdir(), 'paude-journey-'));
	const now = Date.now();

	await initJourney(data);
	await noteDelivered('replies', 3, now - 2 * 3_600_000);
	await noteDelivered('commits', 2, now);
	await noteDelivered('artifacts', 1, now);
	await noteDelivered('artifacts', -4, now);

	// 3 replies + 2 commits at five + 1 artifact at two; the replies came over an hour ago
	expect(journeyOf(now)).toEqual({ replies: 3, commits: 2, artifacts: 1, distance: 15, lately: 12 });

	await initJourney(data);
	expect(journeyOf(now).distance).toBe(15);
});
