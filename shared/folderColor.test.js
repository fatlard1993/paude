import { expect, test } from 'bun:test';

import { cksum, folderHue, folderTints } from './folderColor';

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

test("tints as kitty-bg's awk does", () => {
	// What kitty-bg's _hsl prints for index 0's cursor and index 8's three
	expect(folderTints(0).accent).toBe('#eb4747');
	expect(folderTints(120)).toEqual({ background: '#101410', foreground: '#dee3de', accent: '#47eb47' });
	expect(folderTints(null)).toBeNull();
});
