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

test('converts other formats through ImageMagick', async () => {
	const svg = new TextEncoder().encode(
		'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>',
	);

	expect(pngSize(await toPng(svg))).toEqual({ width: 40, height: 20 });
});

test('sends a large image in chunks the protocol accepts', async () => {
	const out = transmit(new Uint8Array(10_000).fill(7));
	const chunks = out.split('\x1b\\').filter(Boolean);

	expect(chunks.length).toBeGreaterThan(1);
	expect(chunks[0]).toStartWith('\x1b_Ga=t,f=100,');
	expect(chunks.at(-1)).toContain('m=0');
	for (const chunk of chunks) expect(chunk.split(';').at(-1).length).toBeLessThanOrEqual(4096);
});
