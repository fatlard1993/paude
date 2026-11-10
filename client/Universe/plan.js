import {
	FACE,
	HALL_FACE,
	HALL_LANE,
	SCREEN_RISE,
	HALL_TRAY_IN,
	UNIT,
	cableStep,
	cableWeight,
	furnish,
	loungeDepth,
	loungeWidth,
	footprintOf,
	machineWidth,
} from './station';

// Where everything aboard stands, in world units: rooms, seats, and the spots things move between
const ENGINEERING_W = 3.4;
// How deep each of a level's decks is, above its spine and below
const DECK_TOP = FACE + 1.9;
const DECK_BOTTOM = 2.4;
const PER_REACTOR = 2.4;
// A system's room in the engine bay
const SYSTEM = { w: 2.6, d: FACE + 2.3 };
// Room left between the systems and the bay's inner wall for the channel their streams leave by
const TRUNK_W = 0.4;
const ENGINE_BAY_W = ENGINEERING_W + SYSTEM.w + TRUNK_W;
// One engine's systems full size in a column down the bay; more engines' compact, half as wide and shallower, two over
// two beside each reactor, so the bay keeps one engine's width and the hull its depth for up to four engines (the
// ship's zoom steps by whole numbers, so a little more length can halve it)
const COMPACT = { w: SYSTEM.w / 2, d: FACE + 1.2 };
// How tall a system's unit stands from its foot, in art pixels
export const systemTallOf = room => (room.compact ? 16 : 33);
const HANGAR_W = 2.6;
const POD_PITCH = 1.7;
// The staged part of the shipping bay, long enough for each checkout's pod
const holdWidth = checkouts => Math.max(2.4, checkouts * POD_PITCH + 0.6);
const MATERIALIZER_W = 1.8;
// How deep the materializer and transporter stand on the bridge, from its foot
const STATION_D = 2.4;
// How far they stand from the bridge's aft wall
const STATION_HUG = 0.3;
// How far up off the bridge's foot they stand, clear of its near wall, which is drawn in front of what's at its foot
const STATION_CLEAR = 0.6;
// The transporter, on a ship of a fleet: its pad, and the console that hears from the other ships
const TRANSPORTER_W = 2.2;
// The bridge at the bow: every session's grey at a terminal in rows up its depth, wired to its project's machine aft,
// whoever watches walking among them; the nav table, the ship's log and the scanner forward of them, by the nose
const BRIDGE_NAV_W = 1.2;
const BRIDGE_MARGIN = 0.8;
// The room left at the bridge's forward end, along its near wall, for an unmanned terminal for each other ship
const fleetRoom = ships => (ships ? 0.4 + ships * 1.8 : 0);
// The room left along the bridge's aft wall, before its islands and lounge, for a conduit's riser for each project with
// an island, side by side as thick as each can get (a pixel more for each of its sessions at its desk, to five) with
// their outlines and a gap between, and the walk along it
// Rounded up to a whole unit, with room to spare, so it grows only now and then and the islands beside it seldom move
const sternRoom = islands =>
	Math.max(
		BRIDGE_MARGIN,
		Math.ceil((9 + islands.reduce((sum, { sessions = [] }) => sum + Math.min(5, 1 + sessions.length) + 4, 0)) / 20),
	);
// How long to deep the hull may get before it takes another level, and how many it takes at most; an idle machine's
// size against a working one's
const ASPECT = 3;
const MAX_LEVELS = 6;
const IDLE_SCALE = 0.75;
const BRIDGE_ROW_TOP = FACE + 1.3;
// Its islands: one console for each project being worked on, its greys seated side by side behind it; rows far enough
// apart that a grey's head clears the console behind it, with an aisle between for whoever walks the bridge
const BRIDGE_ROW = 2.8;
// How many times the rows are spread out further, at most, as spreading them puts more islands in each
const PITCH_TRIES = 8;
const SEAT_W = 1.5;
// The most an island's seats run across before it's split, in world units: six plain seats
const ISLAND_SEATS_W = 6 * SEAT_W;
// A subagent's small terminal to the left of its grey's seat, as many as are shown, and the room before the first of
// them, so the farthest one's terminal still stands within the seat's own room
const SMALL_W = 0.8;
const SMALL_ROOM = 0.55;
const MOST_SMALL = 4;
// A short-lived session sits on the floor past its island's desk's end rather than at a seat on it, its laptop between
// it and the desk's end, each later one past the last: the room each takes, and how far into it it sits
export const BRIEF_W = 1.7;
export const BRIEF_SIT = 1.3;
// Where a fabled session's monitor stands, to the right of its grey: a seat only as wide as a grey puts it
// under the next seat's screen
export const WATCHER_W = 0.7;
const ISLAND_END = 0.3;
const ISLAND_GAP = 0.6;

// `keys` (seats as wide as `widthOf` says) in runs of at most ISLAND_SEATS_W across, as few runs as that takes and as
// even as they can be, in order
export const splitSeats = (keys, widthOf) => {
	const total = keys.reduce((sum, key) => sum + widthOf(key), 0);
	const parts = Math.max(1, Math.ceil(total / ISLAND_SEATS_W - 1e-9));
	const runs = [];
	let run = [];
	let filled = 0;

	for (const key of keys) {
		// Past its even share, the next run starts, while there are runs left to start
		if (run.length && filled + widthOf(key) / 2 > (total / parts) * (runs.length + 1) && runs.length < parts - 1) {
			runs.push(run);
			run = [];
		}
		run.push(key);
		filled += widthOf(key);
	}

	return [...runs, run];
};

// The islands of the bridge `from` its stern edge down `rows`, for the bays at work: [{ name, hue, keys, x, y, w,
// seats: [{ key, x, y, floor }] }], and how far forward they reach (`floor`: a short-lived session's place on the
// floor past the desk's end)
// `stern`: how much of the bridge from its aft wall `from` is past, the risers' room, so where an island stood is kept
// from the wall itself, and an island stays put as the risers' room grows unless it grows into it
const islandsOf = (
	bays,
	{ from, top, rows, lounge, stations = 0, agents = {}, watched = {}, brief = {}, pitch = BRIDGE_ROW, kept, stern = 0 },
) => {
	// The room a seat's small terminals take to its left
	const smallRoom = key => (agents[key] > 0 ? SMALL_ROOM + Math.min(MOST_SMALL, agents[key]) * SMALL_W : 0);
	// A seat, with its small terminals and its monitor's standing room; a short-lived session's place on the floor
	const seatWidth = key => (brief[key] ? BRIEF_W : SEAT_W + smallRoom(key) + (watched[key] ? WATCHER_W : 0));
	// One island for each project, in the order given (the order their conduits come to the bridge); one seating more
	// than an island holds split into as few as hold it, its seats shared out evenly, so no row runs on for one project.
	// Its short-lived sessions last, past its desk's end
	const runs = bays.flatMap(({ name, hue, sessions = [] }) =>
		splitSeats([...sessions.filter(key => !brief[key]), ...sessions.filter(key => brief[key])], seatWidth).map(
			keys => ({ name, hue, keys }),
		),
	);
	// The lounge's room first, in the bottom rows it covers, so the islands pack round it; then each island into whichever
	// row reaches least far yet, so short ones fill in beside long ones
	const reach = Array(rows).fill(0);
	// (less a hair, so a lounge exactly two rows deep isn't rounded up to three)
	const covers = lounge ? Math.min(rows, Math.ceil((lounge.d - 0.6) / pitch - 1e-9)) : 0;

	for (let row = rows - covers; row < rows; row++) reach[row] = lounge.w + ISLAND_GAP;
	// The materializer and transporter at the aft end of the bottom row, where the islands start past them
	const stationRows = stations ? Math.min(rows, Math.ceil((STATION_D + STATION_CLEAR - 0.6) / pitch - 1e-9)) : 0;

	for (let row = rows - stationRows; row < rows; row++)
		reach[row] += Math.max(0, STATION_HUG + stations - stern) + ISLAND_GAP;
	// With fewer islands than rows left open, they spread evenly down the bridge
	const open = Array.from({ length: rows }, (_, row) => row).filter(row => row < rows - covers);
	const seatWidths = run => run.keys.map(seatWidth);
	// Its desk, and all the room it takes along its row: its desk and the floor past its end its short-lived sit on
	const deskOf = run =>
		ISLAND_END + run.keys.filter(key => !brief[key]).reduce((sum, key) => sum + seatWidth(key), 0) + 0.3;
	const widthOf = run => deskOf(run) + run.keys.filter(key => brief[key]).length * BRIEF_W;
	// More than the open rows: down the rows in order, as short a bridge as holds them all, each row starting from what's
	// already in it (the lounge)
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
	const counts = new Map();
	const keyed = runs.map(run => {
		const nth = counts.get(run.name) ?? 0;

		counts.set(run.name, nth + 1);

		return { run, key: `${run.name}#${nth}`, w: widthOf(run) };
	});
	// Laid out before (`kept`: each island's row and where along it it stood, by its project and which of its it is),
	// each stays where it stood while it still fits there, so islands don't move as others come, go and grow; one that
	// no longer fits, or a new one, into the first gap wide enough in its row (or the row reaching least far)
	const keptOf = key => {
		const entry = kept?.[key];

		if (typeof entry === 'number') return { row: entry };

		return entry && { ...entry, at: typeof entry.at === 'number' ? entry.at - stern : undefined };
	};
	const taken = Array.from({ length: rows }, (_, row) => (reach[row] ? [[0, reach[row] - ISLAND_GAP]] : []));
	const free = (row, at, w) =>
		taken[row].every(([start, end]) => at + w + ISLAND_GAP <= start || at >= end + ISLAND_GAP);
	const take = (row, at, w) => {
		taken[row].push([at, at + w]);
		taken[row].sort((a, b) => a[0] - b[0]);
		reach[row] = Math.max(reach[row], at + w + ISLAND_GAP);
	};
	const gapIn = (row, w) => {
		let at = 0;

		for (const [start, end] of taken[row]) {
			if (at + w + ISLAND_GAP <= start) return at;
			at = Math.max(at, end + ISLAND_GAP);
		}

		return at;
	};
	const placed = new Map();

	if (kept)
		for (const { key, w } of keyed) {
			const { row, at } = keptOf(key) ?? {};

			if (!Number.isInteger(row) || row >= rows || typeof at !== 'number' || at < 0 || !free(row, at, w)) continue;
			take(row, at, w);
			placed.set(key, { row, at });
		}

	const islands = keyed.map(({ run, key, w }, index) => {
		let spot = placed.get(key);

		if (!spot && kept) {
			const keptRow = keptOf(key)?.row;
			const row = Number.isInteger(keptRow) && keptRow < rows ? keptRow : reach.indexOf(Math.min(...reach));

			spot = { row, at: gapIn(row, w) };
			take(row, spot.at, w);
		}
		if (!spot) {
			if (runs.length > open.length) {
				while (filling < rows - 1 && filled + w > length && (filled > reach[filling] || reach[filling] + w > length))
					filled = reach[++filling];
				filled += w + ISLAND_GAP;
			}

			const row = runs.length <= open.length ? open[Math.floor(((index + 0.5) * open.length) / runs.length)] : filling;

			spot = { row, at: reach[row] };
			reach[row] += w + ISLAND_GAP;
		}

		const x = from + spot.at;
		const widths = seatWidths(run);
		const y = top + BRIDGE_ROW_TOP + spot.row * pitch;
		let along = x + ISLAND_END;

		const desk = deskOf(run);

		return {
			...run,
			key,
			row: spot.row,
			// Where along its row it stands from the bridge's aft wall, kept to stand there again
			at: spot.at + stern,
			x,
			y,
			w: desk,
			seats: run.keys.map((seatKey, seat) => {
				// A short-lived one on the floor past the desk's end, each after the last
				if (brief[seatKey]) {
					const start = Math.max(along, x + desk);

					along = start + BRIEF_W;

					return { key: seatKey, x: start + BRIEF_SIT - 0.3, y, floor: true };
				}

				// Its own room first, then its small greys' to its right (`smalls`, how much), then its monitor's
				const smalls = smallRoom(seatKey);
				const at = { key: seatKey, x: along + SEAT_W / 2 - 0.3, y, ...(smalls && { smalls }) };

				along += widths[seat];

				return at;
			}),
		};
	});

	// The lounge at the forward end of the rows it covers, past their islands, so every island has a clear way to the
	// aft wall its conduit comes down: its room was kept at the start of those rows, so they move back into it
	const covered = row => row >= rows - covers;
	const shift = lounge ? lounge.w + ISLAND_GAP : 0;
	const past = Math.max(0, ...reach.filter((_, row) => covered(row)).map(far => far - shift));

	for (const island of islands) {
		if (!covered(Math.round((island.y - top - BRIDGE_ROW_TOP) / pitch))) continue;
		island.x -= shift;
		for (const seat of island.seats) seat.x -= shift;
	}

	return {
		islands,
		reach: Math.max(0, ...reach.map(far => far - ISLAND_GAP)),
		lounge: lounge && { x: from + past },
	};
};

// The hull round the rooms, the bow's nose beyond them, and an engine's nacelle out past the stern
export const RIM = 0.5;
export const NOSE = 2.6;
export const NACELLE = 1.3;

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
// How far a reactor's foot keeps from the spine's lane, above it (its unit's height) and below it (the catwalk's)
const SPINE_CLEAR = { above: 0.3, below: 2.3 };

const reactorAt = (engineering, index, count) => {
	const slot = (engineering.d - FACE - 0.4) / Math.max(1, count);
	const top = engineering.y + FACE + 0.2;

	const y = Math.min(top + slot * (index + 1) - 0.35, top + slot * (index + 0.5) + REACTOR_HALF);
	// Kept off the spine's catwalk where it crosses the bay: a unit standing on it is pushed down clear of it
	const lane = engineering.door.y;
	const clear = y > lane - SPINE_CLEAR.above && y < lane + SPINE_CLEAR.below ? lane + SPINE_CLEAR.below : y;

	return { x: engineering.x + ENGINEERING_W * 0.42, y: Math.min(clear, engineering.y + engineering.d - 0.3) };
};

// Where compacted context goes: the recycler by engineering's door
export const recyclerAt = engineering => ({ x: engineering.x + engineering.w - 0.8, y: engineering.door.y + 1.3 });

// The materializer's pad, or the transporter's, in the middle of its room
export const clonerAt = room => ({ x: room.x + room.w / 2, y: room.y + FACE + 1.3 });

// The i-th checkout's stack in the hold
export const holdSpotAt = (hold, index) => ({ x: hold.x + 0.9 + index * POD_PITCH, y: hold.y + hold.d - 0.45 });

// The hangar's landing pad, where the hauler waits
export const padAt = hangar => ({ x: hangar.x + (hangar.w - 0.9) / 2, y: hangar.y + (hangar.face ?? FACE) + 1.8 });

// The nav table on the bridge, forward of the terminals
// The airlock in the bridge's far wall, over its nav table where no island stands, where those who come aboard come in
// and go out: its doorway's middle, at the foot of the wall
// How far below the foot of the bridge's far wall the airlock's sill is, in world units: its hatch is taller than the
// wall it's in, a person's height, and has nowhere to be taller but down (over it is the hull)
export const AIRLOCK_DROP = 1.1;

export const airlockAt = bridge => ({ x: navAt(bridge).x, y: bridge.y + (bridge.face ?? FACE) + AIRLOCK_DROP });

export const navAt = bridge => ({ x: bridge.x + bridge.w - BRIDGE_NAV_W / 2 - 0.2, y: bridge.y + bridge.d * 0.6 });

// A session's seat on the bridge
export const seatOf = (bridge, key) => bridge.seats?.[key];

// The aisle in front of the row of islands at `y` on the bridge, where whoever walks it goes
// Where someone stands before an island, nearest `y`: just in front of its console, their head below its screens and
// their feet above the next row's, which rise into the aisle
export const standingOf = (bridge, y) => aisleOf(bridge, y) - 0.6;

// Where whoever walks a row of the bridge goes, nearest `y`: down its aisle over the conduits laid there, clear of the
// console before them and above the next row's screens
export const walkwayOf = (bridge, y) => aisleOf(bridge, y) - 0.1;

export const aisleOf = (bridge, y) => {
	const first = bridge.y + BRIDGE_ROW_TOP;
	const pitch = bridge.pitch ?? BRIDGE_ROW;

	return first + Math.max(0, Math.floor((y - first + 0.5) / pitch)) * pitch + 0.85;
};

// How far apart the rows of `islands` must stand for the conduits along each to fit the aisle under it, clear of the
// next row's screens: a row's nearest island's conduit along its consoles' foot, each further one a cable below the last
// (as the conduits are laid), each as thick as every seat at its island wired up would make it; never less than
// BRIDGE_ROW, and a pixel to spare for where the art rounds them
export const rowPitch = islands => {
	const rows = new Map();

	for (const island of islands) rows.set(island.y, [...(rows.get(island.y) ?? []), island]);

	const deepest = Math.max(
		0,
		...[...rows.values()].map(row => {
			const weights = row.sort((a, b) => a.x - b.x).map(({ keys = [] }) => cableWeight(keys.length));

			return weights.length < 2
				? 0
				: weights.slice(1).reduce((below, weight, index) => below + cableStep(weights[index], weight), 0) +
						Math.ceil(weights.at(-1) / 2) +
						1;
		}),
	);

	return Math.max(BRIDGE_ROW, (deepest + 2 + SCREEN_RISE) / UNIT.y);
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
// work shares in two rows either side of the spine (the lounge and the plans station above, the hold, the hangar and
// the materializer on the bridge); then each project's machine on one deck or the other. Engineering is as deep as both rows and
// the spine, deeper still when it needs the room.
// `kept`: the rows the bridge's islands stood in last time, by island key, so they stay in them
export const layOut = ({
	bays = [],
	engines = [],
	lounge,
	checkouts = 0,
	agents = {},
	watched = {},
	brief = {},
	fleet = 0,
	terminals = fleet,
	kept,
} = {}) => {
	// A ship of a fleet has a transporter besides, on the bridge beside the materializer
	const transporter = fleet ? TRANSPORTER_W : 0;
	const stationsW = MATERIALIZER_W + transporter + fleetRoom(terminals);
	const system = ({ key, name }) => ({ kind: 'system', key, name, w: SYSTEM.w, d: SYSTEM.d });
	// Each project's machine stands on one deck, as wide as the project is big, into whichever deck reaches least far
	// yet, in the order given (which keeps each where it was); none spans two decks. A project with nothing going on is
	// a machine all the same, a little more compact.
	const idle = bay => !bay.seated && !bay.watching;
	const order = bays.map(bay => {
		const machine = machineWidth(bay.character?.files) * (idle(bay) ? IDLE_SCALE : 1);

		return { bay, machine, w: footprintOf(machine) };
	});
	// The halls' height, tall enough for the conduits along the busiest to run inside it, one for each project on its
	// level's decks (`placed`, each with its deck), as thick as every seat at it wired up would make it; never less
	// than a hall's own height
	const hallFor = placed => {
		const levels = new Map();

		for (const { bay, deck } of placed)
			levels.set(Math.floor(deck / 2), [...(levels.get(Math.floor(deck / 2)) ?? []), cableWeight(bay.seated ?? 0)]);

		const tallest = Math.max(
			0,
			...[...levels.values()].map(
				along => along.slice(1).reduce((sum, weight, index) => sum + cableStep(along[index], weight), 0) + along[0],
			),
		);

		return Math.max(HALL_FACE + HALL_LANE, (tallest + HALL_TRAY_IN * 2 + 1) / UNIT.y);
	};
	// Decks only as deep as a machine needs; the whole hull deep enough for the engine bay's reactors and the systems
	// stacked beside them, any more it needs shared out among its levels
	const depth = { top: DECK_TOP, bottom: DECK_BOTTOM };
	const engineCount = Math.max(1, engines.length);
	const compact = engineCount > 1;
	const unit = compact ? COMPACT : SYSTEM;
	const across = compact ? 2 : 1;
	const bayW = ENGINE_BAY_W;
	const need = Math.max(
		FACE + 0.6 + engineCount * PER_REACTOR,
		Math.max(SYSTEMS.length * SYSTEM.d, ((engineCount * SYSTEMS.length) / across) * unit.d) + 0.4,
	);
	const extraDepthOf = (levels, hall) => Math.max(0, need - levels * (depth.top + hall + depth.bottom)) / levels;
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
	const cabinets = lounge?.cabinets?.length ?? 0;
	const loungeBlock = lounge && { w: loungeWidth(lounge.count, cabinets), d: loungeDepth(lounge.count, cabinets) };
	// The hull grows in levels, a pair of decks round a spine of its own each, the first with the core's rooms beside
	// its spine and the rest starting right behind engineering: as few as keep the ship no more than about three times
	// as long as it's deep, so a hundred projects make a deeper ship rather than an endless one
	const plan = levels => {
		const reach = Array(levels * 2).fill(0);
		// Shipping takes the bridge's end of the bottom deck: counted there while the machines are shared out, so the
		// decks come out even with it
		const shipping = reach.map((_, deck) => (deck === levels * 2 - 1 ? holdWidth(checkouts) + HANGAR_W : 0));
		const reaching = deck => reach[deck] + shipping[deck];
		const placed = order.map(item => {
			const deck = reach.map((_, index) => index).sort((a, b) => reaching(a) - reaching(b))[0];
			const at = reach[deck];

			reach[deck] += item.w;

			return { ...item, deck, at };
		});
		const width = Math.max(0, ...reach.map((_, deck) => reaching(deck)));
		const hall = hallFor(placed);
		const total = levels * (depth.top + hall + depth.bottom + extraDepthOf(levels, hall));
		// The rows as far apart as their conduits need, worked out again while spreading them changes how many fit
		const rowsAt = pitch => Math.max(1, Math.floor((total - BRIDGE_ROW_TOP - 0.4) / pitch + 1e-9) + 1);
		const islandsAt = pitch =>
			islandsOf(inLine(placed), {
				from: 0,
				top: 0,
				rows: rowsAt(pitch),
				lounge: loungeBlock,
				stations: stationsW,
				agents,
				watched,
				brief,
				pitch,
				kept,
				stern: sternRoom(inLine(placed)),
			});
		let pitch = BRIDGE_ROW;
		let laid = islandsAt(pitch);

		for (let tries = 0; tries < PITCH_TRIES && rowPitch(laid.islands) > pitch + 1e-9; tries++) {
			pitch = rowPitch(laid.islands);
			laid = islandsAt(pitch);
		}

		const rows = rowsAt(pitch);
		const { reach: islandsReach } = laid;
		const bridgeW = sternRoom(inLine(placed)) + BRIDGE_MARGIN + Math.max(2 * SEAT_W, islandsReach) + BRIDGE_NAV_W;

		return { levels, placed, width, total, rows, pitch, bridgeW, hall };
	};
	// Another level only while it shortens the ship: one that only adds empty decks under the core and the bridge isn't
	// worth its depth
	const long = ({ width, bridgeW }) => bayW + width + bridgeW;
	let layout = plan(1);

	for (let levels = 2; levels <= MAX_LEVELS && long(layout) > ASPECT * layout.total; levels++) {
		const deeper = plan(levels);

		if (long(deeper) > long(layout) - 1) break;
		layout = deeper;
	}

	const { levels, placed: packed, width, total, rows: bridgeRows, pitch: rowsApart, bridgeW, hall } = layout;

	const extra = extraDepthOf(levels, hall);

	depth.top += extra / 2;
	depth.bottom += extra / 2;

	const level = depth.top + hall + depth.bottom;
	const left = -(bayW + width + bridgeW) / 2;
	const top = -total / 2;
	const spines = Array.from({ length: levels }, (_, index) => {
		const hallTop = top + index * level + depth.top;

		return { hallTop, lane: hallTop + HALL_FACE + HALL_LANE / 2 };
	});
	const { lane } = spines[0];
	const middle = left + bayW;
	const right = middle + width + bridgeW;
	// Each placed on its deck: the upper of a level's pair above its spine (its door on it), the lower below, open onto
	// it; only the very top and bottom decks against the hull
	const deckPart = (bay, x, w, deck, machine) => {
		const above = deck % 2 === 0;
		const spine = spines[Math.floor(deck / 2)];
		const y = above ? spine.hallTop - depth.top : spine.hallTop + hall;
		const d = above ? depth.top : depth.bottom;

		return {
			name: bay.name,
			x,
			y,
			w,
			d,
			face: above ? FACE : 0,
			lane: spine.lane,
			door: above
				? { x: x + w / 2, y: spine.hallTop, side: 'bottom', lane: spine.lane }
				: { x: x + w - 0.75, y: spine.hallTop + hall, side: 'top', lane: spine.lane },
			hull: { top: deck === 0, bottom: y + d >= top + total - 1e-9 },
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

	// Shipping, in the hull: at the bridge's end of the bottom deck, where its projects' machines leave off, each
	// checkout a pod docked along it and the pad beside them; what's pushed drops out through the belly under it
	const staged = holdWidth(checkouts);
	const bottomSpine = spines.at(-1);
	const shipping = { x: middle + width - staged - HANGAR_W, y: bottomSpine.hallTop + hall, d: depth.bottom };
	const docked = [
		{ kind: 'hold', name: 'changes', x: shipping.x, w: staged, joined: { right: true }, unsigned: true },
		{ kind: 'hangar', name: 'shipping', x: shipping.x + staged, w: HANGAR_W, joined: { left: true } },
	].map(room => ({
		...room,
		y: shipping.y,
		d: shipping.d,
		face: 0,
		door: { x: room.x + room.w / 2, y: shipping.y, side: 'top', lane: bottomSpine.lane },
		hull: { top: false, bottom: true },
		props: [],
	}));
	const rooms = [...decks, ...docked];
	const engineering = {
		kind: 'engineering',
		name: 'engines',
		x: left,
		y: top,
		w: bayW,
		d: total,
		face: FACE,
		door: { x: middle, y: lane, side: 'right', lane },
		// The way in from its door: up the trunk between its units and its inner wall, the units filling the rest of its
		// height
		aisle: middle - TRUNK_W / 2,
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
		pitch: rowsApart,
		door: { x: middle + width, y: lane, side: 'left', lane },
		hull: { top: true, bottom: true, right: true },
		props: [],
	};
	const stern = sternRoom(inLine(layout.placed));
	const { islands, lounge: loungeAt } = islandsOf(inLine(layout.placed), {
		from: bridge.x + stern,
		top,
		rows: bridgeRows,
		lounge: loungeBlock,
		stations: stationsW,
		agents,
		watched,
		brief,
		pitch: rowsApart,
		kept,
		stern,
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
			loungeAt.x,
			loungeBlock.w,
			loungeBlock.d,
			top + total - Math.min(loungeBlock.d, total),
		);

		rooms.push({ ...placed, props: furnish(placed) });
	}
	// Where new sessions are made, and on a ship of a fleet the transporter's pad and the terminals watching the other
	// ships, stand at the aft end of the bridge's foot against its wall, the islands starting beyond them
	const stations = bridge.x + STATION_HUG;

	rooms.push(
		aboard(
			{ kind: 'materializer', name: 'new sessions', props: [] },
			stations,
			MATERIALIZER_W,
			STATION_D,
			top + total - STATION_D - STATION_CLEAR,
		),
		...(transporter
			? [
					aboard(
						{ kind: 'transporter', name: 'transporter', props: [] },
						stations + MATERIALIZER_W,
						transporter,
						STATION_D,
						top + total - STATION_D - STATION_CLEAR,
					),
				]
			: []),
	);
	// Each engine's reading, editing, commands and web in its share of the engine bay beside its reactor, each with a main of its own from that reactor. Named for their engine where there's more than one, as rooms are
	// found by name.
	const slot = (total - 0.4) / engineCount;
	const rows = SYSTEMS.length / across;
	const row = Math.max(unit.d, slot / rows);

	engines.forEach((engine, nth) => {
		SYSTEMS.forEach((which, index) => {
			const x = left + ENGINEERING_W + (index % across) * unit.w;
			const y = Math.min(top + nth * slot + Math.floor(index / across) * row, top + total - unit.d);

			rooms.push({
				...system(which),
				name: engines.length > 1 ? `${which.name} · ${engine.name}` : which.name,
				engine: engine.key,
				x,
				y,
				w: unit.w,
				d: unit.d,
				compact,
				face: FACE,
				door: { x: x + unit.w / 2, y: y + unit.d, side: 'bottom', lane },
				hull: { top: nth === 0 && index < across },
				joined: { left: true, right: true },
				within: engineering,
				// Part of the engine bay rather than a room of its own, so no sign of its own over it
				unsigned: true,
				// Its main starts at its engine's bus, up the inner side of the reactors' column
				feed: busAt(engineering),
				props: [],
			});
		});
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
		halls: spines.map(spine => ({
			x: middle,
			y: spine.hallTop,
			w: width,
			d: hall,
			face: HALL_FACE,
			lane: spine.lane,
			hull: {},
		})),
		building: { left, right, top, bottom: top + total },

		tube: tubeOf(bridge, kind('hold'), top + total),
		bounds: {
			left: left - RIM - NACELLE - 1.4,
			right: right + RIM + NOSE,
			top: top - RIM - 3.2,
			bottom: top + total + RIM + 3.4,
		},
		radius: Math.max(right - left, total),
	};
};

// The parcel tube from the bridge to the hold, as a bank's: down the bridge's aft wall (`trunk`) from the pipes in its
// ceiling over the islands, along the floor by its near wall (`rail`) aft to over the hold (`drop`), and down through
// the belly to a hopper over its stacks (`hopper`)
const tubeOf = (bridge, hold, bottom) => {
	if (!bridge || !hold) return null;

	return {
		trunk: bridge.x + 0.3,
		rail: bottom - 0.12,
		drop: hold.x + hold.w - 0.45,
		hopper: hold.y + (hold.face ?? FACE) + 0.35,
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

// Where a system's unit stands in its room, by its foot
// Where an engine's bus rises, up the inner side of the reactors' column, each of its systems' mains starting from it
export const busAt = engineering => engineering.x + ENGINEERING_W - 0.2;

export const systemFootOf = room =>
	room.compact
		? { x: room.x + room.w / 2, y: room.y + FACE + 1 }
		: { x: room.x + (room.w - 0.9) / 2, y: room.y + FACE + 2.1 };

// A compact unit's console is on its own face
export const panelAt = room =>
	room.compact
		? systemFootOf(room)
		: {
				x: room.door.x - 0.95,
				y: room.door.side === 'bottom' ? room.y + room.d - 0.35 : room.y + FACE + 0.75,
			};
