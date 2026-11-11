import { join } from 'path';

import { expect, test } from 'bun:test';

import { layOut } from './plan';

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
