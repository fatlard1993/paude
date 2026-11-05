import { mkdtemp } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { allFiles, droppedPaths, pastedPaths } from './droppedFiles';

test('a drop reads the way each terminal sends it: a URI, a quoted or escaped path, pasted or typed', () => {
	expect(droppedPaths('file:///home/me/My%20Shot.png')).toEqual(['/home/me/My Shot.png']);
	expect(droppedPaths("\x1b[200~'/home/me/My Shot.png' \x1b[201~")).toEqual(['/home/me/My Shot.png']);
	expect(droppedPaths('/home/me/My\\ Shot.png')).toEqual(['/home/me/My Shot.png']);
	expect(droppedPaths('"/tmp/it\'s.png"')).toEqual(["/tmp/it's.png"]);
});

test('several files dropped at once are each a path', () => {
	expect(droppedPaths('file:///a.png\r\nfile:///b.jpg\r\n')).toEqual(['/a.png', '/b.jpg']);
	expect(droppedPaths("'/a.png' '/b c.jpg' ")).toEqual(['/a.png', '/b c.jpg']);
});

test('typing and pasted text are not drops', () => {
	for (const input of [
		'a',
		'\r',
		'\x1b[A',
		'look at /a.png',
		'relative/a.png',
		"'/a.png",
		'',
		'   ',
		'https://x/a.png',
	])
		expect(droppedPaths(input)).toBeNull();
});

test('paths go back as one paste, in forms Claude attaches an image from', () => {
	expect(pastedPaths(['/a.png', '/b c.png'])).toBe('\x1b[200~/a.png /b\\ c.png\x1b[201~');
});

test('only files that are there count', async () => {
	const folder = await mkdtemp(join(os.tmpdir(), 'paude-drop-'));
	const image = join(folder, 'a.png');

	await Bun.write(image, 'png');
	expect(await allFiles([image])).toBe(true);
	expect(await allFiles([image, join(folder, 'gone.png')])).toBe(false);
	expect(await allFiles([folder])).toBe(false);
});
