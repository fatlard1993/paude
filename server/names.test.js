import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test } from 'bun:test';

import { initNames, pinName, pinnedName } from './names';

test('a pinned name persists until it is cleared', async () => {
	const dataDir = await mkdtemp(path.join(os.tmpdir(), 'paude-names-'));

	await initNames(dataDir);
	await pinName('a', '  Release prep  ');
	await initNames(dataDir);
	expect(pinnedName('a')).toBe('Release prep');

	await pinName('a', '');
	await initNames(dataDir);
	expect(pinnedName('a')).toBeUndefined();
});
