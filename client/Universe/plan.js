import { FACE, HALL_FACE, HALL_LANE, furnish, loungeDepth, loungeWidth, footprintOf, machineWidth } from './station';

// Where everything aboard stands, in world units: rooms, seats, and the spots things move between
const ENGINEERING_W = 3.4;
// How deep each of a level's decks is, above its spine and below
const DECK_TOP = FACE + 1.9;
const DECK_BOTTOM = 2.4;
const PER_REACTOR = 2.4;
// A system's room in the engine bay
const SYSTEM = { w: 2.6, d: FACE + 2.3 };
const ENGINE_BAY_W = ENGINEERING_W + 2 * SYSTEM.w;
const HANGAR_W = 2.6;
// The shipping bay, a gondola hung under the belly, what's staged to ship and the pad it leaves from
const GONDOLA_D = FACE + 2.3;
const POD_PITCH = 1.7;
// The staged part of the shipping bay, long enough for each checkout's pod
const holdWidth = checkouts => Math.max(2.4, checkouts * POD_PITCH + 0.6);
const MATERIALIZER_W = 1.2;
// The transporter, on a ship of a fleet: its pad, and the console that hears from the other ships
const TRANSPORTER_W = 2.2;
// The bridge at the bow: every session's grey at a terminal in rows up its depth, wired to its project's machine aft,
// whoever watches walking among them; the nav table, the ship's log and the scanner forward of them, by the nose
const BRIDGE_NAV_W = 1.2;
const BRIDGE_MARGIN = 0.8;
// How long to deep the hull may get before it takes another level, and how many it takes at most; an idle machine's
// size against a working one's
const ASPECT = 3;
const MAX_LEVELS = 6;
const IDLE_SCALE = 0.75;
const BRIDGE_ROW_TOP = FACE + 1.3;
// Its islands: one console for each project being worked on, its greys seated side by side behind it; rows far enough
// apart that a grey's head clears the console behind it, with an aisle between for whoever walks the bridge
const BRIDGE_ROW = 2.4;
const SEAT_W = 1.5;
// A subagent's small terminal beside its grey's seat, as many as are shown
const SMALL_W = 0.8;
const MOST_SMALL = 4;
const ISLAND_END = 0.9;
const ISLAND_GAP = 0.6;

// The islands of the bridge `from` its stern edge down `rows`, for the bays at work: [{ name, hue, keys, x, y, w,
// seats: [{ key, x, y }] }], and how far forward they reach
const islandsOf = (bays, { from, top, rows, lounge, agents = {} }) => {
	// One island for each project however many it seats, never split, in the order given: the order their conduits come
	// to the bridge
	const runs = bays.map(({ name, hue, sessions = [] }) => ({ name, hue, keys: sessions }));
	// The lounge first, at the back of the bottom rows it covers, so the islands pack round it; then each island into
	// whichever row reaches least far yet, so short ones fill in beside long ones
	const reach = Array(rows).fill(0);
	// (less a hair, so a lounge exactly two rows deep isn't rounded up to three)
	const covers = lounge ? Math.min(rows, Math.ceil((lounge.d - 0.6) / BRIDGE_ROW - 1e-9)) : 0;

	for (let row = rows - covers; row < rows; row++) reach[row] = lounge.w + ISLAND_GAP;
	// The materializer's room at the top row's end, reserved before the islands are packed
	reach[0] += MATERIALIZER_W + ISLAND_GAP;
	// With fewer islands than rows left open, they spread evenly down the bridge
	const open = Array.from({ length: rows }, (_, row) => row).filter(row => row < rows - covers);
	const seatWidths = run => run.keys.map(key => SEAT_W + Math.min(MOST_SMALL, agents[key] ?? 0) * SMALL_W);
	const widthOf = run => ISLAND_END + seatWidths(run).reduce((sum, seat) => sum + seat, 0) + 0.3;
	// More than the open rows: down the rows in order, as short a bridge as holds them all, each row starting from what's
	// already in it (the lounge, the materializer)
	const widths = runs.map(widthOf);
	const fits = length => {
		let row = 0;
		let at = reach[0];

		for (const w of widths) {
			while (row < rows && at + w > length && (at > reach[row] || reach[row] + w > length)) {
				row++;
				at = reach[row] ?? 0;
			}
			if (row >= rows) return null;
			at += w + ISLAND_GAP;
		}

		return length;
	};
	let [shortest, longest] = [0, widths.reduce((sum, w) => sum + w + ISLAND_GAP, 0) + Math.max(0, ...reach)];

	for (let step = 0; step < 30; step++) {
		const middle = (shortest + longest) / 2;

		if (fits(middle) === null) shortest = middle;
		else longest = middle;
	}

	const length = longest + 1e-6;
	let filling = 0;
	let filled = reach[0];
	const islands = runs.map((run, index) => {
		const w = widthOf(run);

		if (runs.length > open.length) {
			while (filling < rows - 1 && filled + w > length && (filled > reach[filling] || reach[filling] + w > length))
				filled = reach[++filling];
			filled += w + ISLAND_GAP;
		}

		const row = runs.length <= open.length ? open[Math.floor(((index + 0.5) * open.length) / runs.length)] : filling;
		const x = from + reach[row];
		const widths = seatWidths(run);
		const y = top + BRIDGE_ROW_TOP + row * BRIDGE_ROW;
		let along = x + ISLAND_END;

		reach[row] += w + ISLAND_GAP;

		return {
			...run,
			x,
			y,
			w,
			seats: run.keys.map((key, seat) => {
				const at = { key, x: along + SEAT_W / 2 - 0.3, y };

				along += widths[seat];

				return at;
			}),
		};
	});

	// The materializer at the top row's far end, the bridge's top right, so new sessions always start from the same place
	const farthest = Math.max(0, ...reach) - ISLAND_GAP;

	return {
		islands,
		reach: Math.max(0, ...reach.map(far => far - ISLAND_GAP)),
		lounge: lounge && { x: from },
		materializer: { x: from + farthest - MATERIALIZER_W, y: top + BRIDGE_ROW_TOP },
	};
};

// The hull round the rooms, the bow's nose beyond them, and an engine's nacelle out past the stern
export const RIM = 0.5;
export const NOSE = 2.6;
export const NACELLE = 1.8;

// Each engine's own systems, beside its reactor in the engine bay, two over two
const SYSTEMS = [
	{ key: 'library', name: 'reading' },
	{ key: 'forge', name: 'editing' },
	{ key: 'reactor', name: 'commands' },
	{ key: 'dish', name: 'web' },
];

// An engine's reactor in engineering, by its foot, one above another, each in the middle of its share of the room's
// depth
const REACTOR_HALF = 1.1;

const reactorAt = (engineering, index, count) => {
	const slot = (engineering.d - FACE - 0.4) / Math.max(1, count);
	const top = engineering.y + FACE + 0.2;

	return {
		x: engineering.x + ENGINEERING_W * 0.42,
		y: Math.min(top + slot * (index + 1) - 0.35, top + slot * (index + 0.5) + REACTOR_HALF),
	};
};

// Where compacted context goes: the recycler by engineering's door
export const recyclerAt = engineering => ({ x: engineering.x + engineering.w - 0.8, y: engineering.door.y + 1.3 });

// The materializer's pad, or the transporter's, in the middle of its room
export const clonerAt = room => ({ x: room.x + room.w / 2, y: room.y + FACE + 1.3 });

// The i-th checkout's stack in the hold
export const holdSpotAt = (hold, index) => ({ x: hold.x + 0.9 + index * POD_PITCH, y: hold.y + hold.d - 0.45 });

// The hangar's landing pad, where the hauler waits
export const padAt = hangar => ({ x: hangar.x + (hangar.w - 0.9) / 2, y: hangar.y + FACE + 1.8 });

// The nav table on the bridge, forward of the terminals
export const navAt = bridge => ({ x: bridge.x + bridge.w - BRIDGE_NAV_W / 2 - 0.2, y: bridge.y + bridge.d * 0.6 });

// A session's seat on the bridge
export const seatOf = (bridge, key) => bridge.seats?.[key];

// The aisle in front of the row of islands at `y` on the bridge, where whoever walks it goes
export const aisleOf = (bridge, y) => {
	const first = bridge.y + BRIDGE_ROW_TOP;

	return first + Math.max(0, Math.floor((y - first + 0.5) / BRIDGE_ROW)) * BRIDGE_ROW + 0.85;
};

// For each name, the shortest start of it (two letters at least) no other name begins with, so names too long for a
// narrow sign still tell apart: { name: short }
export const shortest = names => {
	const lower = names.map(name => name.toLowerCase());

	return Object.fromEntries(
		names.map((name, index) => {
			let length = Math.min(2, name.length);

			while (
				length < name.length &&
				lower.some((other, at) => at !== index && other.startsWith(lower[index].slice(0, length)))
			)
				length++;

			return [name, name.slice(0, length)];
		}),
	);
};

// The ship from stern to bow: engineering, a reactor for each engine and the systems it drives; the core, the rooms the
// work shares in two rows either side of the spine (the lounge, the materializer and the plans station above, the hold
// and the hangar below); then each project's machine on one deck or the other. Engineering is as deep as both rows and
// the spine, deeper still when it needs the room.
export const layOut = ({ bays = [], engines = [], lounge, checkouts = 0, agents = {}, fleet = 0 } = {}) => {
	// A ship of a fleet has a transporter besides, in the shipping gondola beside the hangar
	const transporter = fleet ? TRANSPORTER_W : 0;
	const system = ({ key, name }) => ({ kind: 'system', key, name, w: SYSTEM.w, d: SYSTEM.d });
	// Each project's machine stands on one deck, as wide as the project is big, into whichever deck reaches least far
	// yet; none spans two decks. A project with nothing going on is a machine all the same, after those at work, a little
	// more compact.
	const idle = bay => !bay.seated && !bay.watching;
	const order = [...bays.filter(bay => !idle(bay)), ...bays.filter(idle)].map(bay => {
		const machine = machineWidth(bay.character?.files) * (idle(bay) ? IDLE_SCALE : 1);

		return { bay, machine, w: footprintOf(machine) };
	});
	const hall = HALL_FACE + HALL_LANE;
	// Decks only as deep as a machine needs; the whole hull deep enough for the engine bay's reactors and the systems
	// stacked beside them, any more it needs shared out among its levels
	const depth = { top: DECK_TOP, bottom: DECK_BOTTOM };
	const engineCount = Math.max(1, engines.length);
	const need = Math.max(
		FACE + 0.6 + engineCount * PER_REACTOR,
		Math.max(SYSTEMS.length, engineCount * 2) * SYSTEM.d + 0.4,
	);
	const base = depth.top + hall + depth.bottom;
	const extraDepthOf = levels => Math.max(0, need - levels * base) / levels;
	const working = bays.filter(bay => bay.seated);
	// The projects at work in the order their conduits come along the spines to the bridge, top to bottom: a level's
	// at a time from the top, those over its spine first, the one nearest the bridge topmost, then those under it, the
	// one nearest the bridge lowest; the islands down the bridge in the same order, so the conduits nest rather than
	// cross on their way between them
	const inLine = placed => {
		const where = new Map(placed.map(({ bay, deck, at }) => [bay, { deck, at }]));
		const rank = bay => {
			const { deck = 0, at = 0 } = where.get(bay) ?? {};
			const under = deck % 2;

			return [Math.floor(deck / 2), under, under ? at : -at];
		};

		return [...working].sort((a, b) => {
			const [one, other] = [rank(a), rank(b)];

			return one[0] - other[0] || one[1] - other[1] || one[2] - other[2];
		});
	};
	// The lounge stays when nobody's resting in it, so the islands don't move
	const loungeBlock = lounge && { w: loungeWidth(lounge.count), d: loungeDepth(lounge.count) };
	// The hull grows in levels, a pair of decks round a spine of its own each, the first with the core's rooms beside
	// its spine and the rest starting right behind engineering: as few as keep the ship no more than about three times
	// as long as it's deep, so a hundred projects make a deeper ship rather than an endless one
	const plan = levels => {
		const reach = Array(levels * 2).fill(0);
		const placed = order.map(item => {
			const deck = reach.indexOf(Math.min(...reach));
			const at = reach[deck];

			reach[deck] += item.w;

			return { ...item, deck, at };
		});
		const width = Math.max(Math.max(0, ...reach), holdWidth(checkouts) + HANGAR_W + transporter);
		const total = levels * (base + extraDepthOf(levels));
		const rows = Math.max(1, Math.floor((total - BRIDGE_ROW_TOP - 0.4) / BRIDGE_ROW + 1e-9) + 1);
		const { reach: islandsReach } = islandsOf(inLine(placed), {
			from: 0,
			top: 0,
			rows,
			lounge: loungeBlock,
			agents,
		});
		const bridgeW = BRIDGE_MARGIN * 2 + Math.max(2 * SEAT_W, islandsReach) + BRIDGE_NAV_W;

		return { levels, placed, width, total, rows, bridgeW };
	};
	// Another level only while it shortens the ship: one that only adds empty decks under the core and the bridge isn't
	// worth its depth
	const long = ({ width, bridgeW }) => ENGINE_BAY_W + width + bridgeW;
	let layout = plan(1);

	for (let levels = 2; levels <= MAX_LEVELS && long(layout) > ASPECT * layout.total; levels++) {
		const deeper = plan(levels);

		if (long(deeper) > long(layout) - 1) break;
		layout = deeper;
	}

	const { levels, placed: packed, width, total, rows: bridgeRows, bridgeW } = layout;

	depth.top += extraDepthOf(levels) / 2;
	depth.bottom += extraDepthOf(levels) / 2;

	const level = depth.top + hall + depth.bottom;
	const left = -(ENGINE_BAY_W + width + bridgeW) / 2;
	const top = -total / 2;
	const spines = Array.from({ length: levels }, (_, index) => {
		const hallTop = top + index * level + depth.top;

		return { hallTop, lane: hallTop + HALL_FACE + HALL_LANE / 2 };
	});
	const { lane } = spines[0];
	const middle = left + ENGINE_BAY_W;
	const right = middle + width + bridgeW;
	// Each placed on its deck: the upper of a level's pair above its spine (its door on it), the lower below, open onto
	// it; only the very top and bottom decks against the hull
	const deckPart = (bay, x, w, deck, machine) => {
		const above = deck % 2 === 0;
		const spine = spines[Math.floor(deck / 2)];

		return {
			name: bay.name,
			x,
			y: above ? spine.hallTop - depth.top : spine.hallTop + hall,
			w,
			d: above ? depth.top : depth.bottom,
			face: above ? FACE : 0,
			lane: spine.lane,
			door: above
				? { x: x + w / 2, y: spine.hallTop, side: 'bottom', lane: spine.lane }
				: { x: x + w - 0.75, y: spine.hallTop + hall, side: 'top', lane: spine.lane },
			hull: { top: deck === 0, bottom: false },
			machine,
		};
	};
	// Each machine's sign on the hull, when its name won't fit: the shortest start of it no other project's shares
	const shorts = shortest(packed.map(({ bay }) => bay.name));
	const decks = packed.map(({ bay, at, w, deck, machine }) => {
		const part = deckPart(bay, middle + at, w, deck, machine);

		return { ...bay, ...part, parts: [part], short: shorts[bay.name] };
	});

	for (const deck of decks)
		for (const part of deck.parts) {
			part.sessions = deck.sessions;
			// A section's decks hold its machine and those jacked into it, nothing else
			part.props = [];
		}

	// Shipping, a gondola hung under the belly near the bow: each checkout a pod docked along it, the pad at its forward
	// end, the doors in its floor under both
	const staged = holdWidth(checkouts);
	const gondola = {
		x: middle + width - staged - HANGAR_W - transporter - 0.4,
		y: top + total,
		w: staged + HANGAR_W + transporter,
		d: GONDOLA_D,
	};
	const docked = [
		{ kind: 'hold', name: 'changes', x: gondola.x, w: staged, joined: { right: true }, unsigned: true },
		{
			kind: 'hangar',
			name: 'shipping',
			x: gondola.x + staged,
			w: HANGAR_W,
			joined: { left: true, ...(transporter && { right: true }) },
		},
		// Where you beam over to another ship, beside where the work ships out
		...(transporter
			? [
					{
						kind: 'transporter',
						name: 'transporter',
						x: gondola.x + staged + HANGAR_W,
						w: transporter,
						joined: { left: true },
					},
				]
			: []),
	].map(room => ({
		...room,
		y: gondola.y,
		d: gondola.d,
		face: FACE,
		door: { x: room.x + 0.75, y: gondola.y, side: 'top', lane: spines.at(-1).lane },
		hull: { top: false, bottom: true },
		props: [],
	}));
	const rooms = [...decks, ...docked];
	const engineering = {
		kind: 'engineering',
		name: 'engines',
		x: left,
		y: top,
		w: ENGINE_BAY_W,
		d: total,
		face: FACE,
		door: { x: middle, y: lane, side: 'right', lane },
		hull: { top: true, bottom: true, left: true },
		joined: { right: true },
		props: [],
	};
	const bridge = {
		kind: 'bridge',
		name: 'bridge',
		x: middle + width,
		y: top,
		w: bridgeW,
		d: total,
		face: FACE,
		rows: bridgeRows,
		door: { x: middle + width, y: lane, side: 'left', lane },
		hull: { top: true, bottom: true, right: true },
		props: [],
	};
	const { islands, materializer } = islandsOf(inLine(layout.placed), {
		from: bridge.x + BRIDGE_MARGIN,
		top,
		rows: bridgeRows,
		lounge: loungeBlock,
		agents,
	});
	const aboard = (room, x, w, d, y = top) => ({
		...room,
		x,
		y,
		w,
		d: Math.min(d, total),
		face: FACE,
		door: { x: x + w / 2, y: y + Math.min(d, total), side: 'bottom', lane },
		hull: { top: y === top, bottom: y + d >= top + total - 1e-9 },
		joined: { left: true, right: true },
		within: bridge,
	});

	if (lounge) {
		// At the back of the bridge's bottom rows, its foot on the bridge's floor
		const placed = aboard(
			{ ...lounge, kind: 'lounge', name: 'resting' },
			bridge.x + BRIDGE_MARGIN,
			loungeBlock.w,
			loungeBlock.d,
			top + total - Math.min(loungeBlock.d, total),
		);

		rooms.push({ ...placed, props: furnish(placed) });
	}
	// Each engine's reading, editing, commands and web in its share of the engine bay beside its reactor, two over two,
	// each with a main of its own from that reactor. Named for their engine where there's more than one, as rooms are
	// found by name.
	const slot = (total - 0.4) / engineCount;
	const row = Math.max(SYSTEM.d, slot / 2);

	engines.forEach((engine, nth) => {
		SYSTEMS.forEach((which, index) => {
			const x = left + ENGINEERING_W + (index % 2) * SYSTEM.w;
			const y = Math.min(top + nth * slot + Math.floor(index / 2) * row, top + total - SYSTEM.d);

			rooms.push({
				...system(which),
				name: engines.length > 1 ? `${which.name} · ${engine.name}` : which.name,
				engine: engine.key,
				x,
				y,
				w: SYSTEM.w,
				d: SYSTEM.d,
				face: FACE,
				door: { x: x + SYSTEM.w / 2, y: y + SYSTEM.d, side: 'bottom', lane },
				hull: { top: nth === 0 && index < 2 },
				joined: { left: true, right: true },
				within: engineering,
				// Part of the engine bay rather than a room of its own, so no sign of its own over it
				unsigned: true,
				feed: left + ENGINEERING_W * 0.42,
				props: [],
			});
		});
	});
	rooms.push({
		...aboard(
			{ kind: 'materializer', name: 'new sessions' },
			materializer.x,
			MATERIALIZER_W,
			FACE + 1.7,
			Math.max(top, materializer.y - FACE - 1.3),
		),
		props: [],
	});
	bridge.islands = islands;
	bridge.seats = Object.fromEntries(
		islands.flatMap(island => island.seats.map(seat => [seat.key, { ...seat, island }])),
	);

	const kind = name => rooms.find(room => room.kind === name);

	return {
		bays: decks,
		engines: engines.map((engine, index) => ({
			...engine,
			reactor: reactorAt(engineering, index, engines.length),
			door: engineering.door,
		})),
		// By engine and system: `${engine key}/${system key}`
		systems: Object.fromEntries(
			rooms.filter(room => room.kind === 'system').map(room => [`${room.engine}/${room.key}`, room]),
		),
		engineering,
		bridge,
		lounge: kind('lounge'),
		materializer: kind('materializer'),
		transporter: kind('transporter'),
		hold: kind('hold'),
		hangar: kind('hangar'),
		rooms: [engineering, ...rooms, bridge],
		halls: spines.map((spine, index) => ({
			x: middle,
			y: spine.hallTop,
			w: width,
			d: hall,
			face: HALL_FACE,
			lane: spine.lane,
			hull: {},
			// The airlock at the first spine's stern end, where those who come aboard come in and go out
			...(index === 0 && { airlock: { x: middle + 0.9, y: spine.hallTop + HALL_FACE, lane: spine.lane } }),
		})),
		building: { left, right, top, bottom: top + total },
		gondola,
		bounds: {
			left: left - RIM - NACELLE - 1.4,
			right: right + RIM + NOSE,
			top: top - RIM - 3.2,
			bottom: top + total + GONDOLA_D + RIM + 3.4,
		},
		radius: Math.max(right - left, total),
	};
};

const STOCK_PITCH = { x: 0.6, y: 0.5 };

// Where a system's spent stock stands on its floor, more the more it's been used lately (the most it holds still fewer
// than the uses): in rows up from the floor's near edge, clear of a door and panel there
export const stockAt = (room, uses = 0) => {
	const top = room.y + FACE + 2.8;
	const bottom = room.y + room.d - 0.3;
	const columns = Math.max(0, Math.floor((room.w - (room.door.side === 'bottom' ? 2.1 : 0.6)) / STOCK_PITCH.x));
	const rows = Math.max(0, Math.floor((bottom - top) / STOCK_PITCH.y) + 1);
	const count = Math.min(columns * rows, Math.ceil(Math.sqrt(uses) * 1.6));

	return Array.from({ length: count }, (_, index) => ({
		x: room.x + 0.45 + (index % columns) * STOCK_PITCH.x,
		y: bottom - Math.floor(index / columns) * STOCK_PITCH.y,
	}));
};

// The usage console by a system's door, by its foot
export const panelAt = room => ({
	x: room.door.x - 0.95,
	y: room.door.side === 'bottom' ? room.y + room.d - 0.35 : room.y + FACE + 0.75,
});
