import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { brandOf, iconColor, iconOf } from './brand';

const folderWith = async files => {
	const folder = await mkdtemp(join(tmpdir(), 'brand-'));

	for (const [rel, text] of Object.entries(files)) {
		await mkdir(dirname(join(folder, rel)), { recursive: true });
		await writeFile(join(folder, rel), text);
	}

	return folder;
};
const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

test("an icon's color is the chromatic one it paints with most, the first of those used alike; whites, blacks and greys are its field, not its mark", () => {
	expect(iconColor(svg('<rect fill="#b23434"/><path fill="none" stroke="#f2f2f2"/>'))).toBe('#b23434');
	expect(iconColor(svg('<path fill="#0b4d47"/><path fill="#1ba08f"/><circle fill="#c8f7ef"/>'))).toBe('#0b4d47');
	expect(
		iconColor(svg('<g style="fill:#f28c28"/><path fill="#f28c28"/><path fill="#F28C28"/><rect fill="#3475b2"/>')),
	).toBe('#f28c28');
	// Outlined all round in a dark color, oftener than anything is filled: the fills are still what it's the color of,
	// and of those the sand, the cream round it being a white however warm
	expect(
		iconColor(
			svg(
				'<rect fill="#fdf3d6" stroke="#2b2140"/><path fill="#e0a030"/><rect fill="#fdf3d6" stroke="#2b2140"/>' +
					'<rect fill="#e0a030" stroke="#2b2140"/>',
			),
		),
	).toBe('#e0a030');
	// Drawn in line alone, its line's color is its color
	expect(iconColor(svg('<path fill="none" stroke="#7a3fd0"/><path fill="none" stroke="#7a3fd0"/>'))).toBe('#7a3fd0');
	expect(iconColor(svg('<path fill="#FFFFFF"/>'))).toBeNull();
	expect(iconColor(svg('<path fill="none"/>'))).toBeNull();
	expect(iconColor(svg('<rect fill="#333333"/>'))).toBeNull();
});

test("a project's brand: its icon where it keeps one, and the hue the icon is painted in, else a theme color of its own, a white or a black as much as a hue, never a stock button color", async () => {
	const red = await folderWith({
		'client/favicon.svg': svg('<rect fill="#b23434"/>'),
		'client/manifest.json': JSON.stringify({ theme_color: '#3475b2' }),
	});

	expect(await brandOf(red)).toEqual({
		icon: { path: join(red, 'client/favicon.svg'), type: 'image/svg+xml' },
		hue: 0,
		tone: null,
	});

	const stock = await folderWith({
		'client/favicon.svg': svg('<path fill="#ffffff"/>'),
		'client/manifest.json': JSON.stringify({ theme_color: '#3475b2' }),
	});

	expect(await brandOf(stock)).toMatchObject({ hue: null, tone: null });

	const themed = await folderWith({ 'manifest.webmanifest': JSON.stringify({ theme_color: '#7a34b2' }) });

	expect(await brandOf(themed)).toEqual({ icon: null, hue: 273, tone: null });

	// A theme color with no hue to speak of is the tone it is: a black-ish, or a white-ish, paper's warm tint and all
	const black = await folderWith({ 'client/manifest.json': JSON.stringify({ theme_color: '#1b1b1b' }) });

	expect(await brandOf(black)).toEqual({ icon: null, hue: null, tone: 'dark' });

	const paper = await folderWith({
		'client/favicon.svg': svg('<rect fill="#111"/><rect fill="#f4f1e8"/>'),
		'client/manifest.json': JSON.stringify({ theme_color: '#e6e0d0' }),
	});

	expect(await brandOf(paper)).toMatchObject({ hue: null, tone: 'light' });

	const ico = await folderWith({ 'public/favicon.ico': 'not really' });

	expect(await brandOf(ico)).toEqual({
		icon: { path: join(ico, 'public/favicon.ico'), type: 'image/x-icon' },
		hue: null,
		tone: null,
	});
	expect(await iconOf(await folderWith({}))).toBeNull();
});
