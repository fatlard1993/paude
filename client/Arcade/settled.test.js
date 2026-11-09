import { expect, test } from 'bun:test';

import { settledYet } from './settled';

test('the game is shown only once it has gone three seconds without reloading', () => {
	const began = 0;

	expect(settledYet({ hasGame: true, loadedAt: 1000, began, now: 2500 })).toBe(false);
	expect(settledYet({ hasGame: true, loadedAt: 1000, began, now: 4000 })).toBe(true);
});

test('a reload starts the wait over', () => {
	expect(settledYet({ hasGame: true, loadedAt: 3500, began: 0, now: 4000 })).toBe(false);
});

test('a game that keeps reloading is shown after twenty seconds anyway, and no game at all needs no wait', () => {
	expect(settledYet({ hasGame: true, loadedAt: 19_900, began: 0, now: 20_000 })).toBe(true);
	expect(settledYet({ hasGame: false, loadedAt: 0, began: 0, now: 0 })).toBe(true);
});
