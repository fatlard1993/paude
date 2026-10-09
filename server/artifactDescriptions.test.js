import { mkdtemp, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test } from 'bun:test';

import { describeArtifactsPrompt } from './artifactDescriptions';

test('each artifact numbered with what was asked and said, and how a text file begins', async () => {
	const folder = await mkdtemp(path.join(os.tmpdir(), 'paude-artifact-'));
	const script = path.join(folder, 'shot.js');

	await writeFile(script, "// Screenshot the home page\nimport puppeteer from 'puppeteer-core';\n");

	const prompt = await describeArtifactsPrompt([
		{ path: script, shown: 'scratchpad/shot.js', kind: 'script', turn: 'show me home', why: 'Drive the page' },
		{ path: path.join(folder, 'home.png'), shown: 'scratchpad/home.png', kind: 'image', turn: 'show me home' },
	]);

	expect(prompt).toContain(
		"1. scratchpad/shot.js (script)\n   Asked at the time: show me home\n   Said as it was made: Drive the page\n   It begins:\n      // Screenshot the home page\n      import puppeteer from 'puppeteer-core';",
	);
	expect(prompt).toContain('2. scratchpad/home.png (image)\n   Asked at the time: show me home');
	expect(prompt).not.toContain('2. scratchpad/home.png (image)\n   Asked at the time: show me home\n   It begins');
});
