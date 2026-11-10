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

// A CSS color read as { hue (degrees), saturation, lightness, chroma (0 to 1; how far its channels stand apart) }: a hex color (#rgb, #rrggbb, with alpha or
// not) or rgb(); null for anything else
export const hueOfColor = color => {
	const channels = channelsOf(String(color ?? '').trim());

	if (!channels) return null;

	const [r, g, b] = channels.map(channel => Math.min(255, channel) / 255);
	const max = Math.max(r, g, b);
	const chroma = max - Math.min(r, g, b);
	const lightness = (max + min(r, g, b)) / 2;

	return {
		chroma,
		hue: chroma === 0 ? 0 : sectorOf(r, g, b, max, chroma) * 60,
		saturation: chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1)),
		lightness,
	};
};
const min = Math.min;

// A color that's no hue: a white-ish or a black-ish, which a brand may be. Wherever a hue goes, one of these may
export const TONES = ['light', 'dark'];

export const isTone = hue => TONES.includes(hue);

// Whether this is a color at all: a hue in degrees, or a tone
export const isHue = hue => Number.isFinite(hue) || isTone(hue);

// What's painted for a hue at a saturation and lightness (percent), as [hue, saturation, lightness]: a hue as asked;
// a tone as nearly no color, a light one lifted most of the way to white (faintly warm), a dark one dropped toward
// black (faintly cool) but not so far it's lost on a dark page
export const toned = (hue, saturation, lightness) => {
	if (hue === 'light') return [40, Math.round(saturation * 0.12), Math.round(lightness + (100 - lightness) * 0.6)];
	if (hue === 'dark') return [220, Math.round(saturation * 0.15), Math.max(Math.round(lightness * 0.4), 14)];

	return [hue, saturation, lightness];
};

// The CSS color of a hue (or a tone) at a saturation and lightness, in percent
export const hsl = (hue, saturation, lightness, alpha) => {
	const [h, s, l] = toned(hue, saturation, lightness);

	return alpha === undefined ? `hsl(${h} ${s}% ${l}%)` : `hsla(${h} ${s}% ${l}% / ${alpha})`;
};

// Each named thing's color (a project, a ship), by name: its brand's hue where it has one (`branded`), kept as it is; else its folder's hue,
// kitty-bg's for a terminal opened there, or when a project before it has that one (a brand, or one before it by
// name), the nearest free hue of kitty-bg's wheel (a step up, a step down, two up...), so up to a wheel's worth of
// projects all read apart and each stays as near its terminal's tint as it can. Worked out over every project there
// is, at work or not: a project's color is the same whichever are at work, however they came, and wherever it's
// looked at from. [{ name, hue, branded }] (any order, a name maybe more than once) to Map(name → hue); `slots` how many hues the wheel
// has, 15 degrees apart by default
export const huesApart = (named, { slots = HUES } = {}) => {
	const own = new Map();

	for (const { name, hue: wheel, branded, tone } of named) {
		const had = own.get(name);
		// A brand that's a white or a black (`tone`) is that, whatever hue came beside it for a paude older than tones
		const hue = branded && isTone(tone) ? tone : wheel;
		const brand = Boolean(branded) && hue !== null && hue !== undefined;

		if (!had || had.hue === null || (brand && !had.branded)) own.set(name, { hue: hue ?? null, branded: brand });
	}

	const step = 360 / slots;
	const turns = Array.from({ length: slots }, (_, turn) => (turn % 2 ? turn + 1 : -turn) / 2);
	const hues = new Map();
	const taken = [];
	const free = hue => taken.every(other => Math.abs(((hue - other + 540) % 360) - 180) >= step);
	const names = [...own.keys()].sort((a, b) => a.localeCompare(b));
	// A brand's hue is its own and goes first; the rest step round the brands and each other
	const inTurn = [...names.filter(name => own.get(name).branded), ...names.filter(name => !own.get(name).branded)];

	for (const name of inTurn) {
		const { hue, branded } = own.get(name);

		if (hue === null) {
			hues.set(name, null);
			continue;
		}

		const found = branded ? hue : (turns.map(turn => (hue + turn * step + 360) % 360).find(free) ?? hue);

		hues.set(name, found);
		// A white or a black is on no wheel, and in nothing's way
		if (!isTone(found)) taken.push(found);
	}

	return hues;
};

const hex = (hue, saturation, lightness) => {
	if (isTone(hue)) {
		const [h, s, l] = toned(hue, saturation * 100, lightness * 100);

		return hex(h, s / 100, l / 100);
	}

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
