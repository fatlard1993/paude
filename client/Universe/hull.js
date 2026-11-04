import { PALETTE, drawSprite } from './art';
import { NACELLE, NOSE, RIM, clonerAt, padAt, panelAt, recyclerAt, stockAt, systemFootOf, systemTallOf } from './plan';
import { pixelText, textWidth } from './retro';
import {
	COUCH_SEAT,
	FACE,
	UNIT,
	box,
	corners,
	floor,
	loungeSeatAt,
	pixelEllipse,
	propParts,
	rect,
	seeded,
	walls,
} from './station';

// The ship's log on a room's back wall: how far it has come
const stationLog = (ctx, art, label, room, journey) => ({
	y: room.y + FACE,
	draw: () => {
		const at = art({ x: room.x + room.w / 2, y: room.y + FACE + 0.7 });
		const log = { x: at.x - 13, y: at.y - 10 };

		box(ctx, log.x, log.y, 26, 10, PALETTE.k);
		rect(ctx, log.x + 2, log.y + 2, 22, 6, '#1a1408');
		label(
			String(journey?.distance ?? 0),
			{ x: log.x + 13, y: log.y + 5 },
			{ color: PALETTE.y, align: 'center', gap: 6, width: 22 },
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
	if (layout.gondola) {
		const { gondola } = layout;

		ctx.rect(
			Math.round(gondola.x * UNIT.x),
			Math.round(gondola.y * UNIT.y) - 1,
			Math.round(gondola.w * UNIT.x),
			Math.round(gondola.d * UNIT.y) + 1,
		);
	}
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
const hullImage = building => {
	if (lastHull?.building === building) return lastHull.image;

	const key = Object.values(building)
		.map(value => value.toFixed(2))
		.join('|');

	if (!hulls.has(key)) {
		// Its plates' pattern runs with where it lies, so it's kept for each place it's been, a few at a time
		if (hulls.size > 8) hulls.clear();
		hulls.set(key, paintHull(building));
	}
	lastHull = { building, image: hulls.get(key) };

	return lastHull.image;
};

const paintHull = building => {
	const shape = outline(building);
	const below = 9;
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

		for (let x = from; x <= to; x++) {
			const column = Math.floor((x - shape.left) / 20);
			const shade = seeded(`plate${column}:${row}`);
			const base = (lit < 0.2 && [44, 53, 71]) || (lit < 0.75 && [35, 43, 58]) || [28, 35, 48];
			const tone = base.map(part => Math.round(part + (shade - 0.5) * 8));

			put(x, y, 1, 1, `rgb(${tone.join(', ')})`);
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

		put(x, top, 1, tall - 1, panel % 2 ? '#2a3243' : PALETTE.d);
		put(x, top, 1, 1, '#3a4458');
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

// The nose: a cockpit window in an armored rim, space streaming past in it as fast as the ship is going (`pace`)
const drawCanopy = (ctx, image, { time, pace }) => {
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
	if (!rows.length) return;

	const width = glass.length ? Math.max(...glass.map(({ to }) => to)) - from : 0;
	const tip = Math.round(shape.middle);
	// Painted once: what lies under the stars streaming past in the glass, and what over them
	const area = { left: from - 1, top: rows[0].y - 1, w: shape.tip + 9 - from, h: rows.length + 2 };

	image.canopy ??= [
		layer(area, paint => {
			for (const { y, to } of rows) {
				if (Math.abs(y - shape.middle) <= window) continue;

				const above = y < shape.middle;

				rect(paint, from, y, to - from, 1, above ? '#2e3849' : '#1d2432');
				for (let x = from; x < to; x++)
					if ((x - from + Math.round(Math.abs(y - shape.middle) * 0.8)) % 12 === 0) rect(paint, x, y, 1, 1, '#141a26');
				rect(paint, to, y, 2, 1, PALETTE.k);
			}
			for (const { y, to } of glass) {
				rect(paint, from, y, to - from, 1, '#0a1226');
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
			rect(paint, from, first.y, first.to - from, 1, '#3b5f96');
		}),
	];
	ctx.drawImage(image.canopy[0], area.left, area.top);
	for (let star = 0; star < 12 && glass.length; star++) {
		const y = Math.round(glass[0].y + seeded(`canopy${star}`) * (glass.length - 1));
		const row = glass[y - glass[0].y];
		const depth = 0.4 + seeded(`canopyDepth${star}`) * 0.6;
		const x = from + ((((seeded(`canopyX${star}`) * width - time * 10 * pace * depth) % width) + width) % width);

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

// A swept fin off the stern on its back and another under its belly
const drawFins = (ctx, image, engineering, { time = 0 } = {}) => {
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
		const key = `${out},${chord}`;

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

						rect(paint, from, y, to - from, 1, (band && '#7a2a26') || (out < 0 ? '#2a3344' : '#1c2330'));
						for (let seam = to - 9; seam > from + 2; seam -= 9)
							rect(paint, seam, y, 1, 1, band ? '#5a1e1b' : '#141a26');
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
// sputtering red and short at a usage limit
const drawEngine = (ctx, shape, { y, hue, thrust, limited, time }) => {
	const front = shape.leftAt(y) + 4;
	const back = front - Math.round(NACELLE * UNIT.x);
	const burning = thrust > 0 && !limited;
	const flicker = Math.sin(time * 23 + hue) > 0 ? 1 : 0;
	const sputter = Math.sin(time * 9) > 0.6 ? 6 : 2;
	const length = limited ? sputter : Math.round(8 + thrust * 36) + flicker * 2;
	const color = limited ? 'hsl(4 70% 45%)' : `hsl(${hue} 75% ${48 + thrust * 14}%)`;
	const bell = 8;
	const mouth = back - bell;

	if (burning) {
		ctx.globalAlpha = 0.1 + thrust * 0.1;
		pixelEllipse(ctx, mouth - length / 2, y, length / 2 + 10, 11, color);
		ctx.globalAlpha = 1;
	}
	for (let step = 0; step < length; step++) {
		const part = step / length;
		const spread = Math.max(1, Math.round(8 * (1 - part) ** 0.7));

		rect(ctx, mouth - step - 1, y - spread, 1, spread * 2 + 1, color);
		if (!limited && part < 0.6)
			rect(ctx, mouth - step - 1, y - 1, 1, 3, part < 0.25 ? '#fff6e0' : `hsl(${hue} 90% 82%)`);
	}
	if (burning)
		for (let diamond = 6 + (Math.floor(time * 12) % 2); diamond < length * 0.7; diamond += 9)
			rect(ctx, mouth - diamond - 1, y - 1, 2, 3, '#ffffff');
	const shades = [PALETTE.k, PALETTE.l, '#8994aa', PALETTE.l, PALETTE.m, PALETTE.m, '#3a4357', '#3a4357'];

	for (let row = -8; row <= 8; row++) {
		const away = Math.abs(row);
		const shade =
			(away === 8 && PALETTE.k) ||
			(row < 0 ? shades[8 - away] : ['#343c4e', '#2b3242', PALETTE.d, '#1f2533'][Math.min(3, Math.floor(row / 2))]);

		rect(ctx, back, y + row, front - back, 1, shade);
	}
	for (let rib = back + 5; rib < front - 3; rib += 7) {
		rect(ctx, rib, y - 7, 1, 15, '#1b2130');
		rect(ctx, rib + 1, y - 7, 1, 1, '#9aa5bb');
	}
	rect(ctx, back + 2, y - 7, 2, 15, `hsl(${hue} 55% ${limited ? 30 : 45}%)`);
	for (let step = 0; step < bell; step++) {
		const flare = 6 + Math.round(step * 0.55);
		const x = back - 1 - step;

		rect(ctx, x, y - flare - 1, 1, flare * 2 + 3, PALETTE.k);
		rect(ctx, x, y - flare, 1, flare * 2 + 1, step < 2 ? '#4b5468' : '#2a3040');
		rect(ctx, x, y - flare, 1, 1, '#6c7790');
	}
	const lip = 6 + Math.round((bell - 1) * 0.55);

	rect(ctx, mouth, y - lip, 1, lip * 2 + 1, burning ? `hsl(${hue} 90% 72%)` : PALETTE.m);
	if (burning) rect(ctx, back - 2, y - 4, 1, 9, `hsl(${hue} 90% 80%)`);
	rect(ctx, front - 2, y - 11, 6, 3, PALETTE.k);
	rect(ctx, front - 1, y - 10, 4, 1, PALETTE.l);
	rect(ctx, front - 2, y + 9, 6, 3, PALETTE.k);
	rect(ctx, front - 1, y + 10, 4, 1, PALETTE.m);
};

const FUEL = '#f0b43c';
// Each tank's own color, in its fuel and along its pipe to each reactor it feeds
export const TANK_COLORS = [FUEL, '#5fd39a', '#c99bf0', '#f08a6a'];

// How far apart tanks side by side on the hull stand, in art pixels
const TANK_PITCH = 64;

// A fuel tank on the hull, `at` where it meets it: fuel running down its line as fast as it's burned (`flow`, 0 to
// 1), its sight glass filled to `level` (0 to 1), striped where that's not known, flashing red once empty

const drawTank = (ctx, at, { level, flow, empty, color = FUEL }, { time, below }) => {
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
	const glass = { x: at.x - 13, y: top + 4, w: 27, h: 4 };

	rect(ctx, glass.x - 1, glass.y - 1, glass.w + 2, glass.h + 2, PALETTE.k);
	rect(ctx, glass.x, glass.y, glass.w, glass.h, '#0b0e13');
	if (empty) rect(ctx, glass.x, glass.y, glass.w, glass.h, Math.floor(time * 3) % 2 ? PALETTE.r : '#0b0e13');
	else if (level === null) {
		rect(ctx, glass.x, glass.y, glass.w, glass.h, color);
		for (let x = 2; x < glass.w; x += 5) rect(ctx, glass.x + x, glass.y, 1, glass.h, 'rgba(0, 0, 0, 0.45)');
	} else rect(ctx, glass.x, glass.y, Math.round(glass.w * level), glass.h, level < 0.15 ? PALETTE.r : color);
	rect(ctx, glass.x, glass.y, glass.w, 1, 'rgba(255, 255, 255, 0.25)');
	for (const end of [-half + 3, half - 4]) {
		rect(ctx, at.x + end, top + 2, 2, tall - 4, color);
		rect(ctx, at.x + end, top + 2, 2, 1, 'rgba(255, 255, 255, 0.35)');
	}
};

// The hull and what's on it: the engines, a fuel tank for each account, each project's section, the comms dish and
// masts, the hangar's doors, running lights
export const drawHull = (
	ctx,
	layout,
	{ time, engines = [], comms, hangarOpen, tanks = [], sections = [], pace = 1 },
) => {
	const image = hullImage(layout.building);
	const { shape } = image;

	drawFins(ctx, image, layout.engineering, { time });
	for (const engine of engines) drawEngine(ctx, shape, { ...engine, time });
	ctx.drawImage(image.canvas, image.x, image.y);
	drawCanopy(ctx, image, { time, pace });
	// Each project's section: plated in its color, its name on the belly, dim while idle, a lamp on its back amber while
	// one of its sessions asks you something and teal while they work
	for (const section of sections) {
		const [from, to] = [Math.round(section.from * UNIT.x), Math.round(section.to * UNIT.x)];
		const lightness = section.idle ? 30 : 46;
		const color = section.hue === null ? PALETTE.l : `hsl(${section.hue} ${section.idle ? 20 : 45}% ${lightness}%)`;

		const back = section.side === 'top' || section.side === 'both';
		const belly = section.side === 'bottom' || section.side === 'both';

		// Its machine showing through the hull
		for (const housing of section.housings ?? []) {
			const [left, right] = [
				Math.round((housing.x + 0.25) * UNIT.x),
				Math.round((housing.x + housing.w - 0.25) * UNIT.x),
			];
			const glow =
				(section.working && `hsl(${section.hue ?? 200} 75% ${60 + Math.round(Math.sin(time * 4) * 8)}%)`) ||
				(section.idle ? PALETTE.d : `hsl(${section.hue ?? 200} 35% 36%)`);

			if (housing.top && section.idle) {
				rect(ctx, left + 2, shape.top - 2, right - left - 4, 2, PALETTE.k);
				rect(ctx, left + 3, shape.top - 1, right - left - 6, 1, PALETTE.m);
			} else if (housing.top) {
				const base = shape.top;

				rect(ctx, left, base - 5, right - left, 5, PALETTE.k);
				rect(ctx, left + 1, base - 4, right - left - 2, 4, PALETTE.m);
				rect(ctx, left + 1, base - 4, right - left - 2, 1, PALETTE.l);
				for (let x = left + 3; x < right - 3; x += 3) rect(ctx, x, base - 3, 2, 2, glow);
				for (const x of [left - 3, right + 1]) {
					rect(ctx, x, base - 8, 2, 8, PALETTE.k);
					rect(ctx, x + (x < left ? 1 : 0), base - 7, 1, 7, PALETTE.l);
				}
			} else if (housing.bottom) {
				const base = shape.bottom + 9;

				for (let x = left + 1; x < right - 1; x += 3) {
					rect(ctx, x, base, 2, 4, PALETTE.k);
					rect(ctx, x, base, 1, 3, PALETTE.m);
				}
				rect(ctx, left, base, right - left, 1, glow);
			}
		}

		// A machine is marked only as far as it reaches, so the hull runs on unbroken between machines
		const reach = section.housings?.length
			? [
					Math.round(Math.min(...section.housings.map(({ x }) => x)) * UNIT.x),
					Math.round(Math.max(...section.housings.map(({ x, w }) => x + w)) * UNIT.x),
				]
			: [from, to];
		const [left, right] = reach;

		if (back) rect(ctx, left, shape.top + 2, right - left, 3, color);
		if (belly) rect(ctx, left, shape.bottom + 2, right - left, 6, section.idle ? PALETTE.d : color);
		if (!section.housings?.length)
			for (const x of [from, to - 1])
				rect(ctx, x, back ? shape.top : shape.bottom, 1, back && belly ? shape.bottom - shape.top + 9 : 9, PALETTE.k);
		if (!belly) continue;

		const width = right - left - 4;
		const words = section.name.toUpperCase();
		const fits = textWidth(words, 1) <= width;
		const initials = section.name
			.split(/[-_ .]+/)
			.filter(Boolean)
			.map(word => word[0])
			.join('')
			.toUpperCase();

		pixelText(ctx, fits ? words : (section.short ?? initials).toUpperCase(), (left + right) / 2, shape.bottom + 8, {
			color: section.idle ? PALETTE.m : PALETTE.k,
			align: 'center',
			max: width,
		});

		const lamp =
			(section.asking && (Math.floor(time * 3) % 2 ? PALETTE.y : PALETTE.Y)) || (section.working && PALETTE.t) || null;

		if (lamp) {
			rect(ctx, Math.round((left + right) / 2) - 2, shape.top - 2, 5, 3, PALETTE.k);
			rect(ctx, Math.round((left + right) / 2) - 1, shape.top - 1, 3, 1, lamp);
		}
	}
	// A tank for each account the engines draw on, over engineering, on its back and under its belly by turns
	tanks.forEach((tank, index) => {
		const below = index % 2 === 1;
		const x =
			Math.round((layout.engineering.x + layout.engineering.w / 2) * UNIT.x) + Math.floor(index / 2) * TANK_PITCH;
		const at = below ? { x, y: shape.bottom + 12 } : { x, y: shape.top - 1 };

		drawTank(ctx, at, { ...tank, color: TANK_COLORS[index % TANK_COLORS.length] }, { time, below });
		tank.at = { x, y: below ? at.y + 9 : at.y - 10 };
	});

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

	if (layout.gondola) {
		// The shipping gondola hung under the belly
		const [from, to] = [
			Math.round(layout.gondola.x * UNIT.x),
			Math.round((layout.gondola.x + layout.gondola.w) * UNIT.x),
		];
		const [top, bottom] = [
			Math.round(layout.gondola.y * UNIT.y),
			Math.round((layout.gondola.y + layout.gondola.d) * UNIT.y),
		];

		rect(ctx, from + 6, shape.bottom, to - from - 12, top - shape.bottom + 2, PALETTE.k);
		rect(ctx, from + 7, shape.bottom, to - from - 14, top - shape.bottom + 2, PALETTE.m);
		rect(ctx, from - 4, top - 3, to - from + 8, bottom - top + 8, PALETTE.k);
		rect(ctx, from - 3, top - 2, to - from + 6, bottom - top + 6, PALETTE.d);
		rect(ctx, from - 3, top - 2, to - from + 6, 1, PALETTE.l);
		for (const x of [from - 7, to + 4]) {
			rect(ctx, x, top + 2, 3, bottom - top - 2, PALETTE.k);
			rect(ctx, x + 1, top + 3, 1, bottom - top - 4, PALETTE.m);
		}
		const [left, right] = [from + 6, to - 6];

		for (let x = left; x < right; x++) {
			const gap = hangarOpen && Math.abs(x - (left + right) / 2) < (right - left) * 0.4;
			const stripe = Math.floor(x / 3) % 2 ? PALETTE.y : PALETTE.k;

			rect(ctx, x, bottom + 1, 1, 3, gap ? '#05070a' : stripe);
		}
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

export const drawEngineering = (ctx, art, label, room, { time, engines, recycling, zoom }) => {
	floor(ctx, art, room);

	const door = art({ x: room.door.x, y: room.door.y });
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

				// Fuel from its account's tank: in through the hull, along inside it to a riser by the bay's back wall, and to
				// the reactor
				if (engine.feed) {
					const { tank, below, x: through, color, flow } = engine.feed;
					const pipe = from.x + 3 + tank * 3;
					const edge = below ? to.y - 3 - tank : from.y + 3 + tank;
					const into = at.y - REACTOR.into;
					const run = [
						...(through === undefined ? [] : [[through, edge, pipe, edge]]),
						[pipe, edge, pipe, into],
						[pipe, into, at.x - 9, into],
					];

					for (const [x1, y1, x2, y2] of run) {
						const [x, y] = [Math.min(x1, x2), Math.min(y1, y2)];

						rect(ctx, x, y, Math.abs(x2 - x1) + 2, Math.abs(y2 - y1) + 2, PALETTE.k);
						rect(ctx, x, y, Math.abs(x2 - x1) + 1, Math.abs(y2 - y1) + 1, `${color}66`);
					}
					if (flow > 0) {
						const along = Math.floor(time * (6 + flow * 24)) % 5;

						for (const [x1, y1, x2, y2] of run) {
							const length = Math.abs(x2 - x1) + Math.abs(y2 - y1);
							const [dx, dy] = [Math.sign(x2 - x1), Math.sign(y2 - y1)];

							for (let step = along; step < length; step += 5) rect(ctx, x1 + dx * step, y1 + dy * step, 1, 1, color);
						}
					}
				}
				rect(ctx, from.x, at.y - REACTOR.shaft - 1, at.x - 9 - from.x, 3, PALETTE.k);
				rect(ctx, from.x, at.y - REACTOR.shaft, at.x - 9 - from.x, 1, PALETTE.l);
				rect(ctx, at.x + 9, at.y - 8, 4, 2, PALETTE.k);
				rect(ctx, at.x + 12, Math.min(at.y - 8, door.y), 2, Math.abs(door.y - at.y + 8) + 1, PALETTE.k);
				rect(ctx, at.x + 12, door.y, door.x - at.x - 12, 2, PALETTE.k);
				if (busy) {
					const along = Math.floor(time * 20) % 6;

					for (let x = at.x + 14 + along; x < door.x; x += 6) rect(ctx, x, door.y, 2, 1, `hsl(${hue} 80% 66%)`);
				}
				// Its hazard strip on the floor, and the unit on it: caps over and under a window onto its core
				for (let x = at.x - 11; x < at.x + 11; x++)
					rect(ctx, x, at.y, 1, 2, Math.floor((x + 1) / 2) % 2 ? PALETTE.y : PALETTE.k);
				box(ctx, at.x - 7, at.y - REACTOR.tall, 15, REACTOR.tall - 1, '#0d1520');
				for (let y = at.y - REACTOR.tall + 3; y < at.y - 3; y++) {
					const band = busy && (y + Math.floor(time * 18)) % 6 < 2;

					rect(ctx, at.x - 4, y, 9, 1, band ? PALETTE.W : core);
				}
				rect(ctx, at.x - 6, at.y - REACTOR.tall + 2, 1, REACTOR.tall - 5, 'rgba(255, 255, 255, 0.12)');
				box(ctx, at.x - 8, at.y - REACTOR.tall - 2, 17, 4, PALETTE.l);
				box(ctx, at.x - 8, at.y - 4, 17, 4, PALETTE.l);
				// Coils up its sides, lit in a band rising to the core while it runs
				for (const side of [-1, 1])
					for (let coil = 0; coil < 5; coil++) {
						const y = at.y - 6 - coil * 3;
						const lit = busy && Math.floor(time * 10) % 7 === coil;

						rect(ctx, at.x + side * 10 - 1, y, 3, 2, PALETTE.k);
						rect(ctx, at.x + side * 10, y, 1, 1, lit ? `hsl(${hue} 80% 70%)` : PALETTE.m);
					}
				// Vents on its cap puffing while it runs, and its pump's lamp
				if (busy)
					for (const vent of [-4, 4]) {
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
				rect(ctx, at.x + 5, at.y - 3, 2, 1, busy && Math.floor(time * 4) % 2 ? PALETTE.t : PALETTE.d);
				if (busy) pixelEllipse(ctx, at.x, at.y + 1, 14, 3, `hsla(${hue}, 80%, 60%, 0.10)`);
				if (engine.link !== undefined) {
					const bars = engine.link === null ? 0 : 3 - [250, 1000, Infinity].findIndex(most => engine.link < most);
					const color = [PALETTE.r, PALETTE.r, PALETTE.y, PALETTE.t][bars];

					for (let bar = 0; bar < 3; bar++)
						rect(ctx, at.x + 10 + bar * 2, at.y - 8 - bar * 2, 1, 2 + bar * 2, bar < bars ? color : PALETTE.d);
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
						active && seeded(`${side}|${row}|${led}|${Math.floor(time * 6)}`) > 0.45 ? accent : PALETTE.m,
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
						2 + Math.floor(seeded(`${terminal}|${row + Math.floor(time * 6)}`) * 9),
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

// The transporter: a pad beaming someone to or from another ship (`beaming`, 0 to 1), and a console with a light for
// each other ship (`ships`)
export const drawTransporter = (ctx, art, label, room, { time, ships = [], beaming = null }) => {
	floor(ctx, art, room);

	const pad = clonerAt(room);

	return [
		...walls(ctx, art, label, room, { name: room.name, color: PALETTE.p }),
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
						on ? PALETTE.W : PALETTE.p,
					);
				}
				for (const side of [-1, 1]) {
					rect(ctx, x + side * 12 - 1, at.y - 22, 3, 22, PALETTE.k);
					rect(ctx, x + side * 12, at.y - 21, 1, 20, PALETTE.l);
					rect(
						ctx,
						x + side * 12,
						at.y - 23,
						1,
						2,
						beaming !== null || Math.floor(time * 2) % 2 ? '#c9b6ff' : PALETTE.p,
					);
				}
				if (beaming !== null) {
					ctx.globalAlpha = 0.25 + 0.5 * Math.sin(beaming * Math.PI);
					rect(ctx, x - 9, at.y - 30, 19, 30, '#c9b6ff');
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
						PALETTE.d;

					rect(ctx, at.x + 12 + (index % 3) * 3, at.y - 18 + Math.floor(index / 3) * 3, 2, 2, color);
				});
				rect(ctx, at.x + 12, at.y - 8, 8, 2, PALETTE.d);
			},
		},
	];
};

// The materializer's room, the materializer in its middle
export const drawMaterializer = (ctx, art, label, room, { time, charge }) => {
	floor(ctx, art, room);

	return [
		...walls(ctx, art, label, room, { name: room.name, color: PALETTE.t }),
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

// The hangar: its landing pad and the hauler waiting on it; its doors are in the hull below
export const drawHangar = (ctx, art, label, room, { time, hauler, journey }) => {
	floor(ctx, art, room);

	const pad = art(padAt(room));

	return [
		...walls(ctx, art, label, room, { name: room.name, color: PALETTE.y }),
		stationLog(ctx, art, label, room, journey),
		{
			y: padAt(room).y,
			draw: () => {
				pixelEllipse(ctx, pad.x, pad.y, 18, 5, PALETTE.Y);
				pixelEllipse(ctx, pad.x, pad.y, 16, 4, '#1d222b');
				rect(ctx, pad.x - 3, pad.y - 1, 7, 1, PALETTE.Y);
				if (hauler) drawSprite(ctx, 'hauler', pad.x, pad.y + 2);
				if (Math.floor(time * 2) % 2) rect(ctx, pad.x + 17, pad.y, 1, 1, PALETTE.y);
			},
		},
	];
};

// The lounge: a TV and couches of two facing it, so whoever sits on one has their back to the viewer
export const drawLounge = (ctx, art, label, lounge, { time }) => {
	floor(ctx, art, lounge);

	const couches = [];

	// One couch at least, waiting when nobody's on it
	for (let index = 0; index < Math.max(lounge.count, 1); index += 2) {
		const first = art(loungeSeatAt(lounge, index));

		couches.push({ x: first.x - Math.round(COUCH_SEAT * UNIT.x) / 2, y: first.y, seat: loungeSeatAt(lounge, index) });
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
				for (const couch of couches) {
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

// The bridge: its floor and name, and consoles along its back wall, one lit blue while a session plans
export const drawBridge = (ctx, art, label, bridge, { time, plans }) => {
	floor(ctx, art, bridge);

	return [
		...walls(ctx, art, label, bridge, { name: bridge.name, color: PALETTE.w }),
		{
			y: bridge.y + 0.01,
			draw: () => {
				const [from, to] = [
					art({ x: bridge.x + 0.5, y: bridge.y + 0.25 }),
					art({ x: bridge.x + bridge.w - 0.5, y: 0 }),
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
			},
		},
	];
};
