// A folder's color, as the dotfiles' kitty-bg tints a terminal started in it (and claude-statusline its accent): one of
// 24 hues, 15° apart, chosen by the path's POSIX cksum. The same session reads the same in paude as in that terminal.
const HUES = 24;

const TABLE = Array.from({ length: 256 }, (_, index) => {
	let crc = index << 24;

	for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;

	return crc >>> 0;
});

// What `cksum` prints first for these bytes: a CRC-32 taken most significant bit first, over the bytes then their length
export const cksum = text => {
	const bytes = new TextEncoder().encode(text);
	let crc = 0;
	const add = byte => {
		crc = ((crc << 8) ^ TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
	};

	bytes.forEach(add);
	for (let length = bytes.length; length > 0; length = Math.floor(length / 256)) add(length & 0xff);

	return ~crc >>> 0;
};

// The hue in degrees, or null for the home folder, which kitty-bg leaves untinted
export const folderHue = (folder, home) => (folder && folder !== home ? (cksum(folder) % HUES) * (360 / HUES) : null);

const hex = (hue, saturation, lightness) => {
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const [r, g, b] = [
		[chroma, x, 0],
		[x, chroma, 0],
		[0, chroma, x],
		[0, x, chroma],
		[x, 0, chroma],
		[chroma, 0, x],
	][Math.floor(hue / 60) % 6];
	const m = lightness - chroma / 2;

	return `#${[r, g, b].map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`;
};

// kitty-bg's three: a dark tinted background, a faintly tinted foreground, and a bright accent (its cursor); none for
// a folder without a hue
export const folderTints = hue =>
	hue === null || hue === undefined
		? null
		: { background: hex(hue, 0.12, 0.07), foreground: hex(hue, 0.08, 0.88), accent: hex(hue, 0.8, 0.6) };
