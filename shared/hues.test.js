import { expect, test } from 'bun:test';

import { cksum, folderHue, sessionHue, tintsOf, hueOfColor, huesApart } from './hues';

test('checksums a path as cksum does', () => {
	expect(cksum('/home/chase/Projects/paude')).toBe(4246214386);
	expect(cksum('/home/chase/Projects/minecraft/pandorical')).toBe(3785103582);
	expect(cksum('')).toBe(4294967295);
	// Past 255 bytes the length takes more than one byte
	expect(cksum('x'.repeat(300))).toBe(
		Number(
			Bun.spawnSync(['cksum'], { stdin: Buffer.from('x'.repeat(300)) })
				.stdout.toString()
				.split(' ')[0],
		),
	);
});

test("picks kitty-bg's hue for a folder, and none for home", () => {
	expect(folderHue('/home/chase/Projects/paude', '/home/chase')).toBe((4246214386 % 24) * 15);
	expect(folderHue('/home/chase', '/home/chase')).toBeNull();
	expect(folderHue(undefined, '/home/chase')).toBeNull();
});

test("gives each session its own hue, not its folder's", () => {
	const [one, other] = ['2861c3a3-3552-4759-9c9a-28990d1fddfa', '79057fc1-aa66-4012-8a5e-7c2f1d3c9e01'];

	expect(sessionHue(one)).toBe((cksum(one) % 24) * 15);
	expect(sessionHue(one)).not.toBe(sessionHue(other));
	expect(sessionHue(undefined)).toBeNull();
});

test('reads a CSS color into hue, saturation and lightness, and nothing else', () => {
	expect(hueOfColor('#b23434')).toMatchObject({ hue: 0 });
	expect(Math.round(hueOfColor('#7a34b2').hue)).toBe(273);
	expect(Math.round(hueOfColor('rgb(52, 117, 178)').hue)).toBe(209);
	expect(hueOfColor('#fff')).toEqual({ hue: 0, saturation: 0, lightness: 1 });
	expect(hueOfColor('#33333380').saturation).toBe(0);
	expect(hueOfColor('blue')).toBeNull();
	expect(hueOfColor(null)).toBeNull();
});

test('names settled apart on a wheel of any size: a brand keeps its hue and the rest step round it', () => {
	const ships = huesApart(
		[
			{ name: 'dock', hue: 100 },
			{ name: 'vps', hue: 110 },
			{ name: 'laptop', hue: 120 },
		],
		{ slots: 8 },
	);

	expect(ships.get('dock')).toBe(100);
	expect(ships.get('laptop')).toBe(165);
	expect(ships.get('vps')).toBe(20);
	expect(
		huesApart([
			{ name: 'a', hue: 7, branded: true },
			{ name: 'b', hue: 10 },
		]).get('b'),
	).toBe(25);
});

test("tints as kitty-bg's awk does", () => {
	// What kitty-bg's _hsl prints for index 0's cursor and index 8's three
	expect(tintsOf(0).accent).toBe('#eb4747');
	expect(tintsOf(120)).toEqual({ background: '#101410', foreground: '#dee3de', accent: '#47eb47' });
	expect(tintsOf(null)).toBeNull();
});
