import { expect, test } from 'bun:test';

import { composeFrame, createMirror } from './compositor';

const ESCAPES = new RegExp(`${'\x1b'}\\[[\\d;?]*[A-Za-z]`, 'g');

const mirrorOf = async (text, cols, rows) => {
	const mirror = createMirror();

	mirror.resize(cols, rows);
	await new Promise(resolve => mirror.write(text, resolve));

	return mirror;
};

test('Claude stays visible and dimmed around the box, keeping its own colors', async () => {
	const mirror = await mirrorOf('hello \x1b[1;31mred\x1b[0m', 20, 3);
	const frame = composeFrame({ mirror, cols: 20, rows: 3, box: { x: 15, y: 1, width: 5, lines: ['BOXXX'] } });

	expect(frame).toContain('\x1b[0;2;39;49mhello ');
	expect(frame).toContain('\x1b[0;1;2;31;49mred');
	expect(frame).toContain('\x1b[2;1H');
	expect(frame).toContain('BOXXX');
});

test('a wide character cut by the box edge becomes a space', async () => {
	const mirror = await mirrorOf('ab界cd', 10, 1);
	const frame = composeFrame({ mirror, cols: 10, rows: 1, box: { x: 3, y: 0, width: 2, lines: ['XX'] } });

	// 界 spans columns 2 and 3; the box covers 3 and 4
	expect(frame.replace(ESCAPES, '')).toBe('ab XXd    ');
});
