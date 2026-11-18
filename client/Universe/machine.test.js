import { expect, test } from 'bun:test';

import { drawHousing } from './machine';

const surface = new Proxy(function () {}, { get: () => surface, set: () => true, apply: () => surface });
const art = ({ x, y }) => ({ x: Math.round(x * 20), y: Math.round(y * 14) });

test('a machine crowded with sockets keeps them on its pylons inside its deck, never up into the hall over it', () => {
	const housing = { x: 0, w: 2, floor: 3, middle: 1 };
	const floor = art({ x: 0, y: housing.floor }).y;

	for (const count of [1, 4, 14, 30]) {
		const sockets = { left: Array(Math.ceil(count / 2)).fill(true), right: Array(Math.floor(count / 2)).fill(true) };

		for (const ceiling of [floor - 20, floor - 40, floor - 120]) {
			const { socket } = drawHousing(surface, art, housing, {
				top: ceiling,
				hue: 200,
				state: 'ready',
				time: 0,
				sockets,
			});

			for (const [side, list] of [
				[-1, sockets.left],
				[1, sockets.right],
			])
				list.forEach((_, index) => {
					expect(socket(side, index).y).toBeGreaterThan(ceiling);
					expect(socket(side, index).y).toBeLessThan(floor);
				});
		}
	}
});

test('a machine with room for its sockets keeps them a full pitch apart', () => {
	const housing = { x: 0, w: 2, floor: 10, middle: 1 };
	const sockets = { left: [true, true, true], right: [true, true] };
	const { socket } = drawHousing(surface, art, housing, { top: 0, hue: 200, state: 'ready', time: 0, sockets });

	expect(socket(-1, 1).y - socket(-1, 0).y).toBe(11);
});
