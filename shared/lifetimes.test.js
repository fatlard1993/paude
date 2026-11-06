import { expect, test } from 'bun:test';

import { LIFETIMES, WARM_LIFETIMES } from './lifetimes';

test('every lifetime kept while away is one the table knows, and the costliest says what it spends where it is chosen', () => {
	for (const lifetime of WARM_LIFETIMES) expect(LIFETIMES[lifetime]).toBeDefined();
	// Its detail is the chip's tooltip, the bar's title and both lifetime menus: the only words read before pressing it
	expect(LIFETIMES.fabled.detail).toContain('Fable turn on your usage');
});
