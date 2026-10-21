import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test } from 'bun:test';

import { initArchive, isArchived, setArchived } from './archive';

test('an archived session stays archived across a restart, until it is taken out', async () => {
	const data = await mkdtemp(path.join(os.tmpdir(), 'paude-archive-'));

	await initArchive(data);
	await setArchived(['a', 'b'], true);
	await initArchive(data);
	expect([isArchived('a'), isArchived('b'), isArchived('c')]).toEqual([true, true, false]);

	await setArchived(['a'], false);
	await initArchive(data);
	expect([isArchived('a'), isArchived('b')]).toEqual([false, true]);
});
