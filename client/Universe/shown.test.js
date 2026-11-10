import { expect, test } from 'bun:test';

import { fleetBox } from './shown';

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
