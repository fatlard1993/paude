import { clonerAt, holdSpotAt, navAt, padAt, systemFootOf } from './plan';
import { CABINET_W, COUCH_SEAT, DOOR, FACE, cabinetAt, housingOf, loungeSeatAt } from './station';

// The floor of a ship as one map, read by whatever needs to know what stands where: a grid of cells over the hull, each
// open floor or not, made from the layout's rooms and halls and from a footprint for each thing that stands on the
// floor. One footprint a thing: what walks, what's stood somewhere, and what's drawn before or behind what all ask the
// same map, rather than each keeping a list of its own of what's in the way.

// A cell's side, in world units: fine enough for a doorway to be a few cells across
export const CELL = 0.25;

// What a cell is: outside the rooms (or a wall's face), open floor, a wall, or under something that stands on the floor
export const VOID = 0;
export const FLOOR = 1;
export const WALL = 2;
export const SOLID = 3;

// How far before and behind where a thing stands its footprint reaches, in world units, by what it is: `back` the way
// of the far wall, `front` the way of the viewer
const DEPTHS = {
	island: { back: 0.55, front: 0.3 },
	couch: { back: 0.5, front: 0.15 },
	cabinet: { back: 0.4, front: 0.1 },
	television: { back: 0.25, front: 0.1 },
	cloner: { back: 0.35, front: 0.15 },
	nav: { back: 0.4, front: 0.2 },
	reactor: { back: 0.6, front: 0.2 },
	prop: { back: 0.25, front: 0.1 },
	system: { back: 0.55, front: 0.15 },
	tank: { back: 0.35, front: 0.2 },
	pod: { back: 0.5, front: 0.15 },
	tug: { back: 0.45, front: 0.2 },
	terminal: { back: 0.4, front: 0.1 },
	rack: { back: 0.35, front: 0.15 },
	pad: { back: 0.3, front: 0.2 },
};

const footprint = (kind, { left, right, y }, more = {}) => ({
	kind,
	x: left,
	y: y - DEPTHS[kind].back,
	w: right - left,
	d: DEPTHS[kind].back + DEPTHS[kind].front,
	...more,
});

// Everything that stands on a laid-out ship's floor, each a box in world units: { kind, x, y, w, d }, and `key` where
// there are several of a kind; one that's stood on rather than in the way (the transporter's pad) is `open`.
// `couches`: how many the lounge has (it keeps one when nobody's resting); `pods`: how many checkouts are docked in
// the hold; `terminals`: where the other ships' terminals stand on the bridge ([{ x, y }]); `racks`: where a rack of
// processes stands by an island or a machine while a session there runs some ([{ x, y }])
export const footprintsOf = (layout, { couches = 0, pods = 0, terminals = [], racks = [] } = {}) => {
	const { bridge, lounge, materializer, transporter, engineering, hold, hangar } = layout;
	const found = [];

	// Each project's machine, from its deck's ceiling down to near its front
	for (const bay of layout.bays ?? [])
		for (const part of bay.parts ?? []) {
			const housing = housingOf(part);
			const top = part.y + (part.face ?? 0);

			found.push({ kind: 'machine', key: bay.name, x: housing.x, y: top, w: housing.w, d: housing.floor - top });
		}
	// Each engine's reading, editing, commands and web, and the fuel tank over the first reactor
	for (const room of (layout.rooms ?? []).filter(({ kind }) => kind === 'system')) {
		const foot = systemFootOf(room);

		found.push(footprint('system', { left: foot.x - 0.5, right: foot.x + 0.5, y: foot.y }, { key: room.name }));
	}
	if (engineering) {
		const x = layout.engines?.[0]?.reactor?.x ?? engineering.x + 1.5;

		found.push(
			footprint('tank', { left: x - 0.5, right: x + 0.5, y: engineering.y + (engineering.face ?? FACE) + 0.35 }),
		);
	}
	// Shipping: each checkout's pod docked in the hold, and the tug on the hangar's pad
	for (let pod = 0; hold && pod < pods; pod++) {
		const at = holdSpotAt(hold, pod);

		found.push(footprint('pod', { left: at.x - 0.6, right: at.x + 0.6, y: at.y }, { key: pod }));
	}
	if (hangar) {
		const at = padAt(hangar);

		found.push(footprint('tug', { left: at.x - 0.2, right: at.x + 1.1, y: at.y }));
	}
	// The other ships' terminals on the bridge, by the transporter
	terminals.forEach(({ x, y }, index) =>
		found.push(footprint('terminal', { left: x - 0.9, right: x + 0.75, y }, { key: index })),
	);

	for (const island of bridge?.islands ?? [])
		found.push(footprint('island', { left: island.x, right: island.x + island.w, y: island.y }, { key: island.key }));
	if (bridge) {
		const nav = navAt(bridge);

		found.push(footprint('nav', { left: nav.x - 0.5, right: nav.x + 0.5, y: nav.y }));
	}
	if (lounge) {
		const middle = lounge.x + lounge.w / 2 - 0.3;

		for (let couch = 0; couch < Math.max(1, couches); couch++) {
			const seat = loungeSeatAt(lounge, couch * 2);

			found.push(
				footprint(
					'couch',
					{ left: seat.x - COUCH_SEAT / 2 - 0.1, right: seat.x + COUCH_SEAT * 1.5 + 0.1, y: seat.y },
					{ key: couch },
				),
			);
		}
		found.push(footprint('television', { left: middle - 0.6, right: middle + 0.6, y: lounge.y + lounge.d - 0.15 }));
		(lounge.cabinets ?? []).forEach((cabinet, index) => {
			const at = cabinetAt(lounge, index);

			found.push(
				footprint('cabinet', { left: at.x - CABINET_W / 2, right: at.x + CABINET_W / 2, y: at.y }, { key: cabinet.id }),
			);
		});
		for (const prop of lounge.props ?? [])
			found.push(footprint('prop', { left: prop.x - 0.3, right: prop.x + 0.3, y: prop.y }, { key: prop.kind }));
	}
	// The materializer's tube stands in the way; the transporter's pad is stood on
	if (materializer) {
		const at = clonerAt(materializer);

		found.push(footprint('cloner', { left: at.x - 0.4, right: at.x + 0.4, y: at.y }));
	}
	for (const engine of layout.engines ?? []) {
		if (!engine.reactor) continue;
		found.push(
			footprint(
				'reactor',
				{ left: engine.reactor.x - 0.6, right: engine.reactor.x + 0.6, y: engine.reactor.y },
				{ key: engine.key },
			),
		);
	}

	racks.forEach(({ x, y }, index) =>
		found.push(footprint('rack', { left: x - 0.3, right: x + 0.3, y }, { key: index })),
	);
	// The transporter's pad: there to be seen on the map, but stood on, so not in anyone's way
	if (transporter) {
		const at = clonerAt(transporter);

		found.push(footprint('pad', { left: at.x - 0.45, right: at.x + 0.45, y: at.y }, { open: true }));
	}

	return found;
};

// The map of a laid-out ship's floor with `things` (footprintsOf) standing on it. Rooms and halls are open floor from
// under their far wall's face to their near edge. Walls take no floor: each cell knows which room or hall it's in
// (`regions`; a room within another, the lounge on the bridge, is part of its floor), and the way from a cell to the
// next is shut when they're in different ones, but through a doorway (`doors`): a room over a hall has its door
// through the hall's far wall; a room under its hall is open onto it all along; every hall is open at both its ends,
// into the engine bay and onto the bridge.
export const floorOf = (layout, things = [], { quiet: keptOff = [] } = {}) => {
	const { left, right, top, bottom } = layout.building ?? { left: 0, right: 0, top: 0, bottom: 0 };
	const columns = Math.max(1, Math.ceil((right - left) / CELL));
	const rows = Math.max(1, Math.ceil((bottom - top) / CELL));
	const cells = new Uint8Array(columns * rows);
	const regions = new Int16Array(columns * rows);
	const doors = new Uint8Array(columns * rows);
	// Floor that's open but kept off (`quiet` boxes): a way goes round it unless it starts or ends there
	const quiet = new Uint8Array(columns * rows);
	const column = x => Math.floor((x - left) / CELL + 1e-9);
	const row = y => Math.floor((y - top) / CELL + 1e-9);
	const within = (across, down) => across >= 0 && across < columns && down >= 0 && down < rows;
	// Every cell a box covers, at least the one its corner is in
	const each = ({ x, y, w, d }, visit) => {
		for (let down = row(y); down <= row(y + d - 1e-6); down++)
			for (let across = column(x); across <= column(x + w - 1e-6); across++)
				if (within(across, down)) visit(down * columns + across);
	};
	const fill = (box, kind, { only, region } = {}) =>
		each(box, at => {
			if (only !== undefined && cells[at] !== only) return;
			cells[at] = kind;
			if (region !== undefined) regions[at] = region;
		});
	const doorway = box =>
		each(box, at => {
			doors[at] = 1;
		});
	const halls = layout.halls ?? [];
	const rooms = (layout.rooms ?? []).filter(room => !room.within);

	// A hall's far wall, under the rooms over it, is the wall between them: its face takes the hall's top
	halls.forEach((hall, index) => {
		fill(hall, FLOOR, { region: index + 1 });
		fill({ x: hall.x, y: hall.y, w: hall.w, d: hall.face ?? 0 }, WALL);
	});
	rooms.forEach((room, index) => {
		const face = room.face ?? 0;

		fill({ x: room.x, y: room.y + face, w: room.w, d: room.d - face }, FLOOR, { region: halls.length + index + 1 });
	});
	for (const room of rooms) {
		const { door } = room;

		// Over a hall: its doorway through the hall's far wall, from the room's near edge down onto the hall's floor
		if (door?.side === 'bottom') {
			const hall = halls.find(({ y }) => Math.abs(y - door.y) < 1e-6);
			const gap = { x: door.x - DOOR / 2, w: DOOR };

			if (!hall) continue;
			fill({ ...gap, y: hall.y, d: hall.face ?? 0 }, FLOOR, { only: WALL });
			doorway({ ...gap, y: door.y - CELL, d: CELL * 2 });
		}
		// Under its hall: open onto it all along
		if (door?.side === 'top') doorway({ x: room.x, y: door.y - CELL, w: room.w, d: CELL * 2 });
	}
	// A hall runs the ship's length: where it meets the engine bay and the bridge, they're open to it, whichever hall
	// their own door is on
	for (const hall of halls)
		for (const x of [hall.x - CELL, hall.x + hall.w - CELL])
			doorway({ x, y: hall.lane - DOOR / 2, w: CELL * 2, d: DOOR });
	for (const thing of things) if (!thing.open) fill(thing, SOLID, { only: FLOOR });
	for (const box of keptOff)
		each(box, at => {
			quiet[at] = 1;
		});

	const kindAt = ({ x, y }) => (within(column(x), row(y)) ? cells[row(y) * columns + column(x)] : VOID);
	// Whether the way from one cell to one beside it is open: both floor, and in the same room, or through a doorway
	const passable = (from, to) =>
		cells[from] === FLOOR &&
		cells[to] === FLOOR &&
		(regions[from] === regions[to] || (doors[from] === 1 && doors[to] === 1));

	return {
		left,
		top,
		columns,
		rows,
		cells,
		regions,
		doors,
		quiet,
		things,
		kindAt,
		passable,
		open: point => kindAt(point) === FLOOR,
		// The middle of the cell a point is in, and of a cell by its column and row
		middleOf: (across, down) => ({ x: left + (across + 0.5) * CELL, y: top + (down + 0.5) * CELL }),
		cellOf: ({ x, y }) => ({ across: column(x), down: row(y) }),
		indexOf: ({ x, y }) => (within(column(x), row(y)) ? row(y) * columns + column(x) : -1),
	};
};

// The nearest open cell to a point, as that cell's middle: the point's own when it's open, else the closest within
// `reach` world units (a seat at a console is under its island's footprint: the way to it ends on the floor beside
// it); null when there's none
export const nearestOpen = (floor, point, reach = 1.5) => {
	const { across, down } = floor.cellOf(point);
	let best = null;

	for (let ring = 0; ring <= Math.ceil(reach / CELL) && !best; ring++)
		for (let offset = -ring; offset <= ring; offset++)
			for (const [stepAcross, stepDown] of [
				[offset, -ring],
				[offset, ring],
				[-ring, offset],
				[ring, offset],
			]) {
				const middle = floor.middleOf(across + stepAcross, down + stepDown);

				if (!floor.open(middle)) continue;

				const far = Math.hypot(middle.x - point.x, middle.y - point.y);

				if (!best || far < best.far) best = { ...middle, far };
			}

	return best && { x: best.x, y: best.y };
};

// Somewhere to stand: `wanted` itself when it's open floor and nobody of `taken` ([{ x, y }]) stands within `apart` of
// it, else the nearest open cell that is, so no two are given one place and nobody is stood in a wall or a couch.
// `wanted` back when there's nowhere within `reach`.
export const standingSpot = (floor, wanted, taken = [], { apart = 0.55, reach = 3 } = {}) => {
	const free = point => floor.open(point) && taken.every(({ x, y }) => Math.hypot(x - point.x, y - point.y) >= apart);

	if (free(wanted)) return wanted;

	const { across, down } = floor.cellOf(wanted);
	let best = null;

	for (let ring = 1; ring <= Math.ceil(reach / CELL) && !best; ring++)
		for (let offset = -ring; offset <= ring; offset++)
			for (const [stepAcross, stepDown] of [
				[offset, -ring],
				[offset, ring],
				[-ring, offset],
				[ring, offset],
			]) {
				const middle = floor.middleOf(across + stepAcross, down + stepDown);

				if (!free(middle)) continue;

				const far = Math.hypot(middle.x - wanted.x, middle.y - wanted.y);

				if (!best || far < best.far) best = { ...middle, far };
			}

	return best ? { ...wanted, x: best.x, y: best.y } : wanted;
};

// What a step onto floor that's kept off costs, as so many steps on any other: enough to go a long way round it
const KEPT_OFF = 12;

// Whether the straight line between two points crosses only open floor, and no wall between rooms but by a doorway;
// and, asked to keep off (`quiet`: false), no floor that's kept off either
export const clearBetween = (floor, from, to, { quiet = true } = {}) => {
	const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (CELL / 4));
	let last = -1;

	for (let step = 0; step <= steps; step++) {
		const along = steps ? step / steps : 0;
		const at = floor.indexOf({ x: from.x + (to.x - from.x) * along, y: from.y + (to.y - from.y) * along });

		if (at < 0 || floor.cells[at] !== FLOOR) return false;
		if (!quiet && floor.quiet[at]) return false;
		if (last >= 0 && at !== last && !floor.passable(last, at)) return false;
		last = at;
	}

	return true;
};

// The way across the floor from one point to another over open cells only, as the corners to walk between: found
// cell by cell (never cutting a corner of something in the way), then pulled straight wherever the floor between two
// of its corners is clear. Each end is taken to the nearest open cell. null when there's no way.
export const pathAcross = (floor, from, to) => {
	const [start, goal] = [nearestOpen(floor, from), nearestOpen(floor, to)];

	if (!start || !goal) return null;

	const { columns, rows } = floor;
	const index = ({ across, down }) => down * columns + across;
	const [first, last] = [floor.cellOf(start), floor.cellOf(goal)];
	const cost = new Float64Array(columns * rows).fill(Infinity);
	const came = new Int32Array(columns * rows).fill(-1);
	const openAt = (across, down) =>
		across >= 0 && across < columns && down >= 0 && down < rows && floor.cells[down * columns + across] === FLOOR;
	const ahead = ({ across, down }) => Math.hypot(across - last.across, down - last.down);
	const waiting = [{ ...first, guess: ahead(first) }];

	cost[index(first)] = 0;
	while (waiting.length) {
		let nearest = 0;

		for (let which = 1; which < waiting.length; which++)
			if (waiting[which].guess < waiting[nearest].guess) nearest = which;

		const [here] = waiting.splice(nearest, 1);

		if (here.across === last.across && here.down === last.down) break;
		for (let stepDown = -1; stepDown <= 1; stepDown++)
			for (let stepAcross = -1; stepAcross <= 1; stepAcross++) {
				const next = { across: here.across + stepAcross, down: here.down + stepDown };

				if ((!stepAcross && !stepDown) || !openAt(next.across, next.down)) continue;
				if (!floor.passable(index(here), index(next))) continue;
				// Across a corner only where both cells beside it are open, and the way through either of them is: from here
				// into it and from it on, so no corner of a wall is cut where a doorway's edge meets it
				if (
					stepAcross &&
					stepDown &&
					[
						{ across: here.across + stepAcross, down: here.down },
						{ across: here.across, down: here.down + stepDown },
					].some(
						beside =>
							!openAt(beside.across, beside.down) ||
							!floor.passable(index(here), index(beside)) ||
							!floor.passable(index(beside), index(next)),
					)
				)
					continue;

				const so = cost[index(here)] + Math.hypot(stepAcross, stepDown) * (floor.quiet[index(next)] ? KEPT_OFF : 1);

				if (so >= cost[index(next)]) continue;
				cost[index(next)] = so;
				came[index(next)] = index(here);
				waiting.push({ ...next, guess: so + ahead(next) });
			}
	}
	if (cost[index(last)] === Infinity) return null;

	const cellsBack = [];

	for (let at = index(last); at !== -1; at = came[at])
		cellsBack.push(floor.middleOf(at % columns, Math.floor(at / columns)));

	const way = [start, ...cellsBack.reverse().slice(1, -1), goal];
	// Bound for somewhere kept off, or setting out from it, the way may be pulled straight across it; otherwise it
	// keeps the way round that was found
	const bound = Boolean(floor.quiet[index(first)] || floor.quiet[index(last)]);
	const corners = [way[0]];

	// Pulled straight: from each corner kept, on to the farthest point the floor's clear to
	for (let at = 0; at < way.length - 1;) {
		let far = at + 1;

		for (let next = way.length - 1; next > at + 1; next--)
			if (clearBetween(floor, way[at], way[next], { quiet: bound })) {
				far = next;
				break;
			}
		corners.push(way[far]);
		at = far;
	}

	return corners.slice(1);
};
