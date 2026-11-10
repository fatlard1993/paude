import { expect, test } from 'bun:test';

import { FLEET_GAP, fleetBox, placeShips, panelLeft } from './shown';

test('the view takes in every ship shown: the stretch of the stage they cover together, and none for one alone', () => {
	const aboard = { extent: { left: -300, right: 320, top: -150, height: 300 }, at: { x: 0, y: 0 } };
	// Stood below the one aboard, its bow in line, a little longer
	const below = { extent: { left: -360, right: 340, top: -200, height: 400 }, at: { x: -20, y: 560 } };

	// Alone, the ship is framed as it always is: on its bridge
	expect(fleetBox([])).toBeNull();
	expect(fleetBox([aboard])).toBeNull();
	expect(fleetBox([aboard, below])).toEqual({ left: -380, right: 320, top: -150, bottom: 760 });
	// Whichever order they come in
	expect(fleetBox([below, aboard])).toEqual(fleetBox([aboard, below]));
});

test('a ship shown stands below the one aboard, bows in line; what the view takes in is where it will stand, not where it slides in from', () => {
	const aboard = { key: 'here', extent: { right: 320, top: -150, height: 300 }, aboard: true };
	const other = { key: 'there', extent: { right: 340, top: -200, height: 400 }, shown: true };
	const reach = 900;

	// In place: under the one aboard by its height and the gap, its bow level with the other's
	const [, placed] = placeShips([aboard, { ...other, in: 1 }], { reach });

	expect(placed.at).toEqual({ x: 320 - 340, y: 300 + FLEET_GAP + 200 - 150 });
	// Just shown: far astern, off the screen's edge, level with where it will stand
	const [, coming] = placeShips([aboard, { ...other, in: 0 }], { reach });

	expect(coming.at).toEqual({ x: placed.at.x - reach, y: placed.at.y });
	// Settled, it's where it will stand however far in it is: that's what the view is flown to take in
	expect(placeShips([aboard, { ...other, in: 0 }], { reach, settled: true })[1].at).toEqual(placed.at);

	const box = ships => fleetBox(ships.map(({ extent, at }) => ({ extent: { left: -300, ...extent }, at })));

	expect(box(placeShips([aboard, { ...other, in: 0 }], { reach, settled: true }))).toEqual(
		box(placeShips([aboard, { ...other, in: 1 }], { reach })),
	);
	expect(box(placeShips([aboard, { ...other, in: 0 }], { reach })).left).toBeLessThan(-900);

	// One being put away slides off ahead, and settled it's gone: the view takes in the one aboard alone
	const going = { ...other, shown: false, in: 0.5 };

	expect(placeShips([aboard, going], { reach })).toHaveLength(2);
	expect(placeShips([aboard, going], { reach })[1].at.x).toBeGreaterThan(placed.at.x);
	expect(placeShips([aboard, going], { reach, settled: true })).toHaveLength(1);
	// One neither shown nor on its way isn't on the stage at all
	expect(placeShips([aboard, { ...other, shown: false, in: 0 }], { reach })).toHaveLength(1);
});

test("the bridge's panel stands past the ship's nose, clear of its window; another room's beside the room; both inside the stage", () => {
	const at = { room: 1000, nose: 1120, stage: 1600, panel: 320 };

	// Past the nose's tip, not against the bridge's wall, where the window is
	expect(panelLeft({ ...at, bridge: true })).toBe(1132);
	expect(panelLeft({ ...at, bridge: true })).toBeGreaterThan(at.nose);
	// Any other room's, beside it
	expect(panelLeft({ ...at, bridge: false })).toBe(1012);
	// With no room past the nose (a narrow stage, or the ship zoomed in), against the stage's right edge: the one case
	// it lies over the nose
	expect(panelLeft({ ...at, bridge: true, stage: 1300 })).toBe(968);
	expect(panelLeft({ ...at, bridge: true, stage: 1464 })).toBe(1132);
	// A ship scrolled off to the left: no further left than the stage
	expect(panelLeft({ room: -400, nose: -280, stage: 1600, panel: 320, bridge: true })).toBe(12);
	// Before there's a hull, by the room
	expect(panelLeft({ ...at, nose: null, bridge: true })).toBe(1012);
});
