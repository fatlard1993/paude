import { clonerAt, navAt } from './plan';
import { CABINET_W, COUCH_SEAT, DOOR, cabinetAt, loungeSeatAt } from './station';

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
// there are several of a kind. `couches`: how many the lounge has (it keeps one when nobody's resting)
export const footprintsOf = (layout, { couches = 0 } = {}) => {
	const { bridge, lounge, materializer, transporter } = layout;
	const found = [];

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

	return transporter ? found.filter(thing => !inside(thing, clonerAt(transporter))) : found;
};

const inside = (box, { x, y }) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.d;

// The map of a laid-out ship's floor with `things` (footprintsOf) standing on it. Rooms and halls are open floor from
// under their far wall's face to their near edge; a room with a door onto a hall is walled from it but for the
// doorway, and from the rooms beside it unless it's joined to them; rooms within another (the lounge on the bridge)
// are part of its floor.
export const floorOf = (layout, things = []) => {
	const { left, right, top, bottom } = layout.building ?? { left: 0, right: 0, top: 0, bottom: 0 };
	const columns = Math.max(1, Math.ceil((right - left) / CELL));
	const rows = Math.max(1, Math.ceil((bottom - top) / CELL));
	const cells = new Uint8Array(columns * rows);
	const column = x => Math.floor((x - left) / CELL + 1e-9);
	const row = y => Math.floor((y - top) / CELL + 1e-9);
	const within = (across, down) => across >= 0 && across < columns && down >= 0 && down < rows;
	// Every cell a box covers, at least the one its corner is in
	const fill = ({ x, y, w, d }, kind, { only } = {}) => {
		for (let down = row(y); down <= row(y + d - 1e-6); down++)
			for (let across = column(x); across <= column(x + w - 1e-6); across++) {
				if (!within(across, down)) continue;
				if (only !== undefined && cells[down * columns + across] !== only) continue;
				cells[down * columns + across] = kind;
			}
	};
	const rooms = (layout.rooms ?? []).filter(room => !room.within);

	for (const hall of layout.halls ?? []) fill(hall, FLOOR);
	for (const room of rooms) {
		const face = room.face ?? 0;

		fill({ x: room.x, y: room.y + face, w: room.w, d: room.d - face }, FLOOR);
	}
	for (const room of rooms) {
		const { door, joined = {} } = room;
		const face = room.face ?? 0;
		const floor = { y: room.y + face, d: room.d - face };

		// Its walls to the rooms beside it
		if (!joined.left) fill({ x: room.x, w: CELL, ...floor }, WALL);
		if (!joined.right) fill({ x: room.x + room.w - CELL, w: CELL, ...floor }, WALL);
		// Its wall to the hall its door is on, the doorway left open; a room under its hall is open onto it
		if (door?.side === 'bottom') {
			fill({ x: room.x, y: room.y + room.d - CELL, w: room.w, d: CELL }, WALL);
			fill({ x: door.x - DOOR / 2, y: room.y + room.d - CELL, w: DOOR, d: CELL }, FLOOR);
		}
		if (door?.side === 'left' || door?.side === 'right') {
			const x = door.side === 'left' ? room.x : room.x + room.w - CELL;

			fill({ x, w: CELL, ...floor }, WALL);
			fill({ x, y: door.y - DOOR / 2, w: CELL, d: DOOR }, FLOOR);
		}
	}
	for (const thing of things) fill(thing, SOLID, { only: FLOOR });

	const kindAt = ({ x, y }) => (within(column(x), row(y)) ? cells[row(y) * columns + column(x)] : VOID);

	return {
		left,
		top,
		columns,
		rows,
		cells,
		things,
		kindAt,
		open: point => kindAt(point) === FLOOR,
		// The middle of the cell a point is in, and of a cell by its column and row
		middleOf: (across, down) => ({ x: left + (across + 0.5) * CELL, y: top + (down + 0.5) * CELL }),
		cellOf: ({ x, y }) => ({ across: column(x), down: row(y) }),
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

// Whether the straight line between two points crosses only open floor
export const clearBetween = (floor, from, to) => {
	const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (CELL / 2));

	for (let step = 0; step <= steps; step++) {
		const along = steps ? step / steps : 0;

		if (!floor.open({ x: from.x + (to.x - from.x) * along, y: from.y + (to.y - from.y) * along })) return false;
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
				// Across a corner only where both cells beside it are open
				if (
					stepAcross &&
					stepDown &&
					(!openAt(here.across + stepAcross, here.down) || !openAt(here.across, here.down + stepDown))
				)
					continue;

				const so = cost[index(here)] + Math.hypot(stepAcross, stepDown);

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
	const corners = [way[0]];

	// Pulled straight: from each corner kept, on to the farthest point the floor's clear to
	for (let at = 0; at < way.length - 1;) {
		let far = at + 1;

		for (let next = way.length - 1; next > at + 1; next--)
			if (clearBetween(floor, way[at], way[next])) {
				far = next;
				break;
			}
		corners.push(way[far]);
		at = far;
	}

	return corners.slice(1);
};
