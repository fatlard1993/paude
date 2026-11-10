import { expect, test } from 'bun:test';

import {
	CELL,
	FLOOR,
	SOLID,
	WALL,
	clearBetween,
	floorOf,
	footprintsOf,
	nearestOpen,
	pathAcross,
	standingSpot,
} from './floor';
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
	// A machine for each project's deck, the engine bay's four systems and its tank, the tug on its pad
	expect(kinds.filter(kind => kind === 'machine')).toHaveLength(layout.bays.flatMap(({ parts }) => parts).length);
	expect(kinds.filter(kind => kind === 'system')).toHaveLength(4);
	expect(kinds).toContain('tank');
	expect(kinds).toContain('tug');
	// What's told of what isn't the layout's to know: the hold's pods, the other ships' terminals
	expect(kinds).not.toContain('pod');
	expect(
		footprintsOf(layout, { pods: 2, terminals: [{ x: 1, y: 2 }] })
			.map(({ kind }) => kind)
			.filter(kind => ['pod', 'terminal'].includes(kind)),
	).toEqual(['pod', 'pod', 'terminal']);
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
	// A bay over its hall: the hall's far wall between them, open at the bay's door
	expect(floor.kindAt({ x: bay.x + bay.w * 0.1, y: bay.y + bay.d + CELL / 2 })).toBe(WALL);
	expect(floor.kindAt({ x: bay.door.x, y: bay.y + bay.d + CELL / 2 })).toBe(FLOOR);
	// Under a project's machine the floor is shut; before it, open
	const machine = footprintsOf(layout).find(({ kind }) => kind === 'machine');

	expect(floor.kindAt({ x: machine.x + machine.w / 2, y: machine.y + machine.d / 2 })).toBe(SOLID);
	// Every hall is open at both its ends, into the engine bay and onto the bridge, along its lane
	for (const each of layout.halls)
		for (const [inside, outside] of [
			[each.x + CELL / 2, each.x - CELL / 2],
			[each.x + each.w - CELL / 2, each.x + each.w + CELL / 2],
		])
			expect(clearBetween(floor, { x: inside, y: each.lane }, { x: outside, y: each.lane })).toBe(true);
	// The bridge is walled from the bay beside it: no way from one to the other but round by the hall
	const beside = layout.bays.find(({ x, w }) => Math.abs(x + w - layout.bridge.x) < 1e-9);
	const level = { y: beside.y + beside.d - 0.5 };

	expect(floor.open({ x: layout.bridge.x - CELL / 2, ...level })).toBe(true);
	expect(floor.open({ x: layout.bridge.x + CELL / 2, ...level })).toBe(true);
	expect(
		clearBetween(floor, { x: layout.bridge.x - CELL / 2, ...level }, { x: layout.bridge.x + CELL / 2, ...level }),
	).toBe(false);
	// A wall takes no floor: the cells either side of the wall between two bays are both open, with no way between
	const [one, next] = layout.bays.filter(({ door }) => door.side === 'bottom');
	const between = { y: one.y + one.d - 0.5 };

	expect(Math.abs(one.x + one.w - next.x)).toBeLessThan(1e-9);
	expect(floor.open({ x: next.x - CELL / 2, ...between })).toBe(true);
	expect(floor.open({ x: next.x + CELL / 2, ...between })).toBe(true);
	expect(clearBetween(floor, { x: next.x - CELL / 2, ...between }, { x: next.x + CELL / 2, ...between })).toBe(false);
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
	const wall = bay.y + bay.d + CELL / 2;
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

test('somewhere to stand is open floor that nobody else has, the place wanted when that is free', () => {
	const layout = laid();
	const floor = floorWith(layout);
	const { lounge } = layout;
	const wanted = { x: lounge.x + lounge.w / 2 - 1.2, y: lounge.y + lounge.d - 0.75 };

	expect(floor.open(wanted)).toBe(true);
	expect(standingSpot(floor, wanted)).toBe(wanted);

	// Ten asking for the one place are each given their own, on open floor, apart from the rest
	const stood = [];

	for (let turn = 0; turn < 10; turn++) stood.push(standingSpot(floor, wanted, stood));
	for (const [index, spot] of stood.entries()) {
		expect(floor.open(spot)).toBe(true);
		for (const other of stood.slice(index + 1))
			expect(Math.hypot(spot.x - other.x, spot.y - other.y)).toBeGreaterThanOrEqual(0.55 - 1e-9);
	}
	// Somewhere under a couch is no place to stand: the open floor beside it is given
	const couch = floor.things.find(({ kind }) => kind === 'couch');
	const under = { x: couch.x + couch.w / 2, y: couch.y + couch.d / 2, facing: 1 };
	const beside = standingSpot(floor, under);

	expect(floor.open(under)).toBe(false);
	expect(floor.open(beside)).toBe(true);
	expect(beside.facing).toBe(1);
	expect(Math.hypot(beside.x - under.x, beside.y - under.y)).toBeLessThan(1.2);
});
