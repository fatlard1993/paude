// Colors told apart at a glance, as the dotfiles' kitty-bg tints a terminal (and claude-statusline its accent): one of
// 24 hues, 15° apart, chosen by a name's POSIX cksum. A session's comes from its id, so each has its own; a project's
// from its folder, matching kitty-bg's tint for a terminal opened there.
export const HUES = 24;

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

const hueOf = name => (cksum(name) % HUES) * (360 / HUES);

// A folder's hue in degrees, or null for the home folder, which kitty-bg leaves untinted
export const folderHue = (folder, home) => (folder && folder !== home ? hueOf(folder) : null);

export const sessionHue = id => (id ? hueOf(id) : null);

const channelsOf = text => {
	const hex = text.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];

	if (hex) {
		if (hex.length < 6) return [...hex.slice(0, 3)].map(digit => parseInt(digit + digit, 16));

		return [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16));
	}

	const rgb = text.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);

	return rgb ? rgb.slice(1, 4).map(Number) : null;
};

const sectorOf = (r, g, b, max, chroma) => {
	if (max === r) return ((g - b) / chroma + 6) % 6;
	if (max === g) return (b - r) / chroma + 2;

	return (r - g) / chroma + 4;
};

// A CSS color read as { hue (degrees), saturation, lightness (0 to 1) }: a hex color (#rgb, #rrggbb, with alpha or
// not) or rgb(); null for anything else
export const hueOfColor = color => {
	const channels = channelsOf(String(color ?? '').trim());

	if (!channels) return null;

	const [r, g, b] = channels.map(channel => Math.min(255, channel) / 255);
	const max = Math.max(r, g, b);
	const chroma = max - Math.min(r, g, b);
	const lightness = (max + min(r, g, b)) / 2;

	return {
		hue: chroma === 0 ? 0 : sectorOf(r, g, b, max, chroma) * 60,
		saturation: chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1)),
		lightness,
	};
};
const min = Math.min;

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

	return `#${[r, g, b]
		.map(channel =>
			Math.round((channel + m) * 255)
				.toString(16)
				.padStart(2, '0'),
		)
		.join('')}`;
};

// kitty-bg's three: a dark tinted background, a faintly tinted foreground, and a bright accent (its cursor); none for
// a folder without a hue
export const tintsOf = hue =>
	hue === null || hue === undefined
		? null
		: { background: hex(hue, 0.12, 0.07), foreground: hex(hue, 0.08, 0.88), accent: hex(hue, 0.8, 0.6) };
