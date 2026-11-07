import { expect, test } from 'bun:test';

import { hueOf, setServers } from './servers';

test('no two ships of the fleet share a color: each keeps its own from its name unless one before it by name has it, and then takes the nearest free hue 45 degrees round', () => {
	const alike = ['alpha', 'alpha '];

	// Alone, a name's hue is its own
	setServers([]);
	const [own] = alike.map(hueOf);

	// The two names hash to hues too close to tell apart; in one fleet they stand apart
	setServers(alike.map(name => ({ url: `https://${name.trim()}`, name })));
	const [first, second] = alike.map(hueOf);

	expect(first).toBe(own);
	expect(Math.abs(((second - first + 540) % 360) - 180)).toBeGreaterThanOrEqual(45);
	// A server never heard of keeps its own hue
	expect(hueOf('zeta')).toBe(hueOf('zeta'));
	setServers([]);
});
