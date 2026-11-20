import { join } from 'path';

import { expect, test } from 'bun:test';

import { holdSpotAt, layOut, rowPitch } from './plan';

test('a ship laid again and again from where its islands stood keeps one shape: it never turns between two', async () => {
	// What a live ship gave the planner when it turned between two hulls at every answer, cut down to what still did
	// and its names replaced. Two islands kept a gap apart came out a hair short of it one way round and not the other;
	// the one that didn't fit went to its row's end, the bridge grew, the hull took a level, and the order the islands
	// are placed in, which goes by the hull's levels, turned back.
	const given = await Bun.file(join(import.meta.dir, 'planTurning.fixture.json')).json();
	const keptOf = bridge => Object.fromEntries(bridge.islands.map(({ key, row, at }) => [key, { row, at }]));
	const shapeOf = ({ building, bridge }) =>
		JSON.stringify([
			Object.values(building).map(value => value.toFixed(2)),
			bridge.islands.map(({ key, x, y }) => [key, x.toFixed(2), y.toFixed(2)]),
		]);
	let laid = layOut(structuredClone(given));
	const shapes = [];

	for (let turn = 0; turn < 8; turn++) {
		laid = layOut({ ...structuredClone(given), kept: keptOf(laid.bridge) });
		shapes.push(shapeOf(laid));
	}
	// Settled by the second laying, and the same from then on
	expect(new Set(shapes.slice(1)).size).toBe(1);
	// And every island a gap clear of its neighbours in its row
	for (const row of new Set(laid.bridge.islands.map(({ row }) => row))) {
		const inRow = laid.bridge.islands.filter(island => island.row === row).sort((a, b) => a.x - b.x);

		for (const [index, island] of inRow.slice(1).entries())
			expect(island.x - (inRow[index].x + inRow[index].w)).toBeGreaterThan(0);
	}
});

test("an island keeps its place from the aft wall when the rows change under it, and one at a row's start stays there", () => {
	const given = {
		bays: [
			{ name: 'one', sessions: ['local/a'], seated: 1 },
			{ name: 'two', sessions: ['local/b'], seated: 1 },
		],
		engines: [],
	};
	const first = layOut(structuredClone(given));
	const keptOf = bridge => Object.fromEntries(bridge.islands.map(({ key, row, at }) => [key, { row, at }]));
	const again = layOut({ ...structuredClone(given), kept: keptOf(first.bridge) });
	const places = ({ bridge }) => bridge.islands.map(({ key, row, x }) => [key, row, (x - bridge.x).toFixed(3)]);

	// Laid from itself, nothing moves; and where each stood is never before its row's start
	expect(places(again)).toEqual(places(first));
	for (const { at } of again.bridge.islands) expect(at).toBeGreaterThanOrEqual(0);

	// Kept a hair before the start, as arithmetic can leave it: still its place, not a new one found for it
	const nudged = Object.fromEntries(
		Object.entries(keptOf(first.bridge)).map(([key, { row, at }]) => [key, { row, at: at - 1e-12 }]),
	);

	expect(places(layOut({ ...structuredClone(given), kept: nudged }))).toEqual(places(first));
});

// A project split over islands is one block: its islands one above another down consecutive rows, each where the others
// are along them
const stackedAsOne = (bridge, name) => {
	const own = bridge.islands.filter(island => island.name === name).sort((a, b) => a.row - b.row);

	expect(own.length).toBeGreaterThan(1);
	own.forEach((island, index) => {
		expect(island.row).toBe(own[0].row + index);
		expect(island.x).toBeCloseTo(own[0].x, 5);
	});
};

test('a project split over islands has them stacked as one block, never cut where a row ends, laid fresh or again', () => {
	const bay = (name, count) => ({
		name,
		hue: 40,
		seated: count,
		sessions: Array.from({ length: count }, (_, n) => `${name}${n}`),
	});

	for (const before of [0, 1, 3, 4, 6]) {
		const bays = [
			...Array.from({ length: before }, (_, n) => bay(`small${n}`, 1)),
			bay('big', 15),
			...Array.from({ length: 6 }, (_, n) => bay(`after${n}`, n % 3 ? 1 : 4)),
		];
		const { bridge } = layOut({ bays });

		stackedAsOne(bridge, 'big');

		// Laid again from where they stood, with one of its islands kept rows away from the others: they come together
		const kept = Object.fromEntries(bridge.islands.map(({ key, row, at }) => [key, { row, at }]));
		const far = bridge.islands.reduce((most, island) => Math.max(most, island.row), 0);

		kept['big#1'] = { row: kept['big#0'].row === far ? 0 : far, at: 0 };
		stackedAsOne(layOut({ bays, kept }).bridge, 'big');
	}
});

test("the bridge has as many rows as its height holds with each row's conduits fitting, not a few far apart", () => {
	const seats = index => 1 + ((index * 2) % 6);
	const bays = Array.from({ length: 21 }, (_, index) => ({
		name: `p${index}`,
		seated: seats(index),
		sessions: Array.from({ length: seats(index) }, (_, seat) => `p${index}-${seat}`),
	}));
	const { bridge } = layOut({ bays, checkouts: 7, lounge: { count: 20, cabinets: [] } });

	expect(rowPitch(bridge.islands)).toBeLessThanOrEqual(bridge.pitch + 1e-9);
	// Spacing the rows by what the last laying needed and laying them again ratcheted this one to four
	expect(bridge.rows).toBe(5);
});

test('the hold stacks its pods in tiers, four abreast, rather than running on along the deck', () => {
	const holdOf = checkouts => layOut({ bays: [{ name: 'p', seated: 1, sessions: ['p-0'] }], checkouts });
	const one = holdOf(1);
	const seven = holdOf(7);
	const spots = Array.from({ length: 7 }, (_, index) => holdSpotAt(seven.hold, index));

	expect(seven.hold.columns).toBe(4);
	expect(seven.hold.w).toBeCloseTo(holdOf(4).hold.w, 5);
	expect(seven.hold.d).toBeGreaterThan(one.hold.d);
	expect(seven.bridge.d).toBeGreaterThan(one.bridge.d);
	// The second tier above the first, each pod over the one in its column below
	expect(spots[4].x).toBeCloseTo(spots[0].x, 5);
	expect(spots[4].y).toBeLessThan(spots[0].y);
	spots.forEach(({ y }) => expect(y).toBeGreaterThan(seven.hold.y));
});

test("the MCP servers' bank is a column of the engine bay's own, wider for more servers rather than crowded, every rack inside it", () => {
	const engines = [{ key: 'local', name: 'local' }];
	const servers = count => Array.from({ length: count }, (_, index) => `mcp:server${index}`);
	const without = layOut({ engines });

	expect(without.uplinks).toBeUndefined();

	const banks = [1, 5, 12, 30].map(count => layOut({ engines, uplinks: servers(count) }));

	for (const [nth, { uplinks: bank, engineering, systems }] of banks.entries()) {
		// Between the systems and the trunk, in the engine bay, which grows by its width
		expect(bank.x).toBeGreaterThanOrEqual(Math.max(...Object.values(systems).map(({ x, w }) => x + w)) - 1e-9);
		expect(bank.x + bank.w).toBeLessThan(engineering.x + engineering.w);
		expect(engineering.w).toBeCloseTo(without.engineering.w + bank.w);
		// A rack for each server, each clear of the bank's sides and floor, none on another
		expect(bank.racks.map(({ key }) => key)).toEqual(servers([1, 5, 12, 30][nth]));
		for (const rack of bank.racks) {
			expect(rack.x - 0.25).toBeGreaterThan(bank.x);
			expect(rack.x + 0.25).toBeLessThan(bank.x + bank.w);
			expect(rack.y).toBeLessThan(bank.y + bank.d);
		}
		expect(new Set(bank.racks.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)).size).toBe(bank.racks.length);
	}
	// More servers, a wider bank, never a deeper ship
	const widths = banks.map(({ uplinks }) => uplinks.w);

	expect(widths).toEqual([...widths].sort((a, b) => a - b));
	expect(widths.at(-1)).toBeGreaterThan(widths[0]);
	expect(banks.at(-1).building.bottom - banks.at(-1).building.top).toBeCloseTo(
		without.building.bottom - without.building.top,
	);
});
