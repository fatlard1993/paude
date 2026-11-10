import { cksum } from '../../shared/hues';
import { PALETTE, drawSprite } from './art';

// What every room aboard is made of: floors, walls, seats and their screens. In world units, x across, y toward the
// viewer.

// A seat's pitch along an island, and between rows
export const DESK_PITCH = 2.3;
export const DESK_ROW = 1.9;
const BAY_MIN = 3;
// How deep a room's far wall stands, seen from in front: its face takes this much of the room
export const FACE = 1;
export const HALL_FACE = 0.7;
// The hull's inner wall, where it's a room's far wall, stands taller
export const HULL_FACE = 1.5;
export const HALL_LANE = 1.1;
export const DOOR = 0.8;
// Kept once worked out, as the same few are asked for every frame; started over past a few thousand
const seeds = new Map();

// The same, not kept: for what's asked once and never again, like a light's flicker at a moment, which would only churn
// what's kept
export const noise = text => (cksum(text) % 1000) / 1000;

export const seeded = text => {
	if (!seeds.has(text)) {
		if (seeds.size > 5000) seeds.clear();
		seeds.set(text, (cksum(text) % 1000) / 1000);
	}

	return seeds.get(text);
};

// A project's stretch of deck is its machine and its workers standing at ports either side of it, jacked in, the
// first on its left and the next on its right, outward from it: a worker's place at a port, and the margin at each end
const PORT_W = 0.9;
const SECTION_MARGIN = 0.3;

// How wide a project's machine is, from how many files it holds
export const machineWidth = files => Math.min(2.6, Math.max(1, 0.8 + Math.log2(1 + (files ?? 0)) * 0.16));

// The stretch of hull a machine takes on a deck: the machine, room either side for its sockets and the cables into them
export const footprintOf = machine => SECTION_MARGIN * 2 + machine + PORT_W / 3;

// Where a deck's machine stands on it, as wide as its project's, from the deck's ceiling to near its front
export const housingOf = part => {
	const w = part.machine ?? machineWidth();
	const x = part.x + SECTION_MARGIN + PORT_W / 6;

	return { x, w, middle: x + w / 2, floor: part.y + part.d - 0.75, part };
};

// The lounge, where sessions that have stopped wait: couches of two in rows, facing the viewer as greys at their
// desks do, the TV on the near wall with its back to us, so only its frame and the light it throws up at them show
export const COUCH_SEAT = 0.9;
const COUCH_GAP = 0.3;
const LOUNGE_ROW = 1.45;
const MOST_COLUMNS = 8;

// Couches of two side by side, as many to a row as keeps the lounge about as wide as it is deep
const loungeColumns = count =>
	Math.max(2, Math.min(MOST_COLUMNS, 2 * Math.ceil(Math.sqrt(Math.max(count, 1) * 1.5) / 2)));

const loungeSpan = columns => columns * COUCH_SEAT + (columns / 2 - 1) * COUCH_GAP;

// The mother hub's games as arcade cabinets in islands of two back to back (the first facing left, the second right,
// each player at its own end), stacked in a column on each side of the lounge, out past both ends of the couches and the
// cans piled at them so they stand clear of the TV, its couches and its cans: half the islands up the left column from
// the near wall, half up the right, a second column on a side only past MOST_STACKED; the lounge as deep as the tallest
export const CABINET_W = 0.55;
const ISLE_GAP = 1.3;
const CAN_ROOM = 1.2;
const CABINET_EDGE = 0.9;
const ISLE_W = CABINET_W * 2;
const ISLE_STEP = ISLE_W + ISLE_GAP;
const ISLE_ROW = 1.4;
const MOST_STACKED = 3;

// How far from the lounge's middle the islands begin: past the couches' half and the cans beyond them
const cabinetsInner = count => loungeSpan(loungeColumns(count)) / 2 + CAN_ROOM;

const islesOf = cabinets => Math.ceil(cabinets / 2);
// The islands on the fuller side, and the columns and rows they take there
const sideIsles = cabinets => Math.ceil(islesOf(cabinets) / 2);
const sideColumns = cabinets => Math.ceil(sideIsles(cabinets) / MOST_STACKED);
const sideRows = cabinets => Math.min(sideIsles(cabinets), MOST_STACKED);

export const loungeWidth = (count, cabinets = 0) =>
	Math.max(
		BAY_MIN,
		loungeSpan(loungeColumns(count)) + 1.6,
		cabinets ? 2 * (cabinetsInner(count) + sideColumns(cabinets) * ISLE_STEP + CABINET_EDGE) : 0,
	);

export const loungeDepth = (count, cabinets = 0) =>
	Math.max(
		FACE + 0.6 + Math.ceil(Math.max(count, 1) / loungeColumns(count)) * LOUNGE_ROW + 1.8,
		cabinets ? FACE + 2.4 + sideRows(cabinets) * ISLE_ROW : 0,
	);

// Which way a cabinet's screen faces: the first of an island to the left (-1), the second to the right (1)
export const cabinetFacing = index => (index % 2 ? 1 : -1);

// Where a cabinet stands (its foot): its island's half, the screen's side out, its island stacked up its side's column
export const cabinetAt = (lounge, index) => {
	const isles = islesOf(lounge.cabinets?.length ?? 0);
	const left = Math.ceil(isles / 2);
	const isle = Math.floor(index / 2);
	const onLeft = isle < left;
	const place = onLeft ? isle : isle - left;
	const column = Math.floor(place / MOST_STACKED);
	const row = place % MOST_STACKED;
	const middle = lounge.x + lounge.w / 2;
	const inner = cabinetsInner(lounge.count) + ISLE_GAP / 2 + (column + 0.5) * ISLE_STEP;
	const centre = onLeft ? middle - inner : middle + inner;

	return {
		x: centre + (cabinetFacing(index) * CABINET_W) / 2,
		y: lounge.y + lounge.d - 0.15 - row * ISLE_ROW,
	};
};

// Where a grey stands to play a cabinet: out at its screen's end of the island, off the wall (whose band would cut
// across it); a second player at the same cabinet a little further out and back
export const cabinetStandAt = (lounge, index, side = 0) => {
	const at = cabinetAt(lounge, index);
	const out = cabinetFacing(index);

	return { x: at.x + out * (CABINET_W / 2 + (side > 0 ? 0.55 : 0.28)), y: at.y - (side > 0 ? 0.6 : 0.35) };
};

export const loungeSeatAt = (lounge, index) => {
	const columns = loungeColumns(lounge.count);
	const column = index % columns;

	return {
		x:
			lounge.x +
			(lounge.w - loungeSpan(columns)) / 2 +
			(column + 0.5) * COUCH_SEAT +
			Math.floor(column / 2) * COUCH_GAP,
		y: lounge.y + FACE + 1.9 + Math.floor(index / columns) * LOUNGE_ROW,
	};
};

// The seat at the outer end of its row of couches nearer a seat, and which end that is, -1 the left and 1 the right:
// where its empties go, the couches standing too close together for anything between them
export const couchEndOf = (lounge, index) => {
	const columns = loungeColumns(lounge.count);
	const column = index % columns;
	const side = column < (columns - 1) / 2 ? -1 : 1;

	return { side, seat: loungeSeatAt(lounge, index - column + (side < 0 ? 0 : columns - 1)) };
};

const PROP_SPACING = { x: 1.3, y: 1.1 };
// What stands about the lounge
const LOUNGE_PROPS = ['vending', 'cooler', 'plant', 'tallPlant', 'plant'];

const within = (point, box) => point.x > box.x && point.x < box.x + box.w && point.y > box.y && point.y < box.y + box.d;

// The lounge furnished where it's free: on a grid over its floor, about every other spot, against a wall, clear of its
// door and of its TV and couches
export const furnish = room => {
	const mix = LOUNGE_PROPS;
	const wall = room.y + (room.hull.top ? HULL_FACE : FACE);
	const reserved = { x: room.x + 0.3, y: room.y, w: room.w - 0.6, d: room.d - 0.4 };
	const props = [];

	for (let y = room.y + 0.6; y < room.y + room.d - 0.15; y += PROP_SPACING.y)
		for (let x = room.x + 0.5; x < room.x + room.w - 0.4; x += PROP_SPACING.x) {
			const spot = { x, y };
			const clear =
				y - 1 > wall &&
				y < room.y + room.d - (room.hull.bottom ? 0.1 : 0.3) &&
				Math.hypot(x - room.door.x, y - room.door.y) > 1.3 &&
				!within(spot, reserved);
			const againstWall = y - 1 < wall + 0.8 || x - room.x < 0.9 || room.x + room.w - x < 0.9;

			if (!clear || !againstWall) continue;

			const pick = seeded(`${room.name}|${x.toFixed(2)}|${y.toFixed(2)}`);

			if (pick < 0.7) props.push({ x, y, sprite: mix[Math.floor((pick / 0.7) * mix.length)] });
		}

	return props;
};

// Art pixels to a world unit across, deep, and up
export const UNIT = { x: 20, y: 14, z: 14 };

// A project's conduit to its islands, as thick as the sessions wired up at them make it, in art pixels
export const cableWeight = wired => Math.min(5, 1 + wired);
// The clear gap between conduits laid side by side along a row, in art pixels: their outlines meeting
export const CABLE_GAP = 2;
// How far below a conduit `above` thick the next one `below` thick lies along a row, their middles apart, in art pixels;
// each is drawn from its middle less half its thickness, rounded down, so the one above reaches half its, rounded up
export const cableStep = (above, below) => Math.ceil(above / 2) + Math.floor(below / 2) + CABLE_GAP;
// How far a seat's screen stands above its desk's line, in art pixels: the top of the next row's screens bounds the
// aisle under a row
export const SCREEN_RISE = 31;
// How far in from a hall's top and floor the conduits along it run, in art pixels
export const HALL_TRAY_IN = 3;

const rect = (ctx, x, y, w, h, color) => {
	ctx.fillStyle = color;
	ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
};

export const pixelEllipse = (ctx, cx, cy, across, deep, color) => {
	ctx.fillStyle = color;
	for (let row = -Math.floor(deep); row <= Math.floor(deep); row++) {
		const half = Math.floor(across * Math.sqrt(Math.max(0, 1 - (row / deep) ** 2)));

		ctx.fillRect(Math.round(cx) - half, Math.round(cy) + row, half * 2 + 1, 1);
	}
};

const HALL_FLOOR = { base: '#20252f', alt: '#1c2029' };

export const corners = (art, room) => [art({ x: room.x, y: room.y }), art({ x: room.x + room.w, y: room.y + room.d })];

// A floor laid in its pattern on the world's grid, so the seams of rooms side by side line up
const grate = y => y % 2 === 1;

const floors = new Map();

// A bare room's deck: open grating over the dark of the ship's insides
const BARE_FLOOR = { base: '#0a0d14', alt: '#141a25' };

// The ship's color, set before it's drawn (setTrim): a band on every girder and a line along every deck's front edge,
// so which ship you're aboard reads from any room, not only from the stripe outside
let trim = null;

export const setTrim = hue => {
	trim = Number.isFinite(hue) ? `hsl(${hue} 55% 48%)` : null;
};

export const floor = (ctx, art, room, colors = BARE_FLOOR) => {
	const [from, to] = corners(art, room);
	const [w, h] = [to.x - from.x, to.y - from.y];
	const key = `${colors.base}|${colors.alt}|${Math.abs(from.y % 2)},${w},${h}`;

	if (w <= 0 || h <= 0) return;
	if (!floors.has(key)) {
		// Rooms change size as the ship's laid out anew; started over past a few dozen kept
		if (floors.size > 60) floors.clear();
		const canvas = document.createElement('canvas');
		const paint = canvas.getContext('2d');
		const wrap = value => ((value % 840) + 840) % 840;

		canvas.width = w;
		canvas.height = h;
		paint.fillStyle = colors.base;
		paint.fillRect(0, 0, w, h);
		paint.fillStyle = colors.alt;
		for (let y = 0; y < h; y++) if (grate(wrap(from.y + y))) paint.fillRect(0, y, w, 1);
		floors.set(key, canvas);
	}
	ctx.drawImage(floors.get(key), from.x, from.y);
	if (trim) rect(ctx, from.x, to.y - 1, w, 1, trim);
};

// A far wall's face and its shadow, painted once for each width, height, catwalks through it and where it starts on
// the world's grid
const faces = new Map();
const faceImage = (left, w, height, gaps) => {
	const phase = ((left % UNIT.x) + UNIT.x) % UNIT.x;
	const key = `${phase},${w},${height}|${gaps.map(gap => `${gap.from - left}-${gap.to - left}`)}`;

	if (faces.has(key)) return faces.get(key);
	if (faces.size > 100) faces.clear();

	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d');

	canvas.width = w;
	canvas.height = height + 2;
	for (let x = 0; x < w; x++) {
		if (gaps.some(gap => x + left >= gap.from && x + left < gap.to)) continue;

		rect(ctx, x, 0, 1, height, (x + phase) % UNIT.x === 0 ? '#3a4357' : PALETTE.m);
		rect(ctx, x, 0, 1, 1, PALETTE.l);
		rect(ctx, x, 1, 1, 1, PALETTE.d);
		rect(ctx, x, height - 3, 1, 2, PALETTE.d);
		rect(ctx, x, height - 1, 1, 1, PALETTE.k);
		ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
		ctx.fillRect(x, height, 1, 2);
	}
	faces.set(key, canvas);

	return canvas;
};

// A room's far wall as it faces the viewer: lit along its top, panels down it, a skirting where it meets the floor and
// its shadow on the floor below
const face = (ctx, art, room, { deep, gaps = [] }) => {
	const [from, to] = corners(art, room);
	const height = Math.round(deep * UNIT.y);

	if (to.x > from.x) ctx.drawImage(faceImage(from.x, to.x - from.x, height, gaps), from.x, from.y);
};

// A doorway in a room's far wall `deep` world units tall, `door` its middle: its frame, its two leaves (parted while
// `door.open`), a lamp over it (`door.lamp`) and a hazard strip along its sill
export const drawDoor = (ctx, art, room, door, deep) => {
	const top = art({ x: 0, y: room.y }).y;
	const height = Math.round(deep * UNIT.y);
	const at = art({ x: door.x - DOOR / 2, y: room.y });
	const across = Math.round(DOOR * UNIT.x);

	rect(ctx, at.x - 1, top + 2, across + 2, height - 2, PALETTE.l);
	rect(ctx, at.x, top + 3, across, height - 3, door.open ? '#0e1219' : PALETTE.d);
	if (!door.open) rect(ctx, at.x + Math.floor(across / 2), top + 3, 1, height - 3, PALETTE.k);
	rect(ctx, at.x + Math.floor(across / 2) - 2, top, 5, 3, PALETTE.k);
	rect(ctx, at.x + Math.floor(across / 2) - 1, top + 1, 3, 1, door.lamp ?? PALETTE.d);
	for (let x = 0; x < across; x++)
		rect(ctx, at.x + x, top + height, 1, 1, Math.floor((x + 1) / 2) % 2 ? PALETTE.y : PALETTE.k);
};

// The top of a wall seen from above: a dark band with its lit edge; walls between rooms side by side, and the near
// wall along a room's front
const wallTop = (ctx, from, to) => {
	if (from.y === to.y) {
		rect(ctx, from.x, from.y - 2, to.x - from.x + 1, 3, PALETTE.k);
		rect(ctx, from.x, from.y - 2, to.x - from.x + 1, 1, PALETTE.l);

		return;
	}
	rect(ctx, from.x - 1, from.y, 3, to.y - from.y, PALETTE.k);
	rect(ctx, from.x, from.y, 1, to.y - from.y, PALETTE.l);
};

// A hall: its grated floor, the far wall's face, and down its middle lights that run while
// anything aboard is working. Through a room (`gaps`, spans of art pixels across) it has no wall behind it or before it.
export const drawHall = (ctx, art, hall, { time, running, gaps = [] }) => {
	floor(ctx, art, hall, HALL_FLOOR);

	const [from, to] = corners(art, hall);
	const lane = art({ x: hall.x, y: hall.lane }).y;
	const open = x => gaps.some(gap => x >= gap.from && x < gap.to);

	for (let x = from.x + 2; x < to.x - 2; x += 4) {
		const on = running && Math.floor(x / 4 - time * 6) % 6 === 0;

		rect(ctx, x, lane, 2, 1, on ? PALETTE.t : '#2a3242');
	}

	return [
		{ y: hall.y, draw: () => face(ctx, art, hall, { deep: hall.face, gaps }) },
		{
			y: hall.y + hall.d,
			draw: () => {
				wallTop(ctx, { x: from.x, y: from.y }, { x: from.x, y: to.y });
				wallTop(ctx, { x: to.x, y: from.y }, to);
				for (let x = from.x; x < to.x; x++) {
					if (open(x)) continue;

					const start = x;

					while (x + 1 < to.x && !open(x + 1)) x++;
					wallTop(ctx, { x: start, y: to.y }, { x: x + 1, y: to.y });
				}
			},
		},
	];
};

// The word on a room's sign when its name won't fit even small
const SHORT = {
	engines: 'engine',
	reading: 'read',
	editing: 'edit',
	commands: 'run',
	'new sessions': 'new',
	shipping: 'ship',
	changes: 'git',
	stopped: 'idle',
	watching: 'watch',
};

// A bare room, part of the ship's machinery rather than a room: no wall behind it, beside it or before it, girders at
// its ends where it meets another, its name small over it
export const walls = (ctx, art, label, room, { name, color }) => [
	{
		y: room.y,
		draw: () => {
			const [from, to] = corners(art, room);

			for (const [x, edge] of [
				[from.x, 'left'],
				[to.x - 3, 'right'],
			]) {
				// No girder between machines, nor within the engine bay: the deck runs on under them
				if (room.hull[edge] || room.machine || room.joined?.[edge]) continue;
				rect(ctx, x, from.y, 3, to.y - from.y, PALETTE.k);
				rect(ctx, x + 1, from.y, 1, to.y - from.y, PALETTE.m);
				for (let y = from.y + 4; y < to.y; y += 8) rect(ctx, x, y, 3, 1, PALETTE.d);
				if (trim) rect(ctx, x, from.y + 1, 3, 2, trim);
			}
			if (!name || room.unsigned) return;
			label(name, art({ x: room.x + room.w / 2, y: room.y }), {
				short: SHORT[name],
				sign: true,
				color,
				align: 'center',
				size: 1,
				gap: 9,
				width: Math.round(room.w * UNIT.x) - 6,
			});
		},
	},
];

export const propParts = (ctx, art, room, { color, time }) =>
	room.props.map(prop => ({
		y: prop.y,
		draw: () => {
			const at = art(prop);

			drawSprite(ctx, prop.sprite, at.x, at.y, {
				colors: { c: color, s: Math.sin(time * 3 + prop.x * 7) > 0 ? PALETTE.t : PALETTE.T },
			});
		},
	}));

export const box = (ctx, x, y, w, h, color) => {
	rect(ctx, x, y, w, h, PALETTE.k);
	rect(ctx, x + 1, y + 1, w - 2, h - 2, color);
};

// A project's island on the bridge, `from` and `to` its ends and `y` its foot: one long console with a stripe of its
// project's color, legs at its ends
export const drawIsland = (ctx, { from, to, y }, { color }) => {
	rect(ctx, from + 1, y - 3, 2, 3, PALETTE.k);
	rect(ctx, to - 3, y - 3, 2, 3, PALETTE.k);
	rect(ctx, from - 1, y - 14, to - from + 2, 12, PALETTE.k);
	rect(ctx, from, y - 13, to - from, 1, PALETTE.w);
	rect(ctx, from, y - 12, to - from, 4, PALETTE.l);
	rect(ctx, from, y - 8, to - from, 5, PALETTE.m);
	rect(ctx, from, y - 4, to - from, 1, color);
};

// A grey's seat at its island, `at` its foot: its screen on a stand before it, large enough to read, showing what it's
// at or what needs you; its todos in lamps along the console's front under it, and a keyboard
export const drawSeat = (ctx, at, { screen, engineColor, time, seed, todos = [], frost }) => {
	const { x, y } = at;

	drawTodos(ctx, { x: x - 13, y: y - 7, w: 26 }, todos, time);
	rect(ctx, x - 13, y - 5, 26, 1, engineColor);
	rect(ctx, x + 1, y - 11, 9, 2, PALETTE.d);
	rect(ctx, x + 2, y - 11, 7, 1, PALETTE.m);
	rect(ctx, x - 9, y - 16, 3, 4, PALETTE.d);
	rect(ctx, x - 17, y - SCREEN_RISE, 19, 15, PALETTE.k);
	rect(ctx, x - 16, y - 30, 17, 13, PALETTE.d);
	drawScreen(ctx, { x: x - 15, y: y - 29, w: 15, h: 11 }, { ...screen, time, seed });
	if (frost) drawFrost(ctx, { x: x - 17, y: y - 31, w: 19, h: 15 });
};

// A laptop open on the floor, `at` its front middle: its screen showing what the session's at, as a monitor's does, and
// its cable out of its back
export const drawLaptop = (ctx, at, { screen, time, seed }) => {
	const { x, y } = at;

	rect(ctx, x - 6, y - 1, 12, 2, PALETTE.k);
	rect(ctx, x - 5, y - 1, 10, 1, PALETTE.m);
	rect(ctx, x - 5, y - 9, 10, 8, PALETTE.k);
	ctx.save();
	ctx.beginPath();
	ctx.rect(x - 4, y - 8, 8, 6);
	ctx.clip();
	drawScreen(ctx, { x: x - 4, y: y - 8, w: 8, h: 6 }, { ...screen, time, seed });
	ctx.restore();
};

// A todo's lamp: done green, under way blinking amber, waiting dark
const todoLamp = (status, time) => {
	if (status === 'in_progress') return Math.floor(time * 3) % 2 ? PALETTE.y : PALETTE.Y;

	return status === 'completed' ? PALETTE.t : PALETTE.d;
};

const drawTodos = (ctx, { x, y, w }, todos, time) => {
	const pitch = todos.length * 3 - 1 <= w ? 3 : 2;

	todos
		.slice(0, Math.floor((w + 1) / pitch))
		.forEach(({ status }, index) => rect(ctx, x + index * pitch, y, pitch - 1, 1, todoLamp(status, time)));
};

// Rime in a frame's corners and along its top
const FROST = ['#d8eeff', '#9cc8ec'];

const drawFrost = (ctx, { x, y, w, h }) => {
	for (const [left, top, across, down] of [
		[x, y, 4, 1],
		[x, y + 1, 2, 1],
		[x, y + 2, 1, 2],
		[x + w - 3, y, 3, 1],
		[x + w - 1, y + 1, 1, 2],
		[x, y + h - 1, 3, 1],
		[x + w - 2, y + h - 1, 2, 1],
	])
		rect(ctx, left, top, across, down, FROST[(left + top) % 2]);
	for (let icicle = x + 5; icicle < x + w - 3; icicle += 3) rect(ctx, icicle, y, 1, 1 + (icicle % 2), FROST[1]);
};

// What a monitor shows: lines of work scrolling in the color of what's being done, a terminal for the shell, dots while
// thinking; an amber question while asking, an empty battery at a usage limit, a blinking cursor at rest, and nothing
// once stopped
const drawScreen = (ctx, area, { kind, hue, time, seed }) => {
	const { x, y, w, h } = area;
	const scroll = Math.floor(time * 4 + seed * 10);
	const blink = Math.floor(time * 2) % 2 === 0;

	const background = {
		work: `hsl(${hue} 40% 12%)`,
		terminal: PALETTE.e,
		think: 'hsl(200 25% 14%)',
		send: `hsl(${hue} 45% 12%)`,
		ask: PALETTE.y,
		news: '#0f2a4a',
		limit: '#2a0f0f',
		idle: '#16263a',
		off: PALETTE.k,
	}[kind];

	rect(ctx, x, y, w, h, background);
	if (kind === 'work' || kind === 'terminal')
		for (let row = 0; row < 4; row++) {
			const line = scroll + row;
			const length = 2 + Math.floor(seeded(`${seed}|${line}`) * (w - 3));
			const indent = Math.floor(seeded(`i${seed}|${line}`) * 3);

			rect(
				ctx,
				x + 1 + indent,
				y + 1 + row * 2,
				Math.min(length, w - 2 - indent),
				1,
				kind === 'work' ? `hsl(${hue} 60% 62%)` : PALETTE.t,
			);
		}
	if (kind === 'terminal' && blink) rect(ctx, x + w - 3, y + h - 2, 2, 1, PALETTE.W);
	if (kind === 'think')
		for (let dot = 0; dot < 3; dot++)
			rect(ctx, x + 2 + dot * 3, y + 3, 1, 1, dot === Math.floor(time * 3) % 3 ? PALETTE.W : PALETTE.l);
	if (kind === 'ask' && blink) {
		rect(ctx, x + 4, y + 1, 3, 1, PALETTE.k);
		rect(ctx, x + 6, y + 2, 1, 2, PALETTE.k);
		rect(ctx, x + 5, y + 4, 1, 1, PALETTE.k);
		rect(ctx, x + 5, y + 6, 1, 1, PALETTE.k);
	}
	if (kind === 'limit') drawBattery(ctx, area, blink);
	// Its reply going out to its keeper: a packet sliding off the screen's right edge, again and again
	if (kind === 'send') {
		const span = w - 2;
		const head = Math.floor((time * 10 + seed) % (span + 3));

		for (let step = 0; step < 3; step++) {
			const px = x + 1 + head - step;

			if (px >= x + 1 && px < x + 1 + span)
				rect(ctx, px, y + Math.floor(h / 2), 1, 1, step ? `hsl(${hue} 70% 45%)` : `hsl(${hue} 80% 72%)`);
		}
	}
	// Something new for you: a letter, lit while it waits to be looked at
	if (kind === 'news') {
		const [left, top] = [x + Math.floor((w - 9) / 2), y + Math.floor((h - 6) / 2)];
		const ink = blink ? PALETTE.W : PALETTE.b;

		rect(ctx, left, top, 9, 6, ink);
		rect(ctx, left + 1, top + 1, 7, 4, '#0f2a4a');
		for (let step = 0; step < 4; step++) {
			rect(ctx, left + 1 + step, top + 1 + step, 1, 1, ink);
			rect(ctx, left + 7 - step, top + 1 + step, 1, 1, ink);
		}
	}
	if (kind === 'idle' && blink) rect(ctx, x + 1, y + 1, 1, 2, PALETTE.W);
	if (kind === 'off') rect(ctx, x + w - 1, y + h, 1, 1, PALETTE.r);
};

// Out of power: an empty battery, its last bar blinking
const drawBattery = (ctx, { x, y }, blink) => {
	rect(ctx, x + 2, y + 2, 7, 4, PALETTE.r);
	rect(ctx, x + 3, y + 3, 5, 2, '#2a0f0f');
	rect(ctx, x + 9, y + 3, 1, 2, PALETTE.r);
	if (blink) rect(ctx, x + 3, y + 3, 1, 2, PALETTE.r);
};

export { rect };
