import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test } from 'bun:test';

import { zipStream } from './zip';

const entries = async function* entries() {
	yield {
		name: 'index.html',
		modified: new Date(2026, 9, 7, 12, 30),
		bytes: async () => new TextEncoder().encode('<h1>hi</h1>'),
	};
	yield {
		name: 'assets/app.js',
		modified: new Date(2026, 9, 7),
		bytes: async () => new TextEncoder().encode('console.log(1)'),
	};
};

test('makes a zip other tools read back', async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'paude-zip-'));
	const file = path.join(dir, 'out.zip');

	// Read whole first: Bun.write never finishes a file written straight from a stream
	await Bun.write(file, await new Response(zipStream(entries())).arrayBuffer());

	const check = Bun.spawnSync([
		'python3',
		'-c',
		'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(sorted(z.namelist())); print(z.read("assets/app.js").decode())',
		file,
	]);

	expect(check.stdout.toString().trim()).toBe("['assets/app.js', 'index.html']\nconsole.log(1)");
	await rm(dir, { recursive: true, force: true });
});
