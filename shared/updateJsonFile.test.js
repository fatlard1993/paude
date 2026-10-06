import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test } from 'bun:test';

test('updates from separate processes all land', async () => {
	const file = path.join(await mkdtemp(path.join(os.tmpdir(), 'paude-update-')), 'counts.json');
	const worker = `
		import updateJsonFile from '${path.join(import.meta.dir, 'updateJsonFile.js')}';
		for (let i = 0; i < 20; i++) await updateJsonFile('${file}', { count: 0 }, data => ({ count: data.count + 1 }));
	`;
	const runs = Array.from({ length: 4 }, () =>
		Bun.spawn(['bun', '-e', worker], { stdout: 'ignore', stderr: 'inherit' }),
	);

	await Promise.all(runs.map(run => run.exited));
	expect((await Bun.file(file).json()).count).toBe(80);
});
