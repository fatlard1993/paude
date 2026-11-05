import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test } from 'bun:test';

import { initSessionModels, modelOf, setModel } from './sessionModels';

test("a session's model is kept to resume it on, the default and anything unknown kept as none, across a restart", async () => {
	const data = await mkdtemp(path.join(os.tmpdir(), 'paude-models-'));

	await initSessionModels(data);
	await setModel('a', 'opus');
	await setModel('b', 'gpt-9');
	await setModel('c', 'haiku');
	await setModel('c', 'default');
	expect([modelOf('a'), modelOf('b'), modelOf('c')]).toEqual(['opus', undefined, undefined]);

	await initSessionModels(data);
	expect(modelOf('a')).toBe('opus');
});
