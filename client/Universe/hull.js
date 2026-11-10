import { PALETTE, plating } from './art';
import { tintsOf } from '../../shared/hues';
import {
	NACELLE,
	NOSE,
	RIM,
	airlockAt,
	clonerAt,
	padAt,
	panelAt,
	recyclerAt,
	busAt,
	stockAt,
	systemFootOf,
	systemTallOf,
} from './plan';
import { drawExterior } from './machine';
import { pixelText } from './retro';
import {
	COUCH_SEAT,
	cabinetAt,
	cabinetFacing,
	FACE,
	UNIT,
	box,
	corners,
	floor,
	loungeSeatAt,
	pixelEllipse,
	propParts,
	rect,
	noise,
	seeded,
	walls,
} from './station';

// The ship's log on a room's back wall: how far it has come
// `on`, where to mount it instead, in art pixels (its foot's middle)
const stationLog = (ctx, art, label, room, journey, on) => ({
	y: room.y + (room.face ?? FACE),
	draw: () => {
		// Clear of the room's name over its wall's top
		const at = on ?? art({ x: room.x + room.w / 2, y: room.y + (room.face ?? FACE) + 0.7 });
		const log = { x: at.x - 13, y: at.y - 10 };

		box(ctx, log.x, log.y, 26, 10, PALETTE.k);
		rect(ctx, log.x + 2, log.y + 2, 22, 6, '#1a1408');
		label(
			String(journey?.distance ?? 0),
			{ x: log.x + 13, y: log.y + 5 },
			{ color: PALETTE.y, align: 'center', gap: 6, width: 22, least: 3 },
		);
		room.log = { x: log.x + 13, y: log.y + 5 };
	},
});

// What's drawn after this stays inside the rooms, until ctx.restore()
export const clipToShip = (ctx, layout) => {
	const { left, right, top, bottom } = layout.building;
	const [x, y] = [Math.round(left * UNIT.x), Math.round(top * UNIT.y)];

	ctx.save();
	ctx.beginPath();
	ctx.rect(x, y, Math.round(right * UNIT.x) - x, Math.round(bottom * UNIT.y) - y);
	ctx.clip();
};

// The hull's outline in art pixels: the rows it spans, and each row's left and right edges
const outline = ({ left, right, top, bottom }) => {
	const rim = { x: Math.round(RIM * UNIT.x), y: Math.round(RIM * UNIT.y) };
	const box = {
		left: Math.round(left * UNIT.x) - rim.x,
		right: Math.round(right * UNIT.x) + rim.x,
		top: Math.round(top * UNIT.y) - rim.y,
		bottom: Math.round(bottom * UNIT.y) + rim.y,
	};
	const tip = Math.round(right * UNIT.x) + Math.round(NOSE * UNIT.x);
	const middle = (box.top + box.bottom) / 2;
	const half = (box.bottom - box.top) / 2;

	return {
		...box,
		tip,
		middle,
		leftAt: y => box.left + Math.max(0, 7 - Math.min(y - box.top, box.bottom - y)),
		rightAt: y =>
			// An ogive
			Math.round(box.right + (tip - box.right) * (1 - Math.min(1, Math.abs(y - middle) / half) ** 1.6) ** 1.3),
	};
};

const hulls = new Map();
// The last drawn, so a frame needn't spell out its key
let lastHull;

// The hull plate, painted once for each size
const hullImage = (building, hue) => {
	if (lastHull?.building === building && lastHull.hue === hue) return lastHull.image;

	const key = [hue, ...Object.values(building).map(value => value.toFixed(2))].join('|');

	if (!hulls.has(key)) {
		// Its plates' pattern runs with where it lies, so it's kept for each place it's been, a few at a time
		if (hulls.size > 8) hulls.clear();
		hulls.set(key, paintHull(building, hue));
	}
	lastHull = { building, hue, image: hulls.get(key) };

	return lastHull.image;
};

// How deep the keel's strip runs under the hull's belly, in art pixels, its outline the row past it
const KEEL = 9;

const paintHull = (building, hue) => {
	const shape = outline(building);
	const below = KEEL;
	const canvas = document.createElement('canvas');

	canvas.width = shape.tip - shape.left + 2;
	canvas.height = shape.bottom - shape.top + below + 2;

	const ctx = canvas.getContext('2d');
	const put = (x, y, w, h, color) => rect(ctx, x - shape.left, y - shape.top, w, h, color);

	for (let y = shape.top; y <= shape.bottom; y++) {
		const [from, to] = [shape.leftAt(y), shape.rightAt(y)];
		const lit = (y - shape.top) / (shape.bottom - shape.top);
		const row = Math.floor((y - shape.top) / 14);
		const within = (y - shape.top) % 14;

		const base = (lit < 0.2 && 23) || (lit < 0.75 && 18) || 15;

		// A plate's stretch of the row at a time: it's one shade across
		for (let x = from; x <= to;) {
			const column = Math.floor((x - shape.left) / 20);
			const end = Math.min(to, shape.left + (column + 1) * 20 - 1);
			const shade = seeded(`plate${column}:${row}`);

			put(x, y, end - x + 1, 1, plating(hue, base + (shade - 0.5) * 3));
			x = end + 1;
		}
		if (within === 0) put(from, y, to - from + 1, 1, '#141a26');
		else if (within === 1) put(from, y, to - from + 1, 1, 'rgba(120, 140, 170, 0.18)');
		else if (within === 13) put(from, y, to - from + 1, 1, 'rgba(0, 0, 0, 0.25)');
		for (let x = from + 20 - ((from - shape.left) % 20); x < to; x += 20) put(x, y, 1, 1, '#141a26');
		put(from, y, 1, 1, PALETTE.k);
		put(to, y, 1, 1, PALETTE.k);
		if (within === 3)
			for (let x = from + 4; x < to - 2; x += 20) {
				put(x, y, 1, 1, '#3a4762');
				put(x + 12, y, 1, 1, '#3a4762');
			}
	}
	for (let x = shape.left + 30; x < shape.right - 10; x += 40) {
		const kind = seeded(`back${x}`);
		const y = shape.top + 3;

		if (kind < 0.45) {
			put(x, y, 9, 3, '#141a26');
			for (let slot = 0; slot < 4; slot++) put(x + 1 + slot * 2, y + 1, 1, 1, '#05070a');
		} else if (kind < 0.7) {
			put(x, y - 1, 6, 4, PALETTE.k);
			put(x + 1, y, 4, 2, PALETTE.m);
			put(x + 1, y, 4, 1, PALETTE.l);
		}
	}
	put(shape.leftAt(shape.top), shape.top, shape.rightAt(shape.top) - shape.leftAt(shape.top), 1, PALETTE.k);
	put(
		shape.leftAt(shape.top + 1) + 1,
		shape.top + 1,
		shape.rightAt(shape.top + 1) - shape.leftAt(shape.top + 1) - 1,
		1,
		PALETTE.l,
	);
	for (let x = shape.leftAt(shape.bottom); x <= shape.tip; x++) {
		const edge =
			x <= shape.right
				? shape.bottom
				: shape.middle + ((shape.bottom - shape.middle) * (shape.tip - x)) / (shape.tip - shape.right);
		const tall = x <= shape.right ? below : Math.round(below * ((shape.tip - x) / (shape.tip - shape.right)));

		if (tall <= 0) continue;
		const panel = Math.floor((x - shape.left) / 30);
		const top = Math.round(edge) + 1;

		put(x, top, 1, tall - 1, plating(hue, panel % 2 ? 16 : 12));
		put(x, top, 1, 1, plating(hue, 26));
		if ((x - shape.left) % 30 === 0) put(x, top, 1, tall - 1, '#141a26');
		put(x, Math.round(edge) + tall, 1, 1, PALETTE.k);
		if (x % 30 === 0 && x <= shape.right - 8) {
			put(x - 2, Math.round(edge) + 3, 4, 3, PALETTE.l);
			put(x - 1, Math.round(edge) + 4, 2, 1, seeded(`porthole${x}`) > 0.6 ? PALETTE.y : '#0b1430');
		} else if (x % 30 === 15 && x <= shape.right - 8 && tall >= 7) {
			for (let slot = 0; slot < 3; slot++) put(x - 3 + slot * 3, Math.round(edge) + 3, 2, 4, '#0b0e13');
		}
	}
	return { canvas, x: shape.left, y: shape.top, shape };
};

// The ship sealed in its outer plating while what's aboard comes in, `cover` of it (1 sealed, fading to 0 as it's
// opened), a light sweeping along it the while. Its outside as a ship's: a stripe in its color (`hue`) with its `name`
// painted over it, a row of portholes lit here and there, vents along its belly, and running lights blinking at its bow
// and stern.
export const drawHullCover = (ctx, layout, cover, { time, name = '', hue = 200 }) => {
	if (!layout.building || cover <= 0) return;

	const image = hullImage(layout.building, hue);
	const { shape } = image;
	const tall = shape.bottom - shape.top;
	const [from, to] = [shape.left + 14, shape.right - 14];

	ctx.globalAlpha = cover;
	ctx.drawImage(image.canvas, image.x, image.y);

	// The stripe, its name over it
	const stripe = Math.round(shape.top + tall * 0.36);

	rect(ctx, from, stripe, to - from, 5, `hsl(${hue} 55% 42%)`);
	rect(ctx, from, stripe, to - from, 1, `hsl(${hue} 60% 62%)`);
	rect(ctx, from, stripe + 5, to - from, 1, PALETTE.k);
	pixelText(ctx, name, from + 26, stripe - 4, { color: '#c9d3e3', size: 2, max: (to - from) * 0.6 });
	pixelText(ctx, 'PAUDE', to - 24, stripe - 4, { color: `hsl(${hue} 45% 70%)`, align: 'right' });

	// Portholes, a few of them lit, one now and then blinking
	const ports = Math.round(shape.top + tall * 0.6);

	for (let x = from + 8; x < to - 6; x += 16) {
		const lit = seeded(`port${x}`);
		const blink = lit > 0.85 && Math.floor(time * 1.5 + lit * 9) % 4 === 0;

		rect(ctx, x - 1, ports - 1, 6, 5, PALETTE.k);
		rect(ctx, x, ports, 4, 3, lit > 0.55 && !blink ? '#f2c66d' : '#0b1430');
		if (lit > 0.55 && !blink) rect(ctx, x, ports, 1, 1, '#fff2c8');
	}

	// Vents along the belly
	for (let x = from + 30; x < to - 30; x += 64)
		for (let slot = 0; slot < 4; slot++) rect(ctx, x + slot * 3, shape.bottom - 9, 2, 5, '#0b0e13');

	// Running lights: red at the stern, top and bottom, green at the bow
	const on = Math.floor(time * 2) % 2 === 0;

	rect(ctx, shape.left + 3, shape.top + 3, 2, 2, on ? '#ff4a3a' : '#5a1a16');
	rect(ctx, shape.left + 3, shape.bottom - 5, 2, 2, on ? '#ff4a3a' : '#5a1a16');
	rect(ctx, shape.tip - 4, shape.middle - 1, 2, 2, on ? '#5cff8a' : '#16502a');

	const sweep = shape.left + ((time * 0.6) % 1) * (shape.right - shape.left);
	const glow = ctx.createLinearGradient(sweep - 24, 0, sweep + 24, 0);

	glow.addColorStop(0, 'rgba(120, 220, 255, 0)');
	glow.addColorStop(0.5, 'rgba(120, 220, 255, 0.18)');
	glow.addColorStop(1, 'rgba(120, 220, 255, 0)');
	ctx.fillStyle = glow;
	ctx.fillRect(sweep - 24, shape.top, 48, shape.bottom - shape.top);
	ctx.globalAlpha = 1;
};

// The nose: a cockpit window in an armored rim, space streaming past in it as the sky's does: `drift` how far the sky
// has streamed, in art pixels, so its stars keep the sky's speed at any zoom; `pace` how fast the ship is going
// The window's rows and its stars' places, worked out once for each hull: they turn on its shape alone
const canopyOf = image => {
	if (image.canopyShape) return image.canopyShape;

	const { shape } = image;
	const half = (shape.bottom - shape.top) / 2 - 7;
	const from = shape.right + 2;
	const window = half - 3;
	const rows = [];
	const glass = [];

	for (let y = Math.ceil(shape.middle - half); y <= Math.floor(shape.middle + half); y++) {
		const to = shape.rightAt(y) - 5;

		if (to <= from + 2) continue;
		rows.push({ y, to });
		if (Math.abs(y - shape.middle) <= window) glass.push({ y, to });
	}

	const stars = Array.from({ length: 12 }, (_, star) => ({
		at: seeded(`canopy${star}`),
		depth: 0.4 + seeded(`canopyDepth${star}`) * 0.6,
		x: seeded(`canopyX${star}`),
	}));

	image.canopyShape = { half, from, window, rows, glass, stars };

	return image.canopyShape;
};

const drawCanopy = (ctx, image, { time, pace, drift, hue }) => {
	const { shape } = image;
	const { from, window, rows, glass, stars } = canopyOf(image);

	if (!rows.length) return;

	const width = (image.canopyShape.width ??= glass.length ? Math.max(...glass.map(({ to }) => to)) - from : 0);
	const tip = Math.round(shape.middle);
	// Painted once: what lies under the stars streaming past in the glass, and what over them
	const area = { left: from - 1, top: rows[0].y - 1, w: shape.tip + 9 - from, h: rows.length + 2 };

	image.canopy ??= [
		layer(area, paint => {
			for (const { y, to } of rows) {
				if (Math.abs(y - shape.middle) <= window) continue;

				const above = y < shape.middle;

				rect(paint, from, y, to - from, 1, plating(hue, above ? 22 : 15));
				for (let x = from; x < to; x++)
					if ((x - from + Math.round(Math.abs(y - shape.middle) * 0.8)) % 12 === 0) rect(paint, x, y, 1, 1, '#141a26');
				rect(paint, to, y, 2, 1, PALETTE.k);
			}
			for (const { y, to } of glass) {
				rect(paint, from, y, to - from, 1, `hsl(${hue} 45% 9%)`);
				rect(paint, to, y, 2, 1, PALETTE.k);
			}
			rect(paint, from - 1, rows[0].y, 1, rows.length, PALETTE.k);
			rect(paint, shape.tip + 1, tip, 7, 1, PALETTE.l);
			rect(paint, shape.tip + 1, tip + 1, 7, 1, PALETTE.k);
		}),
		layer(area, paint => {
			if (!glass.length) return;
			for (let x = from + 10; x < from + width; x += 11)
				for (const { y, to } of glass) if (x < to) rect(paint, x, y, 1, 1, PALETTE.m);
			const [first, last] = [glass[0], glass.at(-1)];

			rect(paint, from, first.y - 1, first.to - from + 1, 1, PALETTE.k);
			rect(paint, from, last.y + 1, last.to - from + 1, 1, PALETTE.k);
			rect(paint, from, first.y, first.to - from, 1, `hsl(${hue} 45% 42%)`);
		}),
	];
	ctx.drawImage(image.canopy[0], area.left, area.top);
	for (const { at, depth, x: across } of glass.length ? stars : []) {
		const y = Math.round(glass[0].y + at * (glass.length - 1));
		const row = glass[y - glass[0].y];
		const x = from + ((((across * width - drift * depth) % width) + width) % width);

		if (row && x < row.to)
			rect(ctx, Math.round(x), y, depth > 0.75 && pace > 1.5 ? 2 : 1, 1, depth > 0.7 ? PALETTE.W : PALETTE.l);
	}
	ctx.drawImage(image.canopy[1], area.left, area.top);
	if (Math.floor(time * 1.5) % 2) rect(ctx, shape.tip + 8, tip - 1, 2, 2, PALETTE.W);
};

// Painted once onto a canvas over `area` (art pixels), drawn as it was painted
const layer = ({ left, top, w, h }, painting) => {
	const canvas = document.createElement('canvas');
	const paint = canvas.getContext('2d');

	canvas.width = Math.max(1, w);
	canvas.height = Math.max(1, h);
	paint.translate(-left, -top);
	painting(paint);

	return canvas;
};

// A swept fin off the stern on its back and another under its belly, each with a stripe in the ship's color (`hue`),
// the hull's own
const drawFins = (ctx, image, engineering, { time = 0, hue = 200 } = {}) => {
	if (!engineering) return;

	const { shape } = image;
	// Its root stops short of the fuel tank standing over engineering's middle
	const root = { from: shape.left + 4, to: Math.round((engineering.x + engineering.w / 2) * UNIT.x) - 30 };
	const tall = 30;
	const sweep = 46;
	const chord = Math.max(18, root.to - root.from);
	const tipChord = 20;
	const tipFrom = root.from - sweep;

	for (const out of [-1, 1]) {
		const base = out < 0 ? shape.top : shape.bottom + 9;
		const tip = base + out * (tall + 1);
		const area = { left: tipFrom, top: Math.min(base, tip), w: sweep + Math.max(chord, tipChord) + 1, h: tall + 2 };
		const key = `${out},${chord},${hue}`;

		image.fins ??= new Map();
		if (!image.fins.has(key))
			image.fins.set(
				key,
				layer(area, paint => {
					for (let row = 0; row < tall; row++) {
						const part = row / tall;
						const from = Math.round(root.from - sweep * part);
						const to = Math.round(root.from + chord - (chord - tipChord) * part - sweep * part);
						const y = base + out * (row + 1);

						if (to <= from) continue;
						const band = part > 0.62 && part < 0.78;
						const stripe = part < 0.66 ? `hsl(${hue} 60% 62%)` : `hsl(${hue} 55% 42%)`;

						rect(paint, from, y, to - from, 1, (band && stripe) || (out < 0 ? plating(hue, 20) : plating(hue, 14)));
						for (let seam = to - 9; seam > from + 2; seam -= 9)
							rect(paint, seam, y, 1, 1, band ? `hsl(${hue} 55% 28%)` : '#141a26');
						rect(paint, from + 1, y, 2, 1, 'rgba(0, 0, 0, 0.3)');
						rect(paint, from, y, 1, 1, PALETTE.k);
						rect(paint, to - 2, y, 1, 1, out < 0 ? '#4a5670' : '#3a4458');
						rect(paint, to - 1, y, 1, 1, PALETTE.l);
						rect(paint, to, y, 1, 1, PALETTE.k);
					}
					rect(paint, tipFrom, tip, tipChord, 1, PALETTE.k);
				}),
			);
		ctx.drawImage(image.fins.get(key), area.left, area.top);
		if (Math.floor(time * 1.2 + (out < 0 ? 0 : 0.5)) % 2)
			rect(ctx, tipFrom + tipChord - 3, tip + out, 2, 2, out < 0 ? PALETTE.r : '#3ad07a');
	}
};

// An engine out past the stern behind its reactor, its plume as long as its work is heavy (`thrust`, 0 to 1),
// sputtering red and short at a usage limit: a housing faired into the hull, its chamber with a pump riding on it,
// a gimbal ring, and a wide bell banded with cooling rings, its throat glowing while it burns
const drawEngine = (ctx, shape, { y, hue, thrust, limited, time }) => {
	const front = shape.leftAt(y) + 4;
	const back = front - Math.round(NACELLE * UNIT.x);
	const burning = thrust > 0 && !limited;
	const flicker = Math.sin(time * 23 + hue) > 0 ? 1 : 0;
	const sputter = Math.sin(time * 9) > 0.6 ? 6 : 2;
	const length = limited ? sputter : Math.round(8 + thrust * 36) + flicker * 2;
	const color = limited ? 'hsl(4 70% 45%)' : `hsl(${hue} 75% ${48 + thrust * 14}%)`;
	const bell = 12;
	const mouth = back - bell;
	const fairing = 9;
	const chamber = 5;

	if (burning) {
		ctx.globalAlpha = 0.1 + thrust * 0.1;
		pixelEllipse(ctx, mouth - length / 2, y, length / 2 + 10, 12, color);
		ctx.globalAlpha = 1;
	}
	for (let step = 0; step < length; step++) {
		const part = step / length;
		const spread = Math.max(1, Math.round(9 * (1 - part) ** 0.7));

		rect(ctx, mouth - step - 1, y - spread, 1, spread * 2 + 1, color);
		if (!limited && part < 0.6)
			rect(ctx, mouth - step - 1, y - 1, 1, 3, part < 0.25 ? '#fff6e0' : `hsl(${hue} 90% 82%)`);
	}
	if (burning)
		for (let diamond = 6 + (Math.floor(time * 12) % 2); diamond < length * 0.7; diamond += 9)
			rect(ctx, mouth - diamond - 1, y - 1, 2, 3, '#ffffff');

	// The fairing: deep where it meets the hull, tapering back to the chamber, lit from above
	for (let x = back + fairing; x < front; x++) {
		const half = chamber + 2 + Math.round(((x - back - fairing) / (front - back - fairing)) * 5);

		rect(ctx, x, y - half - 1, 1, half * 2 + 3, PALETTE.k);
		rect(ctx, x, y - half, 1, half, PALETTE.m);
		rect(ctx, x, y, 1, half + 1, '#2b3242');
		rect(ctx, x, y - half, 1, 1, '#8994aa');
	}
	rect(ctx, front - 6, y - 4, 1, 9, '#1b2130');
	rect(
		ctx,
		back + fairing + 3,
		y - chamber - 1,
		front - back - fairing - 9,
		1,
		`hsl(${hue} 55% ${limited ? 30 : 45}%)`,
	);
	// The chamber, a round tube shaded top to bottom, and the pump on its back with its feed line down into it
	const shades = ['#8994aa', PALETTE.l, PALETTE.m, PALETTE.m, '#3a4357', '#343c4e', '#2b3242', PALETTE.d, '#1f2533'];

	for (let row = -chamber; row <= chamber; row++)
		rect(
			ctx,
			back + 2,
			y + row,
			fairing - 2,
			1,
			Math.abs(row) === chamber
				? PALETTE.k
				: shades[Math.round(((row + chamber) / (chamber * 2)) * (shades.length - 1))],
		);
	box(ctx, back + 3, y - chamber - 4, 5, 4, PALETTE.l);
	rect(ctx, back + 4, y - chamber - 3, 1, 1, burning && Math.floor(time * 6) % 2 ? `hsl(${hue} 90% 72%)` : PALETTE.d);
	rect(ctx, back + 8, y - chamber - 2, 3, 1, PALETTE.k);
	// The gimbal ring
	rect(ctx, back, y - chamber - 2, 2, chamber * 2 + 5, PALETTE.k);
	rect(ctx, back + 1, y - chamber - 1, 1, chamber * 2 + 3, '#6c7790');
	// The bell, flaring out wide, a cooling ring every few pixels, its inner throat glowing back from the burn
	for (let step = 0; step < bell; step++) {
		const flare = 4 + Math.round((step / (bell - 1)) ** 1.4 * 8);
		const x = back - 1 - step;
		const ring = step % 4 === 2;

		rect(ctx, x, y - flare - 1, 1, flare * 2 + 3, PALETTE.k);
		rect(ctx, x, y - flare, 1, flare, ring ? '#5a6478' : '#3a4357');
		rect(ctx, x, y, 1, flare + 1, ring ? '#343c4e' : '#232a38');
		rect(ctx, x, y - flare, 1, 1, '#8994aa');
		if (burning && step < 4) {
			ctx.globalAlpha = 0.55 - step * 0.12;
			rect(ctx, x, y - 2, 1, 5, `hsl(${hue} 90% 72%)`);
			ctx.globalAlpha = 1;
		}
	}
	const lip = 12;

	rect(ctx, mouth, y - lip, 1, lip * 2 + 1, burning ? `hsl(${hue} 90% 72%)` : PALETTE.m);
	// Struts from the hull to the fairing, above and below
	for (const side of [-1, 1]) {
		const at = y + side * (chamber + 6);

		rect(ctx, front - 1, at - 1, 5, 3, PALETTE.k);
		rect(ctx, front, at, 3, 1, side < 0 ? PALETTE.l : PALETTE.m);
	}
};

const FUEL = '#f0b43c';
// Each tank's own color, in its fuel and along its pipe to each reactor it feeds
export const TANK_COLORS = [FUEL, '#5fd39a', '#c99bf0', '#f08a6a'];

// A fuel tank on the hull, `at` where it meets it: fuel running down its line as fast as it's burned (`flow`, 0 to
// 1), its sight glass filled to `level` (0 to 1), striped where that's not known, flashing red once empty

// The color of what's left of a limit: the tank's own while there's plenty, amber getting low, red nearly out
const leftColor = (left, color) => (left < 0.2 && PALETTE.r) || (left < 0.5 && PALETTE.y) || color;

export const drawTank = (ctx, at, { level, gauges, flow, empty, color = FUEL }, { time, below = false }) => {
	const cradle = 4;
	const tall = 12;
	const half = 28;
	const top = below ? at.y + cradle - 1 : at.y - cradle - tall;
	const shades = [
		'#9aa5bb',
		'#7d889e',
		'#66718a',
		'#56607a',
		'#4a546c',
		'#434d63',
		'#3c455a',
		'#363e51',
		'#30384a',
		'#2a3142',
		'#242a39',
		'#1e2330',
	];

	for (let step = 0; step < cradle; step++) {
		const y = at.y + (below ? step - 1 : -step - 1);
		const width = half - 6 + (cradle - 1 - step) * 3;

		rect(ctx, at.x - width, y, width * 2 + 1, 1, PALETTE.k);
		rect(ctx, at.x - width + 1, y, width * 2 - 1, 1, step === cradle - 1 ? '#3a4458' : '#2c3547');
	}
	rect(ctx, at.x - 1, below ? at.y - 1 : at.y - cradle, 3, cradle, PALETTE.k);
	rect(ctx, at.x, below ? at.y - 1 : at.y - cradle, 1, cradle, color);
	if (flow > 0 && !empty)
		rect(
			ctx,
			at.x,
			(below ? at.y - 1 : at.y - cradle) + (Math.floor(time * (6 + flow * 24)) % cradle),
			1,
			1,
			PALETTE.W,
		);
	for (let row = 0; row < tall; row++) {
		const inset = (row === 0 || row === tall - 1 ? 3 : 0) || (row === 1 || row === tall - 2 ? 1 : 0);

		rect(ctx, at.x - half + inset, top + row, (half - inset) * 2 + 1, 1, PALETTE.k);
		rect(ctx, at.x - half + inset + 1, top + row, (half - inset) * 2 - 1, 1, shades[row]);
	}
	for (const band of [-17, 16]) {
		rect(ctx, at.x + band, top, 2, tall, '#1b2130');
		rect(ctx, at.x + band, top + 1, 1, 1, '#b5bfd2');
	}
	// Its gauge: with the account's limits known, what's left of the five hours over what's left of the week, each with
	// its quarters marked; else one bar, the estimate, or grey hatching over an empty glass while nothing's known
	const glass = { x: at.x - 13, y: top + 3, w: 27, h: 6 };
	const bar = (y, h, left) => rect(ctx, glass.x, y, Math.round(glass.w * left), h, leftColor(left, color));

	rect(ctx, glass.x - 1, glass.y - 1, glass.w + 2, glass.h + 2, PALETTE.k);
	rect(ctx, glass.x, glass.y, glass.w, glass.h, '#0b0e13');
	if (empty) rect(ctx, glass.x, glass.y, glass.w, glass.h, Math.floor(time * 3) % 2 ? PALETTE.r : '#0b0e13');
	else if (gauges) {
		bar(glass.y, 2, gauges.session);
		rect(ctx, glass.x, glass.y + 2, glass.w, 1, PALETTE.k);
		bar(glass.y + 3, 3, gauges.week);
		for (let quarter = 1; quarter < 4; quarter++)
			rect(ctx, glass.x + Math.round((glass.w * quarter) / 4), glass.y, 1, glass.h, 'rgba(0, 0, 0, 0.5)');
	} else if (level === null) {
		for (let x = 0; x < glass.w; x++)
			for (let y = 0; y < glass.h; y++) if ((x + y) % 4 < 2) rect(ctx, glass.x + x, glass.y + y, 1, 1, PALETTE.m);
	} else bar(glass.y, glass.h, level);
	rect(ctx, glass.x, glass.y, glass.w, 1, 'rgba(255, 255, 255, 0.25)');
	// Its end caps lit as what's left of the limit nearest running out
	for (const end of [-half + 3, half - 4]) {
		rect(ctx, at.x + end, top + 2, 2, tall - 4, level === null ? PALETTE.d : leftColor(level, color));
		rect(ctx, at.x + end, top + 2, 2, 1, 'rgba(255, 255, 255, 0.35)');
	}
};

// Where the hull's back and belly run, in art pixels
export const hullEdges = building => {
	const { top, bottom } = outline(building);

	return { top, bottom };
};

// A shuttle bringing someone aboard or taking them off, docked over the airlock: `dock` the hull's top over it, `away`
// how far off it still is (0 docked, 1 out of sight ahead and above), `tube` how far its boarding tube reaches down to
// the hull (0 to 1), `walker` how far down it someone is (0 at the shuttle, 1 at the hull; null for nobody), `hue`
// theirs. A small white craft striped in their color, its cockpit forward; or, bringing a fabled session's monitor
// (`craft` 'monitor'), a longer dark craft of Fable's livery (`accent`), its window strip lit, striped in the session's
// color, with the monitor's tall figure in its tube.
export const SHUTTLE_HOVER = 20;

// Where a shuttle hangs `away` from its dock, in art pixels: its hull's bottom, over the hatch
export const shuttleAt = (dock, away) => ({
	x: Math.round(dock.x + away * 240),
	y: Math.round(dock.y - SHUTTLE_HOVER - away * 90),
});

// `hue` is the stripe along its hull, `rider` the color of the one in its tube (the stripe's when not given)
export const drawShuttle = (
	ctx,
	dock,
	{ away, tube, walker, hue, rider, time, craft = 'shuttle', accent = PALETTE.p },
) => {
	const { x, y } = shuttleAt(dock, away);
	const stripe = `hsl(${hue ?? 200} 60% 55%)`;
	const band = rider === undefined ? stripe : `hsl(${rider} 60% 55%)`;

	if (craft === 'monitor') return drawMonitorCraft(ctx, dock, { x, y, away, tube, walker, stripe, accent, time });

	// Its tube down to the hull: glass in a frame, someone in it on their way through
	if (tube > 0) {
		const reach = Math.round(SHUTTLE_HOVER * tube);

		rect(ctx, x - 3, y, 7, reach, PALETTE.k);
		rect(ctx, x - 2, y, 5, reach, 'rgba(120, 190, 230, 0.35)');
		rect(ctx, x - 2, y, 1, reach, 'rgba(220, 245, 255, 0.5)');
		for (let rib = y + 3; rib < y + reach; rib += 4) rect(ctx, x - 3, rib, 7, 1, PALETTE.m);
		if (tube >= 1) {
			rect(ctx, x - 4, dock.y - 1, 9, 2, PALETTE.k);
			rect(ctx, x - 3, dock.y - 1, 7, 1, PALETTE.l);
		}
		if (walker !== null) {
			const at = Math.round(y + 1 + (reach - 7) * walker);

			rect(ctx, x - 1, at, 3, 3, '#e8eef6');
			rect(ctx, x, at + 1, 1, 1, '#f0c040');
			rect(ctx, x - 1, at + 3, 3, 2, band);
			rect(ctx, x - 1, at + 5, 1, 2, '#e8eef6');
			rect(ctx, x + 1, at + 5 - (Math.floor(time * 6) % 2), 1, 2, '#e8eef6');
		}
	}
	// Its engine aft, flaring while it moves
	const flare = away > 0.01 ? 3 + (Math.floor(time * 20) % 3) : 1;

	rect(ctx, x - 12 - flare, y - 5, flare, 2, PALETTE.Y);
	// Its hull: white, outlined, its stripe in their color, rounded at the nose, its cockpit forward
	rect(ctx, x - 12, y - 8, 22, 8, PALETTE.k);
	rect(ctx, x + 10, y - 7, 2, 6, PALETTE.k);
	rect(ctx, x - 11, y - 7, 21, 6, '#d8dee8');
	rect(ctx, x + 10, y - 6, 1, 4, '#d8dee8');
	rect(ctx, x - 11, y - 7, 21, 1, '#f4f7fb');
	rect(ctx, x - 11, y - 3, 21, 1, '#a8b2c2');
	rect(ctx, x - 11, y - 5, 18, 1, stripe);
	rect(ctx, x + 5, y - 7, 5, 3, PALETTE.k);
	rect(ctx, x + 6, y - 7, 4, 2, '#7fd6ff');
	rect(ctx, x + 6, y - 7, 1, 1, '#e0f6ff');
	// Its belly hatch, open while its tube is out
	rect(ctx, x - 2, y - 1, 5, 1, tube > 0 ? '#05070a' : '#8a94a6');
	// Its beacon
	rect(ctx, x - 8, y - 9, 2, 1, Math.floor(time * 2) % 2 ? '#ff4a3a' : '#5a1a16');
};

// The tube a craft lets down to the hull: glass in a frame, `figure` drawn in it at its way down (0 to 1), when given
const drawTube = (ctx, dock, { x, y, tube, walker }, figure) => {
	const reach = Math.round(SHUTTLE_HOVER * tube);

	rect(ctx, x - 3, y, 7, reach, PALETTE.k);
	rect(ctx, x - 2, y, 5, reach, 'rgba(120, 190, 230, 0.35)');
	rect(ctx, x - 2, y, 1, reach, 'rgba(220, 245, 255, 0.5)');
	for (let rib = y + 3; rib < y + reach; rib += 4) rect(ctx, x - 3, rib, 7, 1, PALETTE.m);
	if (tube >= 1) {
		rect(ctx, x - 4, dock.y - 1, 9, 2, PALETTE.k);
		rect(ctx, x - 3, dock.y - 1, 7, 1, PALETTE.l);
	}
	if (walker !== null) figure(reach);
};

// The monitor's craft: long and dark, a lit window strip along it, the session's stripe under, twin fins aft, a
// beacon in Fable's color; the monitor's tall grey figure in its tube, its skull aglow
const drawMonitorCraft = (ctx, dock, { x, y, away, tube, walker, stripe, accent, time }) => {
	if (tube > 0)
		drawTube(ctx, dock, { x, y, tube, walker }, reach => {
			const at = Math.round(y + 1 + (reach - 10) * walker);

			rect(ctx, x - 1, at, 3, 4, '#c9ced8');
			rect(ctx, x, at + 1, 1, 1, accent);
			rect(ctx, x - 1, at + 4, 3, 1, stripe);
			rect(ctx, x - 1, at + 5, 3, 3, '#8f96a8');
			rect(ctx, x - 1, at + 8, 1, 2, '#8f96a8');
			rect(ctx, x + 1, at + 8 - (Math.floor(time * 6) % 2), 1, 2, '#8f96a8');
		});

	const flare = away > 0.01 ? 3 + (Math.floor(time * 20) % 3) : 1;

	rect(ctx, x - 16 - flare, y - 5, flare, 2, accent);
	// Twin fins aft, over and under
	rect(ctx, x - 15, y - 11, 3, 4, PALETTE.k);
	rect(ctx, x - 14, y - 10, 1, 3, '#3a4260');
	rect(ctx, x - 15, y - 1, 3, 3, PALETTE.k);
	rect(ctx, x - 14, y - 1, 1, 2, '#3a4260');
	// Its hull: dark, outlined, longer than a shuttle, its nose drawn to a point
	rect(ctx, x - 16, y - 8, 28, 8, PALETTE.k);
	rect(ctx, x + 12, y - 7, 2, 6, PALETTE.k);
	rect(ctx, x + 14, y - 5, 1, 2, PALETTE.k);
	rect(ctx, x - 15, y - 7, 27, 6, '#262c40');
	rect(ctx, x + 12, y - 6, 1, 4, '#262c40');
	rect(ctx, x - 15, y - 7, 27, 1, '#3d4660');
	rect(ctx, x - 15, y - 2, 27, 1, '#161a28');
	// Its window strip, lit, and the session's stripe under it
	rect(ctx, x - 12, y - 6, 20, 1, accent);
	for (let pane = x - 11; pane < x + 8; pane += 4) rect(ctx, pane, y - 6, 1, 1, '#161a28');
	rect(ctx, x - 15, y - 4, 27, 1, stripe);
	// Its cockpit forward
	rect(ctx, x + 8, y - 7, 5, 3, PALETTE.k);
	rect(ctx, x + 9, y - 7, 4, 2, accent);
	rect(ctx, x + 9, y - 7, 1, 1, '#f0e6ff');
	// Its belly hatch, open while its tube is out
	rect(ctx, x - 2, y - 1, 5, 1, tube > 0 ? '#05070a' : '#4a5270');
	// Its beacon
	rect(ctx, x - 10, y - 9, 2, 1, Math.floor(time * 2) % 2 ? accent : '#2a1a40');
};

// The refuel ship, `at` the hull over a tank it fills, `t` through its visit: in from astern and above, settled on the
// hull with its hose let down into it while it pumps, and away astern again. A stubby tanker, its fuel drum banded
// in the tank's color, its cockpit forward, its engine aft.
export const drawTanker = (ctx, at, t, { color = FUEL, time }) => {
	const ease = u => u * u * (3 - 2 * u);
	const away = (t < 0.25 && 1 - ease(t / 0.25)) || (t > 0.8 && ease((t - 0.8) / 0.2)) || 0;
	const x = Math.round(at.x - away * 260);
	const y = Math.round(at.y - 14 - away * 70);
	const pumping = t > 0.3 && t < 0.78;

	// Its hose down to the hull, fuel pulsing along it while it pumps
	if (t > 0.25 && t < 0.8) {
		const hose = Math.min(1, (t - 0.25) / 0.05, (0.8 - t) / 0.05);
		const reach = Math.round((at.y - (y + 6)) * hose);

		rect(ctx, x - 1, y + 6, 3, reach, PALETTE.k);
		rect(ctx, x, y + 6, 1, reach, PALETTE.l);
		if (pumping) rect(ctx, x, y + 6 + (Math.floor(time * 16) % Math.max(1, reach)), 1, 2, color);
		rect(ctx, x - 2, at.y - 1, 5, 2, PALETTE.k);
		rect(ctx, x - 1, at.y - 1, 3, 1, pumping ? color : PALETTE.d);
	}
	// Its engine aft, flaring while it moves
	const flare = away > 0.02 ? 4 + (Math.floor(time * 20) % 3) : 1;

	rect(ctx, x - 17 - flare, y + 2, flare, 3, PALETTE.Y);
	rect(ctx, x - 17 - flare + 1, y + 3, Math.max(1, flare - 1), 1, PALETTE.W);
	// Its hull and drum: outlined, lit along the top, the drum banded in the fuel's color
	rect(ctx, x - 17, y - 2, 30, 10, PALETTE.k);
	rect(ctx, x - 16, y - 1, 28, 8, PALETTE.m);
	rect(ctx, x - 16, y - 1, 28, 1, PALETTE.l);
	rect(ctx, x - 12, y - 5, 18, 4, PALETTE.k);
	rect(ctx, x - 11, y - 4, 16, 3, '#56607a');
	for (const band of [x - 9, x - 3, x + 3]) rect(ctx, band, y - 4, 2, 3, color);
	rect(ctx, x - 16, y + 4, 28, 1, color);
	// Its cockpit forward, and its landing struts down while it's settled
	rect(ctx, x + 9, y, 6, 5, PALETTE.k);
	rect(ctx, x + 10, y + 1, 4, 3, '#7fd6ff');
	rect(ctx, x + 10, y + 1, 1, 1, '#e0f6ff');
	if (away < 0.02)
		for (const leg of [x - 13, x + 8]) {
			rect(ctx, leg, y + 8, 1, at.y - y - 8, PALETTE.k);
			rect(ctx, leg - 1, at.y - 1, 3, 1, PALETTE.k);
		}
	// Its beacon
	rect(ctx, x - 2, y - 6, 2, 1, Math.floor(time * 2) % 2 ? '#ff4a3a' : '#5a1a16');
};

// A bay door through the keel, `left` to `right` from the hull's belly (`top`) down through the keel's strip, `open`
// 0 shut to 1 wide: a frame round the opening, its two plated leaves meeting in the middle with hazard bands on their
// meeting edges, sliding apart into the keel; while they move or stand open, the opening glows red within and lamps
// at the frame's ends blink. Its leaves are plated in the ship's color (`hue`) as the keel round them is
const drawBayDoor = (ctx, { left, right, top, open, time, hue }) => {
	const deep = KEEL + 1;
	const width = right - left;
	const half = Math.floor(width / 2);
	const parted = Math.round(half * Math.min(1, open));
	const active = open > 0.01;

	// Its frame and the opening behind the leaves, dark and lit red from within while it's open
	rect(ctx, left - 2, top, width + 4, deep + 1, PALETTE.k);
	rect(ctx, left, top + 1, width, deep - 1, '#05070a');
	if (active) {
		ctx.globalAlpha = 0.35 * Math.min(1, open * 2);
		rect(ctx, left + half - parted, top + 1, parted * 2, 1, '#ff4a3a');
		rect(ctx, left + half - parted, top + deep - 2, parted * 2, 1, '#ff4a3a');
		ctx.globalAlpha = 1;
	}
	// Its leaves, each drawn back toward its end as it opens
	for (const side of [-1, 1]) {
		const w = half - parted;

		if (w <= 0) continue;

		const x = side < 0 ? left : right - w;

		rect(ctx, x, top + 1, w, deep - 1, plating(hue, 20));
		rect(ctx, x, top + 1, w, 1, plating(hue, 36));
		rect(ctx, x, top + deep - 2, w, 1, plating(hue, 13));
		for (let seam = x + 6; seam < x + w - 2; seam += 8) rect(ctx, seam, top + 2, 1, deep - 4, '#141a26');
		// The hazard band down its meeting edge
		const edge = side < 0 ? x + w - 3 : x;

		for (let row = 0; row < deep - 1; row++)
			rect(ctx, edge, top + 1 + row, 3, 1, Math.floor((row + (side < 0 ? 0 : 1)) / 2) % 2 ? PALETTE.y : PALETTE.k);
	}
	// Its lamps at the frame's ends
	const lamp = active && Math.floor(time * 4) % 2 ? '#ff4a3a' : '#5a1a16';

	for (const x of [left - 2, right]) rect(ctx, x, top + Math.floor(deep / 2) - 1, 2, 2, lamp);
};

// The hull and what's on it: the engines, a fuel tank for each account, each project's section, the comms dish and
// masts, the hangar's doors, running lights; its plating, its fins' stripes and its canopy in the ship's color (`hue`)
export const drawHull = (
	ctx,
	layout,
	{ time, engines = [], comms, bayDoors = {}, sections = [], pace = 1, drift = 0, hue = 200 },
) => {
	const image = hullImage(layout.building, hue);
	const { shape } = image;

	drawFins(ctx, image, layout.engineering, { time, hue });
	for (const engine of engines) drawEngine(ctx, shape, { ...engine, time });
	ctx.drawImage(image.canvas, image.x, image.y);
	// The bay doors in the belly under the hold and the hangar, as open as `bayDoors` says (0 to 1): a pod drops out
	// through the one, the tug flies out and back through the other
	for (const [room, open] of [
		[layout.hold, bayDoors.hold ?? 0],
		[layout.hangar, bayDoors.hangar ?? 0],
	])
		if (room)
			drawBayDoor(ctx, {
				left: Math.round(room.x * UNIT.x) + 4,
				right: Math.round((room.x + room.w) * UNIT.x) - 4,
				top: shape.bottom - 1,
				open,
				time,
				hue,
			});
	drawCanopy(ctx, image, { time, pace, drift, hue });
	// Each project's section: seams at its ends where it has no machine, and its machine's machinery outside
	for (const section of sections) {
		const [from, to] = [Math.round(section.from * UNIT.x), Math.round(section.to * UNIT.x)];
		const back = section.side === 'top' || section.side === 'both';
		const belly = section.side === 'bottom' || section.side === 'both';

		if (!section.housings?.length)
			for (const x of [from, to - 1])
				rect(ctx, x, back ? shape.top : shape.bottom, 1, back && belly ? shape.bottom - shape.top + 9 : 9, PALETTE.k);

		// Its machine's machinery outside the hull, on its back or under its belly, grown from the machine inside
		for (const housing of section.housings ?? [])
			if (housing.top || housing.bottom)
				drawExterior(ctx, {
					left: Math.round((housing.part.x + 0.12) * UNIT.x),
					right: Math.round((housing.part.x + housing.part.w - 0.12) * UNIT.x),
					base: housing.top ? shape.top : shape.bottom + KEEL + 1,
					out: housing.top ? -1 : 1,
					folders: section.folders,
					fallback: section.form,
					hue: section.hue,
					ship: hue,
					state: (section.working && 'working') || (section.idle ? 'idle' : 'ready'),
					asking: section.asking,
					time,
					seed: section.seed,
					history: section.history,
					own: section.own,
				});
	}

	// The ship's dish on its back, over the first machine's web
	const room = Object.values(layout.systems).find(({ key }) => key === 'dish');

	if (comms && room) {
		const base = shape.top;
		const dishX = Math.round((room.x + 0.8) * UNIT.x);
		const facing = comms.active ? [-1, 0, 1, 0][Math.floor(time * 1.2) % 4] : 0;

		rect(ctx, dishX - 3, base - 3, 7, 3, PALETTE.k);
		rect(ctx, dishX, base - 12, 1, 10, PALETTE.l);
		[
			[-6, 13, PALETTE.w],
			[-5, 11, PALETTE.l],
			[-3, 7, PALETTE.m],
		].forEach(([from, width, color], row) =>
			rect(ctx, dishX + from + facing * (2 - row), base - 17 + row, width, 1, color),
		);
		rect(ctx, dishX + facing * 3, base - 21, 1, 4, PALETTE.l);
		rect(ctx, dishX + facing * 3, base - 22, 1, 1, comms.active ? comms.hue : PALETTE.d);
		if (comms.active)
			for (const offset of [0, 0.33, 0.66]) {
				const reach = 4 + ((time * 0.9 + offset) % 1) * 22;

				ctx.globalAlpha = 1 - ((time * 0.9 + offset) % 1);
				for (let step = 0; step <= 8; step++) {
					const angle = Math.PI * (1.15 + (step / 8) * 0.7);

					rect(
						ctx,
						dishX + facing * 3 + Math.cos(angle) * reach,
						base - 22 + Math.sin(angle) * reach * 0.7,
						1,
						1,
						comms.hue,
					);
				}
				ctx.globalAlpha = 1;
			}
		comms.masts.forEach((mast, index) => {
			const x = Math.round((room.x + 1.7 + index * 0.45) * UNIT.x);
			const tall = 12 + (index % 2) * 5;

			rect(ctx, x - 1, base - tall, 3, tall, PALETTE.k);
			rect(ctx, x, base - tall + 1, 1, tall - 1, PALETTE.l);
			rect(ctx, x - 2, base - tall + 4, 5, 1, PALETTE.m);
			rect(ctx, x - 1, base - tall - 3, 3, 3, mast.active ? mast.color : mast.dim);
			if (mast.faulty && Math.floor(time * 3) % 2) rect(ctx, x + 2, base - tall + 2, 1, 1, PALETTE.r);
			if (mast.active)
				for (let beam = base - tall - 6 - (Math.floor(time * 18) % 5); beam > base - tall - 70; beam -= 5)
					rect(ctx, x, beam, 1, 3, mast.color);
			mast.at = { x, y: base - tall - 2 };
		});
	}

	for (let x = shape.left + 14; x < shape.right; x += 26) {
		const on = (Math.floor(time * 2) + x / 26) % 4 < 1;

		rect(ctx, x, shape.top - 1, 2, 1, on ? PALETTE.r : '#5a2622');
		rect(ctx, x, shape.bottom + 9, 2, 1, on ? PALETTE.t : '#1d4a42');
	}
	if (Math.floor(time * 1.5) % 3 === 0) rect(ctx, shape.tip - 1, Math.round(shape.middle), 2, 1, PALETTE.W);
};

// Engineering: a reactor for each engine, fed from its account's tank (`feed`: { tank, flow }), browning out under a
// countdown at a usage limit; by the door, the recycler
// A reactor's unit, in art pixels up from its foot: how tall, where its shaft runs back to its engine, and where its
// fuel comes in
const REACTOR = { tall: 22, shaft: 11, into: 15 };

// How far out from its middle a reactor module's side is, where its bus couples on
export const REACTOR_SIDE = 12;

export const drawEngineering = (ctx, art, label, room, { time, engines, systems = [], recycling, zoom }) => {
	floor(ctx, art, room);

	const recycler = art(recyclerAt(room));

	const boardWidth = Math.max(18, engines.length * 8 + 6);
	const boardAt = { x: room.x + room.w * 0.74, y: room.y + FACE + 1.8 };
	const board = art(boardAt);
	const boardX = Math.round(board.x - boardWidth / 2);
	const tanks = art({ x: room.x + 0.5, y: room.y + room.d - 0.25 });

	return [
		...walls(ctx, art, label, room, { name: room.name, color: PALETTE.y }),
		// A meter for each engine, as full as its sessions at work
		{
			y: boardAt.y,
			draw: () => {
				const top = board.y - 22;

				rect(ctx, boardX + 2, board.y - 6, 2, 6, PALETTE.k);
				rect(ctx, boardX + boardWidth - 4, board.y - 6, 2, 6, PALETTE.k);
				box(ctx, boardX - 1, board.y - 8, boardWidth + 2, 3, PALETTE.l);
				box(ctx, boardX, top, boardWidth, 16, '#0d1218');
				engines.forEach((engine, index) => {
					const x = boardX + 4 + index * 8;
					const hue = engine.hue ?? 215;
					const level = engine.outage ? 0 : Math.min(1, (engine.working ?? 0) / 3);
					const fill = Math.round(level * 10);

					rect(ctx, x, top + 3, 3, 10, PALETTE.d);
					rect(ctx, x, top + 13 - fill, 3, fill, `hsl(${hue} 70% 60%)`);
					rect(
						ctx,
						x + 4,
						top + 3,
						1,
						1,
						(engine.outage && (Math.floor(time * 3) % 2 ? PALETTE.r : PALETTE.d)) ||
							(level > 0 && Math.floor(time * 2 + index) % 2 ? PALETTE.t : PALETTE.d),
					);
				});
			},
		},
		{
			y: room.y + room.d - 0.25,
			draw: () => {
				for (let tank = 0; tank < 2; tank++) {
					const x = tanks.x - 4 + tank * 9;

					box(ctx, x, tanks.y - 20, 8, 20, PALETTE.m);
					rect(ctx, x + 1, tanks.y - 19, 2, 18, PALETTE.l);
					rect(ctx, x + 1, tanks.y - 14, 6, 1, PALETTE.d);
					rect(ctx, x + 1, tanks.y - 7, 6, 1, PALETTE.d);
					rect(ctx, x + 3, tanks.y - 23, 2, 3, PALETTE.k);
					rect(ctx, x + 5, tanks.y - 11, 1, 1, '#4ad0e0');
				}
			},
		},
		...engines.map(engine => ({
			y: engine.reactor.y,
			draw: () => {
				const at = art(engine.reactor);
				const hue = engine.hue ?? 215;
				const busy = engine.busy && !engine.outage;
				const flicker = engine.outage && Math.sin(time * 9) * Math.sin(time * 2.3) > 0.55;
				const core =
					(engine.outage && `hsl(4 55% ${flicker ? 42 : 24}%)`) ||
					(busy ? `hsl(${hue} 75% 62%)` : `hsl(${hue} 25% 26%)`);
				const [from, to] = corners(art, room);

				// Fuel from its account's tank: out of its foot (`y`, or in through the hull at its edge), along to a riser
				// by the bay's back wall, and to the reactor
				if (engine.feed) {
					const { tank, below, x: through, y: out, color } = engine.feed;
					const pipe = from.x + 3 + tank * 3;
					const edge = out ?? (below ? to.y - 3 - tank : from.y + 3 + tank);
					const into = at.y - REACTOR.into;
					const run = [
						...(through === undefined ? [] : [[through, edge, pipe, edge]]),
						[pipe, edge, pipe, into],
						[pipe, into, at.x - 11, into],
					];

					for (const [x1, y1, x2, y2] of run) {
						const [x, y] = [Math.min(x1, x2), Math.min(y1, y2)];

						rect(ctx, x, y, Math.abs(x2 - x1) + 2, Math.abs(y2 - y1) + 2, PALETTE.k);
						rect(ctx, x, y, Math.abs(x2 - x1) + 1, Math.abs(y2 - y1) + 1, `${color}66`);
					}
				}
				// Its shaft back through the stern to its thruster, jogging to the thruster's height just inside the wall
				const shaft = at.y - REACTOR.shaft;
				const thruster = engine.thruster ?? shaft;
				const jog = from.x + 5;

				for (const [x, y, w, h] of [
					[from.x, thruster, jog - from.x, 1],
					[jog, Math.min(thruster, shaft), 1, Math.abs(thruster - shaft) + 1],
					[jog, shaft, at.x - 11 - jog, 1],
				]) {
					rect(ctx, x - (h > 1 ? 1 : 0), y - (w > 1 ? 1 : 0), w + (h > 1 ? 2 : 0), h + (w > 1 ? 2 : 0), PALETTE.k);
					rect(ctx, x, y, w, h, PALETTE.l);
				}
				// Its bus: out of its side at its core to the riser up the column's inner side, and along the riser to each of
				// its systems' mains; what runs along it is its sessions' streams, drawn with them
				const bus = art({ x: busAt(room), y: 0 }).x;
				const mains = systems
					.filter(system => system.engine === engine.key)
					.map(system => art({ x: 0, y: system.y }).y + 7);

				if (mains.length) {
					const top = Math.min(at.y - REACTOR.shaft, ...mains);
					const bottom = Math.max(at.y - REACTOR.shaft, ...mains);

					rect(ctx, at.x + REACTOR_SIDE, at.y - REACTOR.shaft - 2, bus - at.x - REACTOR_SIDE, 5, PALETTE.k);
					rect(ctx, at.x + REACTOR_SIDE, at.y - REACTOR.shaft - 1, bus - at.x - REACTOR_SIDE, 3, PALETTE.d);
					rect(ctx, bus - 2, top - 3, 5, bottom - top + 6, PALETTE.k);
					rect(ctx, bus - 1, top - 2, 3, bottom - top + 4, PALETTE.d);
					rect(ctx, bus - 1, top - 2, 1, bottom - top + 4, PALETTE.l);
					for (const y of mains) rect(ctx, bus - 3, y - 1, 7, 3, PALETTE.l);
				}
				// A module as the systems are: on a plinth over a hazard strip, a core vessel banded while it runs between two
				// capacitor columns whose lamps climb toward its coupling into the bus
				for (let x = at.x - 13; x < at.x + 14; x++)
					rect(ctx, x, at.y + 2, 1, 1, Math.floor((x + 1) / 2) % 2 ? PALETTE.y : PALETTE.k);
				rect(ctx, at.x - 13, at.y, 27, 2, PALETTE.k);
				rect(ctx, at.x - 12, at.y, 25, 1, PALETTE.l);
				for (const side of [-1, 1]) {
					const x = at.x + side * 9 - 2;

					box(ctx, x, at.y - REACTOR.tall + 4, 5, REACTOR.tall - 4, PALETTE.m);
					for (let lamp = 0; lamp < 4; lamp++) {
						const lit = busy && (Math.floor(time * 8) + lamp) % 4 === 0;

						rect(ctx, x + 1, at.y - 4 - lamp * 4, 3, 2, lit ? `hsl(${hue} 80% 70%)` : PALETTE.d);
					}
				}
				box(ctx, at.x - 5, at.y - REACTOR.tall, 11, REACTOR.tall, '#0d1520');
				for (let y = at.y - REACTOR.tall + 3; y < at.y - 2; y++) {
					const band = busy && (y + Math.floor(time * 18)) % 6 < 2;

					rect(ctx, at.x - 3, y, 7, 1, band ? PALETTE.W : core);
				}
				rect(ctx, at.x - 4, at.y - REACTOR.tall + 2, 1, REACTOR.tall - 4, 'rgba(255, 255, 255, 0.12)');
				box(ctx, at.x - 7, at.y - REACTOR.tall - 2, 15, 3, PALETTE.l);
				if (busy)
					for (const vent of [-4, 3]) {
						const puff = (time * 1.4 + (vent > 0 ? 0.5 : 0)) % 1;

						ctx.globalAlpha = 0.5 * (1 - puff);
						rect(
							ctx,
							at.x + vent + (Math.floor(puff * 4) % 2),
							at.y - REACTOR.tall - 4 - Math.round(puff * 7),
							2,
							2,
							PALETTE.W,
						);
						ctx.globalAlpha = 1;
					}
				if (busy) pixelEllipse(ctx, at.x, at.y + 1, 14, 3, `hsla(${hue}, 80%, 60%, 0.10)`);
				if (engine.link !== undefined) {
					const bars = engine.link === null ? 0 : 3 - [250, 1000, Infinity].findIndex(most => engine.link < most);
					const color = [PALETTE.r, PALETTE.r, PALETTE.y, PALETTE.t][bars];

					for (let bar = 0; bar < 3; bar++)
						rect(ctx, at.x + 14 + bar * 2, at.y - 8 - bar * 2, 1, 2 + bar * 2, bar < bars ? color : PALETTE.d);
				}
				if (zoom >= 3)
					label(engine.name, at, { color: `hsl(${hue} 50% 74%)`, align: 'center', lift: -5, gap: 4, size: 1 });
				if (engine.outage)
					label(engine.outage, at, {
						color: PALETTE.r,
						align: 'center',
						lift: REACTOR.tall + 4,
						gap: -2,
						width: room.w * UNIT.x - 4,
					});
			},
		})),
		{
			y: recyclerAt(room).y,
			draw: () => {
				const jaw = recycling ? Math.round(Math.abs(Math.sin(time * 10)) * 3) : 0;

				box(ctx, recycler.x - 9, recycler.y - 14, 18, 14, PALETTE.m);
				rect(ctx, recycler.x - 7, recycler.y - 12, 14, 5, '#0b0e13');
				for (let tooth = 0; tooth < 4; tooth++) {
					rect(ctx, recycler.x - 6 + tooth * 4, recycler.y - 12 + jaw, 2, 2, PALETTE.l);
					rect(ctx, recycler.x - 6 + tooth * 4, recycler.y - 9 - jaw, 2, 2, PALETTE.l);
				}
				rect(ctx, recycler.x - 7, recycler.y - 5, 14, 1, Math.floor(time * 2) % 2 && recycling ? PALETTE.y : PALETTE.d);
				for (let x = recycler.x - 8; x < recycler.x + 8; x++)
					rect(ctx, x, recycler.y + 1, 1, 1, Math.floor((x + 1) / 2) % 2 ? PALETTE.y : PALETTE.k);
			},
		},
	];
};

// The usage console by a system's door, `at` its foot
const usagePanel = (ctx, at, { load, faulty, hue, time }) => {
	box(ctx, at.x - 2, at.y - 6, 5, 6, PALETTE.m);
	box(ctx, at.x - 11, at.y - 14, 22, 8, '#0d1218');
	rect(ctx, at.x - 9, at.y - 10, 14, 1, PALETTE.d);
	rect(ctx, at.x - 9, at.y - 10, Math.round(14 * load), 1, `hsl(${hue} 75% 64%)`);
	rect(ctx, at.x + 7, at.y - 11, 2, 3, faulty && Math.floor(time * 3) % 2 ? PALETTE.r : PALETTE.m);
};

// What a system has used up, a piece by its foot `at` for each use, tagged red when that use failed
const STOCK = {
	// Spent reels, unwound
	library: (ctx, at, { accent, bad }) => {
		box(ctx, at.x - 3, at.y - 7, 7, 7, PALETTE.d);
		rect(ctx, at.x - 1, at.y - 5, 3, 3, PALETTE.m);
		rect(ctx, at.x, at.y - 4, 1, 1, accent);
		if (bad) rect(ctx, at.x + 3, at.y - 7, 2, 2, PALETTE.r);
	},
	// Opened message capsules, their lids off
	dish: (ctx, at, { accent, bad }) => {
		box(ctx, at.x - 3, at.y - 6, 6, 6, PALETTE.l);
		rect(ctx, at.x - 2, at.y - 5, 4, 1, PALETTE.k);
		rect(ctx, at.x + 2, at.y - 9, 4, 2, PALETTE.l);
		rect(ctx, at.x - 2, at.y - 3, 4, 1, bad ? PALETTE.r : accent);
	},
	// Scraps in a bin, scorched when the edit failed
	forge: (ctx, at, { accent, bad }) => {
		box(ctx, at.x - 4, at.y - 5, 9, 5, PALETTE.m);
		rect(ctx, at.x - 3, at.y - 7, 3, 2, bad ? PALETTE.r : PALETTE.w);
		rect(ctx, at.x + 1, at.y - 6, 2, 1, bad ? PALETTE.r : accent);
	},
	// Emptied drums, their lids off; a red one leaking where the command failed
	reactor: (ctx, at, { accent, bad }) => {
		box(ctx, at.x - 3, at.y - 8, 7, 8, bad ? PALETTE.r : PALETTE.m);
		rect(ctx, at.x - 2, at.y - 7, 5, 1, PALETTE.k);
		rect(ctx, at.x - 2, at.y - 4, 5, 1, bad ? PALETTE.k : accent);
		if (bad) rect(ctx, at.x + 4, at.y - 1, 2, 1, PALETTE.r);
	},
};
// The spent stock, the newest first, each piece one of its latest uses where the log has it, tagged when that failed
const stockParts = (ctx, art, room, { key, uses, failures = 0, log = [], accent }) =>
	stockAt(room, uses).map((spot, index) => ({
		y: spot.y,
		draw: () => STOCK[key](ctx, art(spot), { accent, bad: log[index] ? log[index].failed : index < failures }),
	}));

// Each shared system, built into its room's far wall, its foot at `at`: what it does shows in how it runs
const SYSTEM_ART = {
	// The data core: a tower of storage, rings of light running down it as files are read, racks of drives either side
	library: (ctx, at, { active, accent, time }) => {
		for (const side of [-1, 1]) {
			const x = at.x + side * 20 - 4;

			box(ctx, x, at.y - 30, 9, 30, PALETTE.d);
			for (let row = 0; row < 6; row++)
				for (let led = 0; led < 2; led++)
					rect(
						ctx,
						x + 2 + led * 4,
						at.y - 27 + row * 4,
						2,
						1,
						active && noise(`${side}|${row}|${led}|${Math.floor(time * 6)}`) > 0.45 ? accent : PALETTE.m,
					);
		}
		box(ctx, at.x - 11, at.y - 42, 23, 42, PALETTE.m);
		for (const rib of [-8, 8]) rect(ctx, at.x + rib, at.y - 40, 1, 38, PALETTE.l);
		box(ctx, at.x - 4, at.y - 38, 9, 34, '#0a1118');
		for (let ring = 0; ring < 8; ring++) {
			const lit = active
				? (ring - Math.floor(time * 10)) % 8 === 0 || (ring - Math.floor(time * 10) + 4) % 8 === 0
				: ring % 4 === 0;

			rect(ctx, at.x - 3, at.y - 36 + ring * 4, 7, 2, lit ? accent : '#17303a');
		}
		box(ctx, at.x - 14, at.y - 4, 29, 5, PALETTE.l);
	},
	// Comms: a transceiver rack, its trunk up to the dish on the hull, its link lights running while the web is reached
	dish: (ctx, at, { active, accent, time, masts = [] }) => {
		rect(ctx, at.x - 2, at.y - 38, 3, 10, PALETTE.k);
		rect(ctx, at.x - 1, at.y - 38, 1, 10, active ? accent : PALETTE.m);
		box(ctx, at.x - 9, at.y - 30, 19, 22, PALETTE.m);
		rect(ctx, at.x - 7, at.y - 28, 15, 18, '#0b1016');
		for (let row = 0; row < 5; row++)
			for (let led = 0; led < 4; led++)
				rect(
					ctx,
					at.x - 6 + led * 4,
					at.y - 26 + row * 3,
					2,
					1,
					active && Math.floor(time * 8 + row * 3 + led * 7) % 5 < 2 ? accent : PALETTE.d,
				);
		box(ctx, at.x - 16, at.y - 8, 33, 8, PALETTE.l);
		masts.forEach((mast, index) => {
			const x = at.x + 22 + index * 7;

			box(ctx, x, at.y - 24, 6, 24, PALETTE.d);
			rect(ctx, x + 1, at.y - 22, 4, 3, mast.active ? mast.color : mast.dim);
			for (let row = 0; row < 4; row++)
				rect(
					ctx,
					x + 2,
					at.y - 16 + row * 4,
					2,
					1,
					mast.active && Math.floor(time * 5 + row) % 2 ? mast.color : PALETTE.m,
				);
			if (mast.faulty && Math.floor(time * 3) % 2) rect(ctx, x + 4, at.y - 2, 1, 1, PALETTE.r);
		});
	},
	// The fabricator: a press stamping each edit onto a glowing bed
	forge: (ctx, at, { active, accent, time }) => {
		const phase = (time * 1.5) % 1;
		const stroke = active ? Math.round(phase < 0.15 ? (phase / 0.15) * 10 : 10 * (1 - (phase - 0.15) / 0.85)) : 0;

		box(ctx, at.x - 20, at.y - 40, 6, 40, PALETTE.l);
		box(ctx, at.x + 14, at.y - 40, 6, 40, PALETTE.l);
		box(ctx, at.x - 20, at.y - 42, 40, 6, PALETTE.l);
		for (let x = at.x - 18; x < at.x + 18; x += 4)
			rect(ctx, x, at.y - 40, 2, 2, Math.floor(x / 4) % 2 ? PALETTE.y : PALETTE.k);
		rect(ctx, at.x - 2, at.y - 36, 4, 6 + stroke, PALETTE.m);
		box(ctx, at.x - 9, at.y - 31 + stroke, 18, 7, PALETTE.w);
		box(ctx, at.x - 12, at.y - 12, 24, 6, active ? accent : PALETTE.d);
		if (active && stroke >= 8)
			for (let spark = 0; spark < 6; spark++)
				rect(ctx, at.x - 12 + spark * 5, at.y - 14 - (spark % 3) * 2, 1, 1, spark % 2 ? PALETTE.y : PALETTE.W);
		box(ctx, at.x + 12, at.y - 6, 26, 5, PALETTE.d);
		for (let tread = 0; tread < 6; tread++)
			rect(ctx, at.x + 13 + ((tread * 4 + (active ? Math.floor(time * 10) : 0)) % 24), at.y - 5, 1, 3, PALETTE.l);
		if (active) {
			const along = (time * 0.7) % 1;

			rect(ctx, at.x + 13 + along * 18, at.y - 8, 6, 2, PALETTE.W);
		}
	},
	// The shell plant: a bank of terminals scrolling while commands run, and the engine beside them, its pistons pumping
	reactor: (ctx, at, { active, accent, time }) => {
		for (let terminal = 0; terminal < 2; terminal++) {
			const x = at.x - 30 + terminal * 16;

			box(ctx, x, at.y - 26, 14, 12, PALETTE.k);
			rect(ctx, x + 1, at.y - 25, 12, 10, '#06140f');
			if (active)
				for (let row = 0; row < 4; row++)
					rect(
						ctx,
						x + 2,
						at.y - 24 + row * 2,
						2 + Math.floor(noise(`${terminal}|${row + Math.floor(time * 6)}`) * 9),
						1,
						PALETTE.t,
					);
			else if (Math.floor(time * 2) % 2) rect(ctx, x + 2, at.y - 18, 2, 1, PALETTE.t);
			box(ctx, x + 2, at.y - 14, 10, 14, PALETTE.m);
		}
		box(ctx, at.x + 4, at.y - 34, 28, 34, PALETTE.d);
		for (let piston = 0; piston < 2; piston++) {
			const x = at.x + 8 + piston * 12;
			const lift = active ? Math.round((Math.sin(time * 9 + piston * Math.PI) + 1) * 4) : 0;

			box(ctx, x, at.y - 30, 8, 22, '#0d1218');
			box(ctx, x + 2, at.y - 26 + lift, 4, 10, PALETTE.l);
			rect(ctx, x + 3, at.y - 30, 2, lift + 4, PALETTE.w);
		}
		rect(ctx, at.x + 6, at.y - 6, 24, 2, active ? accent : PALETTE.m);
		if (active)
			for (let puff = 0; puff < 2; puff++) {
				const rise = (time * 0.8 + puff / 2) % 1;

				ctx.fillStyle = `rgba(220, 225, 235, ${(0.4 * (1 - rise)).toFixed(2)})`;
				ctx.fillRect(Math.round(at.x + 18 + puff * 4), Math.round(at.y - 36 - rise * 12), 2, 2);
			}
	},
};

// The power main along the hull overhead, down into the system, and the plinth it's bolted to; the first in its row
// has the main come to it from the reactors
const mount = (ctx, art, room, at, { active, accent, time }) => {
	const ceiling = art({ x: 0, y: room.y }).y + 1;
	const right = art({ x: room.x + room.w, y: 0 }).x;
	const left = art({ x: room.feed ?? room.x, y: 0 }).x;
	const main = ceiling + 6;
	const top = at.y - 33;

	rect(ctx, left, main - 4, right - left, 9, PALETTE.k);
	rect(ctx, left, main - 3, right - left, 7, PALETTE.d);
	rect(ctx, left, main - 3, right - left, 1, PALETTE.l);
	rect(ctx, left, main + 3, right - left, 1, '#0b0e13');
	for (let x = left + 4; x < right; x += 14) rect(ctx, x, ceiling, 1, main - 4 - ceiling, PALETTE.m);
	rect(ctx, right - 2, main - 5, 2, 11, PALETTE.l);
	rect(ctx, left - 4, main - 4, 9, 18, PALETTE.k);
	rect(ctx, left - 3, main - 3, 7, 17, PALETTE.d);
	rect(ctx, left - 5, main + 12, 11, 2, PALETTE.l);
	if (active) for (let x = left + (Math.floor(time * 30) % 7); x < right - 2; x += 7) rect(ctx, x, main, 3, 1, accent);
	rect(ctx, at.x - 4, main + 4, 9, top - main - 4, PALETTE.k);
	rect(ctx, at.x - 3, main + 4, 7, top - main - 4, PALETTE.d);
	rect(ctx, at.x - 3, main + 4, 1, top - main - 4, PALETTE.m);
	for (const y of [main + 5, top - 2]) rect(ctx, at.x - 6, y, 13, 2, PALETTE.l);
	if (active)
		for (let y = main + 6 + (Math.floor(time * 24) % 5); y < top - 2; y += 5) rect(ctx, at.x, y, 1, 2, accent);
	rect(ctx, at.x - 25, at.y, 51, 3, PALETTE.k);
	rect(ctx, at.x - 24, at.y, 49, 1, PALETTE.l);
	rect(ctx, at.x - 24, at.y + 1, 49, 1, PALETTE.m);
	rect(ctx, at.x - 28, at.y + 3, 57, 2, PALETTE.k);
	for (let x = at.x - 22; x < at.x + 24; x += 9) rect(ctx, x, at.y + 1, 1, 1, PALETTE.w);
};

// A compact system's mount: the main along the ceiling from its reactor, a short drop into the machine, a plinth
const compactMount = (ctx, art, room, at, { active, accent, time }) => {
	const ceiling = art({ x: 0, y: room.y }).y + 1;
	const right = art({ x: room.x + room.w, y: 0 }).x;
	const left = art({ x: room.feed ?? room.x, y: 0 }).x;
	const main = ceiling + 6;
	const top = at.y - systemTallOf(room);

	rect(ctx, left, main - 3, right - left, 7, PALETTE.k);
	rect(ctx, left, main - 2, right - left, 5, PALETTE.d);
	rect(ctx, left, main - 2, right - left, 1, PALETTE.l);
	rect(ctx, right - 1, main - 4, 1, 9, PALETTE.l);
	if (active) for (let x = left + (Math.floor(time * 30) % 7); x < right - 2; x += 7) rect(ctx, x, main, 3, 1, accent);
	rect(ctx, at.x - 2, main + 3, 5, top - main - 3, PALETTE.k);
	rect(ctx, at.x - 1, main + 3, 3, top - main - 3, active ? accent : PALETTE.d);
	rect(ctx, at.x - 11, at.y, 23, 2, PALETTE.k);
	rect(ctx, at.x - 10, at.y, 21, 1, PALETTE.l);
};

// Each compact system a small machine of its kind, `at` its foot and `tall` its height, running while it's used
const COMPACT_ART = {
	// A drive tower, its bays lit in a band running down it as files are read, a rack of blinking lamps beside it
	library: (ctx, at, { active, accent, time, tall }) => {
		box(ctx, at.x - 6, at.y - tall, 9, tall, PALETTE.d);
		for (let bay = 0; bay < 5; bay++) {
			const y = at.y - tall + 2 + bay * 3;
			const lit = active && (Math.floor(time * 8) % 6 === bay || Math.floor(time * 8) % 6 === bay + 1);

			rect(ctx, at.x - 4, y, 5, 2, '#0d1218');
			rect(ctx, at.x - 3, y, 3, 1, lit ? accent : PALETTE.m);
		}
		box(ctx, at.x + 3, at.y - tall + 4, 6, tall - 4, PALETTE.m);
		for (let lamp = 0; lamp < 4; lamp++) {
			const on = active ? Math.sin(time * (5 + lamp * 1.7) + lamp * 2) > 0 : lamp === 0;

			rect(ctx, at.x + 5, at.y - tall + 6 + lamp * 3, 2, 1, on ? accent : PALETTE.d);
		}
	},
	// A press over a sheet in its bed: the ram comes down on it while files are edited, sparks flying where it strikes
	forge: (ctx, at, { active, accent, time, tall }) => {
		const stroke = active ? Math.abs(Math.sin(time * 6)) : 0.2;
		const ram = Math.round(at.y - tall + 4 + stroke * 5);

		box(ctx, at.x - 9, at.y - tall, 3, tall, PALETTE.m);
		box(ctx, at.x + 7, at.y - tall, 3, tall, PALETTE.m);
		box(ctx, at.x - 7, at.y - tall, 15, 3, PALETTE.l);
		rect(ctx, at.x - 1, at.y - tall + 3, 3, ram - (at.y - tall + 3), PALETTE.l);
		box(ctx, at.x - 5, ram, 11, 3, PALETTE.d);
		box(ctx, at.x - 7, at.y - 5, 15, 5, PALETTE.d);
		rect(ctx, at.x - 4, at.y - 6, 9, 1, PALETTE.w);
		if (active && stroke > 0.9)
			for (const [dx, dy] of [
				[-6, -8],
				[6, -9],
				[-4, -10],
				[5, -7],
			])
				rect(ctx, at.x + dx, at.y + dy, 1, 1, accent);
	},
	// Two drums, their pistons pumping in turn while commands run, and a gauge whose needle swings with them
	reactor: (ctx, at, { active, accent, time, tall }) => {
		for (const side of [-1, 1]) {
			const x = at.x + side * 5 - 3;
			const pump = active ? Math.round((Math.sin(time * 7 + (side > 0 ? Math.PI : 0)) + 1) * 2) : 0;

			box(ctx, x, at.y - 10, 7, 10, PALETTE.m);
			rect(ctx, x + 1, at.y - 7, 5, 1, PALETTE.d);
			rect(ctx, x + 1, at.y - 4, 5, 1, active ? accent : PALETTE.d);
			rect(ctx, x + 3, at.y - 13 - pump, 1, 3 + pump, PALETTE.l);
			rect(ctx, x + 2, at.y - 14 - pump, 3, 1, PALETTE.w);
		}
		box(ctx, at.x - 3, at.y - tall, 7, 6, '#0d1218');

		const swing = active ? Math.sin(time * 3) : -0.8;

		rect(ctx, at.x + Math.round(swing * 2), at.y - tall + 2, 1, 2, accent);
		rect(ctx, at.x, at.y - tall + 4, 1, 1, PALETTE.w);
	},
	// A transceiver rack, its lamps chattering, a little dish on top turning and sending rings out while it's used
	dish: (ctx, at, { active, accent, time, tall }) => {
		box(ctx, at.x - 6, at.y - tall + 6, 13, tall - 6, PALETTE.d);
		for (let row = 0; row < 3; row++)
			for (let lamp = 0; lamp < 3; lamp++) {
				const on = active && seededLamp(row, lamp, Math.floor(time * 6));

				rect(ctx, at.x - 4 + lamp * 4, at.y - tall + 9 + row * 3, 2, 1, on ? accent : PALETTE.m);
			}

		const facing = active ? [-1, 0, 1, 0][Math.floor(time * 2) % 4] : 0;

		rect(ctx, at.x, at.y - tall + 3, 1, 3, PALETTE.l);
		rect(ctx, at.x - 3 + facing, at.y - tall + 1, 7, 1, PALETTE.w);
		rect(ctx, at.x - 2 + facing, at.y - tall + 2, 5, 1, PALETTE.l);
		if (active) {
			const ring = (time * 1.5) % 1;

			ctx.globalAlpha = 1 - ring;
			rect(ctx, at.x - 2 - Math.round(ring * 6), at.y - tall - Math.round(ring * 3), 1, 1, accent);
			rect(ctx, at.x + 2 + Math.round(ring * 6), at.y - tall - Math.round(ring * 3), 1, 1, accent);
			rect(ctx, at.x, at.y - tall - 1 - Math.round(ring * 5), 1, 1, accent);
			ctx.globalAlpha = 1;
		}
	},
};

// Whether a rack lamp is lit this tick: chattering, as a rack's do
const seededLamp = (row, lamp, tick) => (row * 7 + lamp * 13 + tick * 29) % 11 < 5;

const drawCompactUnit = (ctx, at, room, { active, accent, time, load = 0, failures = 0, hue }) => {
	const tall = systemTallOf(room);

	COMPACT_ART[room.key](ctx, at, { active, accent, time, tall });
	// Its load along the plinth, and a lamp blinking red once a use has failed
	rect(ctx, at.x - 9, at.y + 2, 16, 1, PALETTE.d);
	rect(ctx, at.x - 9, at.y + 2, Math.round(16 * load), 1, `hsl(${hue} 75% 64%)`);
	rect(ctx, at.x + 8, at.y + 1, 2, 2, failures > 0 && Math.floor(time * 3) % 2 ? PALETTE.r : PALETTE.m);
};

// A system's room: one engine's full size, with its console and its spent stock; more engines' compact
export const drawSystem = (ctx, art, label, room, { time, system }) => {
	floor(ctx, art, room);

	const hue = system.hue;
	const accent = `hsl(${hue} 75% 64%)`;
	const foot = systemFootOf(room);

	return [
		...walls(ctx, art, label, room, { name: room.name, color: `hsl(${hue} 55% 74%)` }),
		{
			y: foot.y,
			draw: () => {
				const at = art(foot);
				const door = art({ x: room.door.x, y: room.door.side === 'bottom' ? room.y + room.d : room.y + FACE });

				rect(ctx, at.x, at.y + 2, door.x - at.x, 1, `hsl(${hue} 30% 28%)`);
				rect(ctx, door.x, Math.min(at.y + 2, door.y), 1, Math.abs(door.y - at.y - 2), `hsl(${hue} 30% 28%)`);
				if (room.compact) {
					compactMount(ctx, art, room, at, { active: system.active, accent, time });
					drawCompactUnit(ctx, at, room, { ...system, accent, time });

					return;
				}
				mount(ctx, art, room, at, { active: system.active, accent, time });
				SYSTEM_ART[room.key](ctx, at, { active: system.active, accent, time, masts: system.masts });
				usagePanel(ctx, art(panelAt(room)), { ...system, faulty: system.failures > 0, time });
			},
		},
		...stockParts(ctx, art, room, { ...system, key: room.key, accent }),
	];
};

// A notice from the other ships on the transporter console's screen, `at` the screen's foot: an amber mark while one of
// theirs asks something, an envelope while there's news, flashing, and how many on the console under it
const drawNotice = (ctx, at, { count, color, mark }, label) => {
	const { x, y, blink } = at;

	rect(ctx, x - 5, y - 10, 10, 10, blink ? color : PALETTE.k);
	rect(ctx, x - 4, y - 9, 8, 8, blink ? PALETTE.k : color);
	if (!blink) {
		label(String(count), { x, y: y + 6 }, { color, size: 1, align: 'center' });

		return;
	}
	if (mark === 'ask') {
		rect(ctx, x - 1, y - 8, 1, 4, color);
		rect(ctx, x - 1, y - 3, 1, 1, color);
	} else
		for (let step = 0; step < 3; step++) {
			rect(ctx, x - 4 + step, y - 8 + step, 1, 1, color);
			rect(ctx, x + 2 - step, y - 8 + step, 1, 1, color);
		}
	label(String(count), { x, y: y + 6 }, { color, size: 1, align: 'center' });
};

// The transporter: a pad beaming someone to or from another ship (`beaming`, 0 to 1, its beam in that ship's color,
// `hue`: the one you're going to, or this one as you arrive), a console with a light for each other ship (`ships`) in
// its color, and over it a notice while any of them has something for you
export const drawTransporter = (ctx, art, label, room, { time, ships = [], beaming = null, hue = null }) => {
	if (!room.within) floor(ctx, art, room);

	const pad = clonerAt(room);
	const beam = Number.isFinite(hue) ? `hsl(${hue} 70% 76%)` : '#c9b6ff';
	// What the other ships have for you: those asking something first, then news
	const needs = ships.reduce((sum, { needs: count = 0 }) => sum + count, 0);
	const news = ships.reduce((sum, { news: count = 0 }) => sum + count, 0);
	const notice =
		(needs && { count: needs, color: PALETTE.y, mark: 'ask' }) ||
		(news && { count: news, color: PALETTE.b, mark: 'news' });

	return [
		...(room.within
			? stationName(art, label, room, PALETTE.p)
			: walls(ctx, art, label, room, { name: room.name, color: PALETTE.p })),
		{
			y: pad.y,
			draw: () => {
				const at = art(pad);
				const x = at.x - 6;

				pixelEllipse(ctx, x, at.y, 12, 4, PALETTE.k);
				pixelEllipse(ctx, x, at.y, 11, 3, PALETTE.m);
				pixelEllipse(ctx, x, at.y, 8, 2, PALETTE.P);
				pixelEllipse(ctx, x, at.y, 5, 1, beaming !== null ? PALETTE.W : PALETTE.p);
				for (let light = 0; light < 8; light++) {
					const angle = (light / 8) * Math.PI * 2;
					const on = Math.floor(time * 6) % 8 === light;

					rect(
						ctx,
						Math.round(x + Math.cos(angle) * 10),
						Math.round(at.y + Math.sin(angle) * 3),
						1,
						1,
						(on && PALETTE.W) || (notice && Math.floor(time * 2) % 2 && notice.color) || PALETTE.p,
					);
				}
				for (const side of [-1, 1]) {
					rect(ctx, x + side * 12 - 1, at.y - 22, 3, 22, PALETTE.k);
					rect(ctx, x + side * 12, at.y - 21, 1, 20, PALETTE.l);
					rect(ctx, x + side * 12, at.y - 23, 1, 2, beaming !== null || Math.floor(time * 2) % 2 ? beam : PALETTE.p);
				}
				if (beaming !== null) {
					ctx.globalAlpha = 0.25 + 0.5 * Math.sin(beaming * Math.PI);
					rect(ctx, x - 9, at.y - 30, 19, 30, beam);
					for (let spark = 0; spark < 10; spark++)
						rect(
							ctx,
							x - 9 + ((spark * 5 + Math.floor(time * 20)) % 19),
							at.y - 4 - ((spark * 7 + Math.floor(time * 40)) % 26),
							1,
							1,
							PALETTE.W,
						);
					ctx.globalAlpha = 1;
				}
				box(ctx, at.x + 10, at.y - 22, 12, 22, PALETTE.m);
				rect(ctx, at.x + 11, at.y - 21, 10, 11, '#0b1016');
				rect(ctx, at.x + 11, at.y - 21, 10, 1, PALETTE.p);
				ships.forEach((ship, index) => {
					const blink = Math.floor(time * 3) % 2;
					const color =
						(ship.needs && (blink ? PALETTE.y : PALETTE.Y)) ||
						(ship.news && PALETTE.b) ||
						(ship.working && PALETTE.t) ||
						(Number.isFinite(ship.hue) && `hsl(${ship.hue} 50% 42%)`) ||
						PALETTE.d;

					rect(ctx, at.x + 12 + (index % 3) * 3, at.y - 18 + Math.floor(index / 3) * 3, 2, 2, color);
				});
				rect(ctx, at.x + 12, at.y - 8, 8, 2, PALETTE.d);
				if (notice) drawNotice(ctx, { x: at.x + 16, y: at.y - 11, blink: Math.floor(time * 2) % 2 }, notice, label);
			},
		},
	];
};

// The materializer's room, the materializer in its middle
// Standing on the bridge, short names that fit over the narrow stations side by side; the materializer's cloner names
// itself
const STATION_NAMES = { materializer: null, transporter: 'beam' };

// Standing on the bridge (`room.within`), no floor or walls of its own: its hardware on the bridge's floor, named
const stationName = (art, label, room, color) => {
	const name = Object.hasOwn(STATION_NAMES, room.kind) ? STATION_NAMES[room.kind] : room.name;

	if (!name) return [];
	label(name, art({ x: room.x + room.w / 2, y: room.y + 0.3 }), {
		color,
		align: 'center',
		size: 1,
	});

	return [];
};

export const drawMaterializer = (ctx, art, label, room, { time, charge }) => {
	if (!room.within) floor(ctx, art, room);

	return [
		...(room.within
			? stationName(art, label, room, PALETTE.t)
			: walls(ctx, art, label, room, { name: room.name, color: PALETTE.t })),
		{ y: clonerAt(room).y, draw: () => drawCloner(ctx, art(clonerAt(room)), { time, charge }) },
	];
};

// The materializer, where a new session's worker is made, its rings rising faster the more it's charged
const drawCloner = (ctx, { x, y }, { time, charge }) => {
	pixelEllipse(ctx, x, y, 8, 3, PALETTE.k);
	pixelEllipse(ctx, x, y, 7, 2, PALETTE.m);
	pixelEllipse(ctx, x, y, 4, 1, charge ? PALETTE.t : PALETTE.T);
	for (const side of [-1, 1]) {
		rect(ctx, x + side * 6 - 1, y - 18, 2, 18, PALETTE.k);
		rect(ctx, x + side * 6, y - 17, 1, 16, PALETTE.l);
		rect(ctx, x + side * 6, y - 19, 1, 2, charge && Math.floor(time * 6) % 2 ? PALETTE.W : PALETTE.t);
	}
	rect(ctx, x - 6, y - 20, 13, 2, PALETTE.k);
	ctx.fillStyle = 'rgba(150, 220, 230, 0.10)';
	ctx.fillRect(x - 5, y - 18, 11, 17);
	for (let ring = 0; ring < 2; ring++) {
		const rise = (time * (0.4 + charge * 1.6) + ring / 2) % 1;

		ctx.globalAlpha = charge ? 0.9 : 0.35;
		rect(ctx, x - 4, Math.round(y - 2 - rise * 15), 9, 1, PALETTE.t);
		ctx.globalAlpha = 1;
	}
};

// The hold: loading bay markings on its floor, where each checkout's cargo stacks (drawn with the cargo)
export const drawHold = (ctx, art, label, room) => {
	floor(ctx, art, room);

	const [from, to] = corners(art, room);

	for (let x = from.x + 4; x < to.x - 4; x++)
		rect(ctx, x, to.y - 12, 1, 1, Math.floor(x / 3) % 2 ? PALETTE.Y : '#26231d');

	return walls(ctx, art, label, room, { name: room.name, color: PALETTE.o });
};

// The tug that waits on the pad, `at` its foot: a stubby craft, its hull ribbed, a lit cockpit at its nose, fins at its
// tail, legs down on the pad, its engine idling and a beacon blinking on its back; `flying`, its legs tucked and its
// jets lit, and `aft`, turned to fly toward the stern
export const drawTug = (ctx, at, time, { flying = false, aft = false } = {}) => {
	if (aft) {
		ctx.save();
		ctx.translate(at.x * 2, 0);
		ctx.scale(-1, 1);
		drawTug(ctx, at, time, { flying });
		ctx.restore();

		return;
	}

	const { x, y } = at;
	const top = y - 9;

	// Its legs, down on the pad, tucked up flying; under it, flying, its lift jets' glow
	if (flying) for (const jet of [x - 6, x + 4]) rect(ctx, jet, y - 2, 2, 2 + (Math.floor(time * 12) % 2), PALETTE.Y);
	else
		for (const leg of [x - 6, x + 5]) {
			rect(ctx, leg, y - 3, 1, 3, PALETTE.k);
			rect(ctx, leg - 1, y - 1, 3, 1, PALETTE.k);
		}
	// Its fins, aft, and its engine's glow
	rect(ctx, x - 12, top + 1, 3, 3, PALETTE.k);
	rect(ctx, x - 12, top + 6, 3, 3, PALETTE.k);
	rect(ctx, x - 11, top + 2, 1, 1, PALETTE.l);
	rect(ctx, x - 11, top + 7, 1, 1, PALETTE.l);
	rect(ctx, x - 13 - (flying ? 2 : 0), top + 4, flying ? 4 : 2, 2, Math.floor(time * 6) % 2 ? PALETTE.Y : PALETTE.o);
	// Its hull: outlined, lit along its top, shaded under, ribbed
	rect(ctx, x - 10, top, 18, 7, PALETTE.k);
	rect(ctx, x + 8, top + 1, 2, 5, PALETTE.k);
	rect(ctx, x - 9, top + 1, 17, 5, PALETTE.l);
	rect(ctx, x - 9, top + 1, 17, 1, PALETTE.W);
	rect(ctx, x - 9, top + 4, 17, 1, PALETTE.Y);
	rect(ctx, x - 9, top + 5, 17, 1, PALETTE.m);
	for (let rib = x - 6; rib < x + 4; rib += 4) rect(ctx, rib, top + 2, 1, 2, PALETTE.m);
	// Its cockpit, at the nose
	rect(ctx, x + 4, top + 2, 4, 3, PALETTE.k);
	rect(ctx, x + 5, top + 2, 3, 2, '#7fd6ff');
	rect(ctx, x + 5, top + 2, 1, 1, '#e0f6ff');
	// Its beacon
	rect(ctx, x - 2, top - 1, 2, 1, Math.floor(time * 2) % 2 ? '#ff4a3a' : '#5a1a16');
};

// How many lights chase round the hangar's pad, and how tall its arch stands, in art pixels
const PAD_LIGHTS = 12;
const ARCH_TALL = 14;

// The hangar: its landing pad under an arch, lights chasing round it, and the tug waiting on it, unless it's away
// (`tugAway`); its doors are in the hull below
export const drawHangar = (ctx, art, label, room, { time, journey, launching = false, tugAway = false }) => {
	floor(ctx, art, room);

	const pad = art(padAt(room));

	return [
		...walls(ctx, art, label, room, { name: room.name, color: PALETTE.y }),
		// Its count of what's gone out, the sign atop the pad's arch
		stationLog(ctx, art, label, room, journey, { x: pad.x, y: pad.y - ARCH_TALL + 2 }),
		{
			y: padAt(room).y,
			draw: () => {
				// Its arch over the pad, its sign atop it, a warning lamp at each end lit while a pod's going out
				for (const side of [-22, 21]) {
					rect(ctx, pad.x + side, pad.y - ARCH_TALL, 2, ARCH_TALL, PALETTE.k);
					rect(ctx, pad.x + side, pad.y - ARCH_TALL + 1, 1, ARCH_TALL - 2, PALETTE.l);
					rect(
						ctx,
						pad.x + side,
						pad.y - ARCH_TALL - 2,
						2,
						2,
						launching && Math.floor(time * 6) % 2 ? '#ff4a3a' : '#5a1a16',
					);
				}
				rect(ctx, pad.x - 22, pad.y - ARCH_TALL, 45, 2, PALETTE.k);
				rect(ctx, pad.x - 21, pad.y - ARCH_TALL, 43, 1, PALETTE.m);
				// The pad: its ring, a light chasing round it, faster and brighter while a pod's going out
				pixelEllipse(ctx, pad.x, pad.y, 18, 5, PALETTE.Y);
				pixelEllipse(ctx, pad.x, pad.y, 16, 4, '#1d222b');
				pixelEllipse(ctx, pad.x, pad.y, 10, 2, '#2a3040');
				for (let light = 0; light < PAD_LIGHTS; light++) {
					const angle = (light / PAD_LIGHTS) * Math.PI * 2;
					const lit = Math.floor(time * (launching ? 16 : 5)) % PAD_LIGHTS === light;
					const resting = launching ? PALETTE.Y : PALETTE.o;

					rect(
						ctx,
						Math.round(pad.x + Math.cos(angle) * 17),
						Math.round(pad.y + Math.sin(angle) * 4.5),
						1,
						1,
						lit ? PALETTE.W : resting,
					);
				}
				if (!tugAway) drawTug(ctx, { x: pad.x, y: pad.y + 1 }, time);
			},
		},
	];
};

// The lounge: a TV and couches of two facing it, so whoever sits on one has their back to the viewer
// `lifted`: how far up each couch still is (art pixels, by its index), dropping out of the tube onto its place;
// `gone`: the indices of couches not to draw, being zapped to ash (drawn crumbling by their zap) or lying in it
// One of the mother hub's games, as an arcade cabinet against the lounge's near wall, seen side on, its screen turned
// out from its island to where its player stands, so that, as with the TV, only the light it throws shows: its
// silhouette (the tall back, the marquee's hood jutting forward over the screen's slanted bezel, the control deck out
// at the player's waist, the kick plate at its foot) with the side panel in its game's colors and a stripe of side art,
// and while the game's on, a flickering cone of its color spilling from the screen onto whoever's playing
// Each game's icon, loaded once by its address: drawn once it has come, nothing until then (or if it never does)
const icons = new Map();

const iconOf = address => {
	if (!address || typeof Image === 'undefined') return null;
	if (!icons.has(address)) {
		const image = new Image();

		// Loaded, not sized: an SVG with no size of its own reports a width of 0
		image.onload = () => (image.ready = true);
		image.src = address;
		icons.set(address, image);
	}

	const image = icons.get(address);

	return image.ready ? image : null;
};

// A cabinet's side art: its game's icon shrunk to ART pixels square (its shape kept) and each pixel put to one of three
// tones by how light it is among the icon's own (1 dark, 2 mid, 3 light; 0 where it's clear), worked out once per icon
const ART = 8;

const tonesOf = image => {
	if (image.tones) return image.tones;

	const canvas = Object.assign(document.createElement('canvas'), { width: ART, height: ART });
	const paint = canvas.getContext('2d', { willReadFrequently: true });
	const wide = image.naturalWidth || 1;
	const tall = image.naturalHeight || 1;
	const scale = ART / Math.max(wide, tall);
	const [width, height] = [Math.max(1, Math.round(wide * scale)), Math.max(1, Math.round(tall * scale))];

	paint.drawImage(image, Math.floor((ART - width) / 2), Math.floor((ART - height) / 2), width, height);

	let pixels;

	try {
		pixels = paint.getImageData(0, 0, ART, ART).data;
	} catch {
		return (image.tones = new Array(ART * ART).fill(0));
	}

	const light = Array.from({ length: ART * ART }, (_, at) =>
		pixels[at * 4 + 3] < 110 ? null : 0.3 * pixels[at * 4] + 0.59 * pixels[at * 4 + 1] + 0.11 * pixels[at * 4 + 2],
	);
	const seen = light.filter(value => value !== null);
	const [least, most] = [Math.min(...seen), Math.max(...seen)];
	const spread = most - least;

	image.tones = light.map(value => {
		if (value === null) return 0;
		// All one lightness (a silhouette): the trim, whatever its color
		if (spread < 24) return 2;

		const share = (value - least) / spread;

		if (share < 0.34) return 1;

		return share < 0.72 ? 2 : 3;
	});

	return image.tones;
};

const cabinetPart = (ctx, art, lounge, cabinet, index, time) => {
	const foot = cabinetAt(lounge, index);
	const facing = cabinetFacing(index);

	return {
		y: foot.y,
		draw: () => {
			const at = art(foot);
			// Its project's colors, as the ship has them, where it's one of this paude's projects; else the game's own
			const tints = tintsOf(cabinet.hue);
			// A mid tone of it, light enough to stand off the dark floor
			const body = cabinet.hue !== null && cabinet.hue !== undefined ? `hsl(${cabinet.hue} 30% 30%)` : '#3a404c';
			const trim = tints?.accent ?? cabinet.color ?? 'hsl(280 60% 62%)';
			// x across the profile, from its back (0) to its front (11), turned to face its player
			const x = from => at.x + facing * (from - 6);
			const span = (from, to, y, h, color) =>
				rect(ctx, Math.min(x(from), x(to)), y, Math.abs(x(to) - x(from)) + 1, h, color);
			const top = at.y - 36;

			if (cabinet.running) {
				// A low, slow shimmer, as a screen's glow on the floor, not a strobe
				const flicker = 0.07 + 0.02 * Math.sin(time * 1.3 + index * 1.9) + 0.008 * Math.sin(time * 3.1 + index);

				ctx.fillStyle = trim;
				ctx.globalAlpha = Math.max(0.05, flicker);
				ctx.beginPath();
				ctx.moveTo(x(13), top + 10);
				ctx.lineTo(x(30), top + 2);
				ctx.lineTo(x(30), at.y);
				ctx.lineTo(x(14), top + 24);
				ctx.closePath();
				ctx.fill();
				ctx.globalAlpha = 1;
			}
			// The outline, then the side panel inside it: back, hood, bezel, deck and the lower front
			span(0, 9, top, 1, PALETTE.k);
			span(0, 14, top + 1, 6, PALETTE.k);
			span(0, 11, top + 7, 13, PALETTE.k);
			span(0, 16, top + 20, 4, PALETTE.k);
			span(0, 12, top + 24, 12, PALETTE.k);
			span(1, 8, top + 1, 1, body);
			span(1, 13, top + 2, 4, body);
			span(1, 10, top + 7, 13, body);
			span(1, 15, top + 21, 2, body);
			span(1, 11, top + 24, 11, body);
			// The marquee's lit edge under the hood, and the screen's bezel slanting back below it, lit while it's on
			span(11, 13, top + 6, 1, cabinet.running ? trim : PALETTE.d);
			for (let row = 0; row < 13; row++)
				span(10 - Math.floor(row / 5), 10 - Math.floor(row / 5), top + 7 + row, 1, cabinet.running ? trim : PALETTE.d);
			// The side art: the game's own icon on the panel when it has one (never mirrored, so it reads the same on
			// either side of an island), a stripe of its color sweeping down past it
			const icon = iconOf(cabinet.icon);
			// Its game off, nothing of it is lit: the side art is there, in a dull tone of its color, not glowing
			const sideArt =
				(cabinet.running && trim) ||
				(cabinet.hue !== null && cabinet.hue !== undefined ? `hsl(${cabinet.hue} 22% 34%)` : PALETTE.m);

			span(2, 4, top + 3, 1, sideArt);
			span(2, 3, top + 4, icon ? 4 : 14, sideArt);
			if (icon) {
				// Printed on the panel in its own colors, as a cabinet's side art is: dark, its trim, and a pale wash of it
				const tones = tonesOf(icon);

				for (let row = 0; row < ART; row++)
					for (let column = 0; column < ART; column++) {
						const tone = tones[row * ART + column];

						if (!tone) continue;

						const at = { x: 1 + column, y: top + 9 + row };

						span(at.x, at.x, at.y, 1, tone === 1 ? PALETTE.k : sideArt);
						if (tone === 3 && cabinet.running) {
							ctx.globalAlpha = 0.55;
							span(at.x, at.x, at.y, 1, '#ffffff');
							ctx.globalAlpha = 1;
						}
					}
			} else span(3, 5, top + 18, 1, sideArt);
			span(4, 9, top + 26, 1, sideArt);
			// The deck's edge, a stick standing up from it, and the kick plate
			span(13, 15, top + 20, 1, PALETTE.m);
			span(13, 13, top + 17, 3, PALETTE.m);
			span(12, 14, top + 16, 1, cabinet.running ? 'hsl(0 70% 55%)' : 'hsl(0 30% 34%)');
			span(1, 11, top + 33, 2, 'rgba(0, 0, 0, 0.45)');
			if (cabinet.players && Math.floor(time * 0.8 + index) % 2) span(6, 7, top + 3, 1, PALETTE.W);
		},
	};
};

export const drawLounge = (ctx, art, label, lounge, { time, lifted = [], gone = new Set(), shifts = [] }) => {
	floor(ctx, art, lounge);

	const couches = [];

	// One couch at least, waiting when nobody's on it
	for (let index = 0; index < Math.max(lounge.count, 1); index += 2) {
		if (gone.has(index / 2)) continue;

		const first = art(loungeSeatAt(lounge, index));
		// Sliding to its place from where it stood: how far it still is from it, in art pixels
		const shift = shifts[index / 2] ?? { x: 0, y: 0 };

		couches.push({
			x: first.x + shift.x - Math.round(COUCH_SEAT * UNIT.x) / 2,
			y: first.y + shift.y - Math.round(lifted[index / 2] ?? 0),
			seat: loungeSeatAt(lounge, index),
			landed: !lifted[index / 2],
		});
	}

	const width = Math.round(COUCH_SEAT * UNIT.x * 2);
	const fabric = ['hsl(14 38% 34%)', 'hsl(14 38% 42%)', 'hsl(14 38% 26%)'];
	const television = { x: lounge.x + lounge.w / 2 - 0.3, y: lounge.y + lounge.d - 0.15 };

	return [
		...walls(ctx, art, label, lounge, { name: lounge.name, color: 'hsl(14 55% 72%)' }),
		...propParts(ctx, art, lounge, { color: 'hsl(14 55% 60%)', time }),
		{
			y: lounge.y + 0.005,
			draw: () => {
				for (const couch of couches.filter(({ landed }) => landed)) {
					rect(ctx, couch.x - 4, couch.y - 6, width + 8, 13, PALETTE.k);
					rect(ctx, couch.x - 3, couch.y - 6, width + 6, 11, '#1a202c');
					rect(ctx, couch.x - 3, couch.y - 6, width + 6, 1, PALETTE.m);
				}
			},
		},
		{
			y: television.y,
			draw: () => {
				const at = art(television);
				const show = Math.floor(time / 4) % 3;
				const light = [
					[110, 160, 230],
					[120, 200, 110],
					[220, 110, 130],
				][show];
				const flicker = 0.08 + 0.06 * Math.abs(Math.sin(time * 5 + show));
				const top = art({ x: 0, y: lounge.y + FACE + 0.6 }).y;

				ctx.fillStyle = `rgba(${light.join(', ')}, ${flicker.toFixed(3)})`;
				ctx.beginPath();
				ctx.moveTo(at.x - 15, at.y - 12);
				ctx.lineTo(at.x - 40, top);
				ctx.lineTo(at.x + 40, top);
				ctx.lineTo(at.x + 15, at.y - 12);
				ctx.closePath();
				ctx.fill();
				rect(
					ctx,
					at.x - 17,
					at.y - 14,
					34,
					1,
					`rgb(${light.map(c => Math.round(c * (0.5 + flicker * 3))).join(', ')})`,
				);
				box(ctx, at.x - 16, at.y - 13, 32, 10, PALETTE.k);
				rect(ctx, at.x - 15, at.y - 12, 30, 8, '#20242c');
				for (let x = at.x - 11; x < at.x + 11; x += 3) rect(ctx, x, at.y - 10, 2, 1, '#14171d');
				rect(ctx, at.x - 3, at.y - 3, 6, 3, PALETTE.d);
			},
		},
		...(lounge.cabinets ?? []).map((cabinet, index) => cabinetPart(ctx, art, lounge, cabinet, index, time)),
		...couches.flatMap(({ x, y, seat }) => [
			// In two parts: its back behind those sitting on it, its cushions and arms over their legs
			{
				y: seat.y - 0.2,
				draw: () => {
					rect(ctx, x - 3, y - 19, width + 6, 14, PALETTE.k);
					rect(ctx, x - 2, y - 18, width + 4, 12, fabric[1]);
					rect(ctx, x - 2, y - 18, width + 4, 1, fabric[0]);
					rect(ctx, x + width / 2, y - 17, 1, 11, fabric[2]);
				},
			},
			{
				y: seat.y + 0.15,
				draw: () => {
					rect(ctx, x - 3, y - 6, width + 6, 9, PALETTE.k);
					rect(ctx, x - 2, y - 5, width + 4, 7, fabric[0]);
					rect(ctx, x - 2, y - 5, width + 4, 1, fabric[1]);
					rect(ctx, x + width / 2, y - 4, 1, 6, fabric[2]);
					rect(ctx, x - 4, y - 9, 4, 12, PALETTE.k);
					rect(ctx, x + width, y - 9, 4, 12, PALETTE.k);
					rect(ctx, x - 3, y - 8, 2, 10, fabric[1]);
					rect(ctx, x + width + 1, y - 8, 2, 10, fabric[1]);
					rect(ctx, x - 2, y + 3, width + 4, 1, 'rgba(0, 0, 0, 0.35)');
				},
			},
		]),
	];
};

// The bridge: its floor and name, consoles along its back wall, one lit blue while a session plans, and in the wall at
// its forward end the airlock, open while someone's at it (`airlockOpen`), its lamp red
// `ship`: its name and color, which sign the bridge, since the bridge is the one room that is the ship's own
// The airlock: how wide its hatch is, in world units, and how far it stands up past the top of the bridge's far wall,
// in art pixels: into the hull's rim over the wall and no further, so it's flush with the hull's back
export const AIRLOCK = { wide: 1.3, rise: 6 };

// The airlock in the bridge's far wall, `x` its middle: a heavy hatch in a collar standing up into the hull, two
// leaves with a port in each, parted to either side while `open`; a lamp over it, red, flashing while it's open, and
// a hazard strip along its sill
// `head`: only what stands up past the wall's top, for drawing over the hull there once the rooms (which are drawn
// cut off at the hull's edge) are done
export const drawAirlock = (ctx, art, bridge, { x, open, time, head: over = false }) => {
	const top = art({ x: 0, y: bridge.y }).y;
	const height = Math.round((bridge.face ?? FACE) * UNIT.y);
	const across = Math.round(AIRLOCK.wide * UNIT.x);
	const left = art({ x: x - AIRLOCK.wide / 2, y: bridge.y }).x;
	const middle = left + Math.floor(across / 2);
	const head = top - AIRLOCK.rise;
	const tall = height + AIRLOCK.rise;

	if (over) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(left - 6, head - 8, across + 12, top - head + 8);
		ctx.clip();
	}
	// Its collar, and the dark of the lock behind the hatch
	rect(ctx, left - 3, head - 1, across + 6, tall + 1, PALETTE.k);
	rect(ctx, left - 2, head, across + 4, tall, PALETTE.m);
	rect(ctx, left - 2, head, across + 4, 1, PALETTE.l);
	rect(ctx, left - 1, head + 2, across + 2, tall - 2, PALETTE.k);
	rect(ctx, left, head + 3, across, tall - 3, '#0e1219');
	if (open) {
		// Parted: a sliver of each leaf at either side, the lock lit inside
		rect(ctx, left + 4, head + 3, across - 8, tall - 3, '#18222e');
		for (const leaf of [left, left + across - 4]) {
			rect(ctx, leaf, head + 3, 4, tall - 3, PALETTE.d);
			rect(ctx, leaf, head + 3, 4, 1, PALETTE.l);
		}
	} else {
		const half = Math.floor(across / 2);

		for (const leaf of [left, left + half + 1]) {
			rect(ctx, leaf, head + 3, half, tall - 3, PALETTE.d);
			rect(ctx, leaf, head + 3, half, 1, PALETTE.l);
			// A port in each leaf, and a brace under it
			rect(ctx, leaf + Math.floor(half / 2) - 3, head + 8, 6, 6, PALETTE.k);
			rect(ctx, leaf + Math.floor(half / 2) - 2, head + 9, 4, 4, '#0b1430');
			rect(ctx, leaf + Math.floor(half / 2) - 2, head + 9, 1, 1, PALETTE.l);
			rect(ctx, leaf + 2, head + Math.floor(tall * 0.62), half - 4, 1, PALETTE.m);
		}
		rect(ctx, middle, head + 3, 1, tall - 3, PALETTE.k);
	}
	// The lamp over it
	const lit = !open || Math.floor(time * 4) % 2 === 0;

	// Set into its lintel, so nothing of it stands off the hull
	rect(ctx, middle - 3, head, 7, 2, PALETTE.k);
	rect(ctx, middle - 2, head, 5, 1, lit ? PALETTE.r : '#4a1c1a');
	if (over) {
		ctx.restore();

		return;
	}
	for (let step = 0; step < across; step++)
		rect(ctx, left + step, top + height, 1, 1, Math.floor((step + 1) / 2) % 2 ? PALETTE.y : PALETTE.k);
};

export const drawBridge = (ctx, art, label, bridge, { time, plans, airlockOpen = false, ship = null }) => {
	floor(ctx, art, bridge);

	const airlock = airlockAt(bridge);

	return [
		...walls(ctx, art, label, bridge, {
			name: ship?.name || bridge.name,
			color: Number.isFinite(ship?.hue) ? `hsl(${ship.hue} 60% 70%)` : PALETTE.w,
		}),
		{
			y: bridge.y + 0.01,
			draw: () => {
				const [from, to] = [
					art({ x: bridge.x + 0.5, y: bridge.y + 0.25 }),
					art({ x: airlock.x - AIRLOCK.wide / 2 - 0.3, y: 0 }),
				];
				const panels = Math.max(1, Math.floor((to.x - from.x) / 26));
				const pitch = (to.x - from.x) / panels;

				for (let panel = 0; panel < panels; panel++) {
					const x = Math.round(from.x + panel * pitch);
					const planning = plans && panel === Math.floor(panels / 2);

					rect(ctx, x, from.y, Math.round(pitch) - 2, 9, PALETTE.k);
					rect(ctx, x + 1, from.y + 1, Math.round(pitch) - 4, 7, planning ? '#12305a' : '#141a24');
					for (let led = 0; led < 5; led++)
						rect(
							ctx,
							x + 3 + led * 4,
							from.y + 3,
							2,
							1,
							(planning && '#78c0ff') ||
								(Math.floor(time * 2 + panel * 3 + led * 5) % 7 === 0 && PALETTE.t) ||
								PALETTE.d,
						);
					rect(ctx, x + 3, from.y + 6, Math.round(pitch) - 10, 1, '#202838');
				}
				drawAirlock(ctx, art, bridge, { x: airlock.x, open: airlockOpen, time });
			},
		},
	];
};
