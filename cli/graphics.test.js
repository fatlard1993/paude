import { expect, test } from 'bun:test';

import { fitCells, pngSize, toPng, transmit } from './graphics';

const png = async (width, height) => {
	const child = Bun.spawn(['magick', '-size', `${width}x${height}`, 'xc:orange', 'png:-'], { stdout: 'pipe' });

	return new Uint8Array(await new Response(child.stdout).arrayBuffer());
};

test('an image keeps its proportions inside the space, and a small one is not blown up', () => {
	expect(fitCells({ width: 900, height: 450 }, 80, 30)).toEqual({ cols: 80, rows: 20 });
	expect(fitCells({ width: 450, height: 900 }, 80, 30)).toEqual({ cols: 30, rows: 30 });
	expect(fitCells({ width: 18, height: 18 }, 80, 30)).toEqual({ cols: 2, rows: 1 });
});

test('reads the size from a PNG and passes PNGs through untouched', async () => {
	const image = await png(120, 60);

	expect(pngSize(image)).toEqual({ width: 120, height: 60 });
	expect(await toPng(image)).toBe(image);
});

test('converts the common bitmaps, and refuses anything that only claims to be one', async () => {
	const child = Bun.spawn(['magick', '-size', '30x10', 'xc:red', 'gif:-'], { stdout: 'pipe' });
	const gif = new Uint8Array(await new Response(child.stdout).arrayBuffer());

	expect(pngSize(await toPng(gif))).toEqual({ width: 30, height: 10 });

	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>';
	const mvg = 'push graphic-context\nviewbox 0 0 4 4\nimage over 0,0 0,0 "text:/etc/passwd"\npop graphic-context';
	const msl = '<?xml version="1.0"?><image><read filename="x"/><write filename="/tmp/paude-msl"/></image>';

	for (const text of [svg, mvg, msl]) expect(await toPng(new TextEncoder().encode(text))).toBeNull();
});

test('sends a large image in chunks the protocol accepts', async () => {
	const out = transmit(new Uint8Array(10_000).fill(7));
	const chunks = out.split('\x1b\\').filter(Boolean);

	expect(chunks.length).toBeGreaterThan(1);
	expect(chunks[0]).toStartWith('\x1b_Ga=t,f=100,');
	expect(chunks.at(-1)).toContain('m=0');
	for (const chunk of chunks) expect(chunk.split(';').at(-1).length).toBeLessThanOrEqual(4096);
});
