import { expect, test } from 'bun:test';

import { gamePort } from './gamePort';

test("a game's folder is given the same port every time", () => {
	const port = gamePort('/home/kid/Projects/sand', () => true);

	expect(port).toBeGreaterThanOrEqual(41000);
	expect(port).toBeLessThan(42000);
	expect(gamePort('/home/kid/Projects/sand', () => true)).toBe(port);
});

test('a taken port gives way to the next free one along', () => {
	const port = gamePort('/home/kid/Projects/sand', () => true);
	const next = gamePort('/home/kid/Projects/sand', candidate => candidate !== port);

	expect(next).toBe(port === 41999 ? 41000 : port + 1);
});

test('the port really is free when nothing is told otherwise', () => {
	const port = gamePort(`/tmp/${crypto.randomUUID()}`);

	expect(() => Bun.serve({ port, fetch: () => new Response() }).stop(true)).not.toThrow();
});
