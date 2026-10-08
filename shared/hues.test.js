import { expect, test } from 'bun:test';

import { cksum, folderHue, sessionHue, tintsOf } from './hues';

test('checksums a path as cksum does', () => {
	expect(cksum('/home/chase/Projects/paude')).toBe(4246214386);
	expect(cksum('/home/chase/Projects/minecraft/pandorical')).toBe(3785103582);
	expect(cksum('')).toBe(4294967295);
	// Past 255 bytes the length takes more than one byte
	expect(cksum('x'.repeat(300))).toBe(
		Number(Bun.spawnSync(['cksum'], { stdin: Buffer.from('x'.repeat(300)) }).stdout.toString().split(' ')[0]),
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

test("tints as kitty-bg's awk does", () => {
	// What kitty-bg's _hsl prints for index 0's cursor and index 8's three
	expect(tintsOf(0).accent).toBe('#eb4747');
	expect(tintsOf(120)).toEqual({ background: '#101410', foreground: '#dee3de', accent: '#47eb47' });
	expect(tintsOf(null)).toBeNull();
});
