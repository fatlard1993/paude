import { readFile, stat } from 'fs/promises';
import os from 'os';
import { join } from 'path';

import { folderHue, hueOfColor } from '../shared/hues';
import { projectPath } from './projects';

// Where a project keeps its icon, likeliest first; the first found is its icon
const ICONS = [
	'client/favicon.svg',
	'favicon.svg',
	'public/favicon.svg',
	'static/favicon.svg',
	'src/favicon.svg',
	'client/favicon.ico',
	'favicon.ico',
	'public/favicon.ico',
	'static/favicon.ico',
	'client/icon-192.png',
	'public/icon-192.png',
	'client/icon.png',
	'public/icon.png',
	'icon.png',
	'logo.svg',
	'logo.png',
	'img/logo.png',
];
const TYPES = { svg: 'image/svg+xml', ico: 'image/x-icon', png: 'image/png' };
const MANIFESTS = [
	'client/manifest.json',
	'client/manifest.webmanifest',
	'manifest.json',
	'manifest.webmanifest',
	'public/manifest.json',
	'public/manifest.webmanifest',
];
// Theme colors that are a component library's button color, not a project's brand: vanilla-bean's blue
const STOCK = new Set(['#3475b2']);
// Below this saturation a color is a grey, which says nothing of a brand
const CHROMATIC = 0.2;
const BRAND_MS = 10 * 60_000;

// The project's icon as { path, type }, or null
export const iconOf = async folder => {
	for (const rel of ICONS) {
		const path = join(folder, rel);

		if ((await stat(path).catch(() => null))?.isFile()) return { path, type: TYPES[rel.split('.').pop()] };
	}

	return null;
};

const chromatic = color => {
	const read = hueOfColor(color);

	return read && read.saturation >= CHROMATIC && read.lightness > 0.08 && read.lightness < 0.92;
};

// The hex colors an SVG paints with, in order and as often as each is used, each as what it paints: a shape's fill
// (a gradient's stop is one) or its outline (`stroke`), as attributes or in styles
const paints = markup =>
	[...markup.matchAll(/(fill|stroke|stop-color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8})\b/gi)].map(([, what, color]) => ({
		color: color.toLowerCase(),
		outline: what.toLowerCase() === 'stroke',
	}));

// The chromatic color used most among `colors`, the first of those used alike; null for none
const mostUsed = colors => {
	const counts = new Map();

	for (const color of colors) if (chromatic(color)) counts.set(color, (counts.get(color) ?? 0) + 1);

	let best = null;

	for (const [color, count] of counts) if (!best || count > best.count) best = { color, count };

	return best?.color ?? null;
};

// The color an icon is mostly painted in: of the chromatic colors its shapes are filled with, the one used most, the
// first of those used alike; whites, blacks and greys are the field a mark stands on, not the mark. What it's
// outlined in counts only for an icon that fills nothing in a color: one dark line round every shape is used oftener
// than any fill and isn't what the icon is the color of. Null for an icon with none.
export const iconColor = markup => {
	const found = paints(markup);

	return (
		mostUsed(found.filter(({ outline }) => !outline).map(({ color }) => color)) ??
		mostUsed(found.filter(({ outline }) => outline).map(({ color }) => color))
	);
};

const themeColor = async folder => {
	for (const rel of MANIFESTS) {
		const text = await readFile(join(folder, rel), 'utf8').catch(() => null);

		if (text === null) continue;
		try {
			const color = JSON.parse(text).theme_color;

			return typeof color === 'string' ? color.trim().toLowerCase() : null;
		} catch {
			return null;
		}
	}

	return null;
};

const readBrand = async folder => {
	const icon = await iconOf(folder);
	const painted = icon?.type === TYPES.svg ? iconColor(await readFile(icon.path, 'utf8').catch(() => '')) : null;
	const theme = painted ? null : await themeColor(folder);
	const color = painted ?? (theme && !STOCK.has(theme) && chromatic(theme) ? theme : null);

	return { icon, hue: color ? Math.round(hueOfColor(color).hue) % 360 : null };
};

const memo = new Map();

// A project's brand, from its folder: its icon ({ path, type }, or null), and the hue it's painted in, in degrees (or
// null). The icon's own color comes first; a theme color only when the icon has none, and never a stock one (a
// component library's button color, which says nothing of the project) nor a grey. Read again once in a while.
export const brandOf = async folder => {
	const known = memo.get(folder);

	if (known && Date.now() - known.at < BRAND_MS) return known.value;

	const value = await readBrand(folder);

	memo.set(folder, { at: Date.now(), value });

	return value;
};

// What a project's listing says of its color and icon: its brand's hue in place of its folder's where it has one
// (`branded`), and where its icon is served, when it has one
export const brandFields = async name => {
	const folder = projectPath(name);
	const brand = folder ? await brandOf(folder) : { icon: null, hue: null };

	return {
		hue: brand.hue ?? folderHue(folder, os.homedir()),
		...(brand.hue !== null && { branded: true }),
		...(brand.icon && { icon: `/api/projects/${encodeURIComponent(name)}/icon` }),
	};
};
