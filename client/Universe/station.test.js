import { expect, test } from 'bun:test';

import { drawScreen } from './station';

// Every pixel a screen is drawn with, as { x, y, w, h }
const painted = (area, screen) => {
	const rects = [];
	const ctx = { fillRect: (x, y, w, h) => rects.push({ x, y, w, h }) };

	for (const time of [0, 0.3, 0.6, 1.1]) drawScreen(ctx, area, { hue: 200, seed: 0.4, time, ...screen });

	return rects;
};

test("what a screen shows stays on it, a grey's monitor and a short-lived one's laptop alike", () => {
	const kinds = ['work', 'terminal', 'think', 'send', 'ask', 'news', 'limit', 'idle'];

	for (const area of [
		{ x: 100, y: 50, w: 15, h: 11 },
		{ x: 100, y: 50, w: 8, h: 6 },
	])
		for (const kind of kinds)
			for (const { x, y, w, h } of painted(area, { kind })) {
				expect(x).toBeGreaterThanOrEqual(area.x);
				expect(y).toBeGreaterThanOrEqual(area.y);
				expect(x + w).toBeLessThanOrEqual(area.x + area.w);
				expect(y + h).toBeLessThanOrEqual(area.y + area.h);
			}
});
