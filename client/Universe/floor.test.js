import { expect, test } from 'bun:test';

import { CELL, FLOOR, SOLID, WALL, clearBetween, floorOf, footprintsOf, nearestOpen, pathAcross } from './floor';
import { layOut } from './plan';

const laid = () =>
	layOut({
		bays: [
			{ name: 'paude', sessions: ['a', 'b'], seated: 2 },
			{ name: 'site', sessions: ['c'], seated: 1 },
			{ name: 'notes', sessions: [], seated: 0 },
		],
		engines: [{ key: 'here', name: 'here' }],
		lounge: { count: 3, sessions: ['x', 'y', 'z'], cabinets: [{ id: 'game' }] },
		checkouts: 1,
	});

const floorWith = layout => floorOf(layout, footprintsOf(layout, { couches: 2 }));

test('everything that stands on the floor has one footprint, inside the room it stands in', () => {
	const layout = laid();
	const things = footprintsOf(layout, { couches: 2 });
	const kinds = things.map(({ kind }) => kind);

	expect(kinds.filter(kind => kind === 'island')).toHaveLength(layout.bridge.islands.length);
	expect(kinds.filter(kind => kind === 'couch')).toHaveLength(2);
	expect(kinds).toContain('cabinet');
	expect(kinds).toContain('television');
	expect(kinds).toContain('cloner');
	expect(kinds).toContain('reactor');
	for (const thing of things.filter(({ kind }) => ['couch', 'cabinet', 'television'].includes(kind))) {
		expect(thing.x).toBeGreaterThanOrEqual(layout.lounge.x);
		expect(thing.x + thing.w).toBeLessThanOrEqual(layout.lounge.x + layout.lounge.w);
		expect(thing.y + thing.d).toBeLessThanOrEqual(layout.lounge.y + layout.lounge.d + 1e-9);
	}
	// One couch always stands, waiting, when nobody's resting
	expect(footprintsOf(layout).filter(({ kind }) => kind === 'couch')).toHaveLength(1);
});

test('the floor is open in the rooms and halls, shut under what stands on it, and walled between a room and its hall but for the doorway', () => {
	const layout = laid();
	const floor = floorWith(layout);
	const [hall] = layout.halls;
	const island = layout.bridge.islands[0];
	const bay = layout.bays.find(({ door }) => door.side === 'bottom');

	expect(floor.kindAt({ x: hall.x + hall.w / 2, y: hall.lane })).toBe(FLOOR);
	expect(floor.kindAt({ x: island.x + island.w / 2, y: island.y })).toBe(SOLID);
	// The bridge's floor in the aisle before an island is open
	expect(floor.open({ x: island.x + island.w / 2, y: island.y + 0.8 })).toBe(true);
	// A bay over its hall: its wall to the hall, open at its door
	expect(floor.kindAt({ x: bay.x + bay.w * 0.1, y: bay.y + bay.d - CELL / 2 })).toBe(WALL);
	expect(floor.kindAt({ x: bay.door.x, y: bay.y + bay.d - CELL / 2 })).toBe(FLOOR);
	// Outside the hull there's no floor
	expect(floor.open({ x: layout.building.left - 5, y: 0 })).toBe(false);
	// What's given no footprint leaves the floor as it was
	expect(floorOf(layout).kindAt({ x: island.x + island.w / 2, y: island.y })).toBe(FLOOR);
});

test('the way across the floor goes from room to room by their doors and round what stands in the way, and nowhere through it', () => {
	const layout = laid();
	const floor = floorWith(layout);
	const bay = layout.bays.find(({ door }) => door.side === 'bottom');
	const from = { x: bay.x + bay.w / 2, y: bay.y + bay.d - 0.6 };
	const cabinet = footprintsOf(layout, { couches: 2 }).find(({ kind }) => kind === 'cabinet');
	const to = { x: cabinet.x - 0.5, y: cabinet.y + cabinet.d / 2 };
	const way = pathAcross(floor, from, to);

	expect(way).not.toBeNull();
	expect(way.length).toBeGreaterThan(1);
	expect(Math.hypot(way.at(-1).x - to.x, way.at(-1).y - to.y)).toBeLessThan(CELL);
	// Every leg of it over open floor
	[nearestOpen(floor, from), ...way].forEach((point, index, all) => {
		if (all[index + 1]) expect(clearBetween(floor, point, all[index + 1])).toBe(true);
	});
	// Through the bay's doorway: where the way crosses the bay's near wall, it's within the door
	const wall = bay.y + bay.d - CELL / 2;
	const legs = [nearestOpen(floor, from), ...way];
	const crossing = legs.findIndex((point, index) => legs[index + 1] && point.y <= wall && legs[index + 1].y > wall);
	const [above, below] = [legs[crossing], legs[crossing + 1]];
	const across = above.x + ((below.x - above.x) * (wall - above.y)) / (below.y - above.y);

	expect(crossing).toBeGreaterThanOrEqual(0);
	expect(Math.abs(across - bay.door.x)).toBeLessThanOrEqual(0.4 + CELL);
	// A place under something is reached at the open floor beside it
	const island = layout.bridge.islands[0];
	const seat = { x: island.x + island.w / 2, y: island.y };
	const beside = pathAcross(floor, from, seat).at(-1);

	expect(floor.open(beside)).toBe(true);
	expect(Math.hypot(beside.x - seat.x, beside.y - seat.y)).toBeLessThan(1);
	// And there's no way to somewhere off the ship
	expect(pathAcross(floor, from, { x: layout.building.left - 20, y: 0 })).toBeNull();
});
