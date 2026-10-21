import { expect, test } from 'bun:test';

import dayGroup, { whenIn } from './dayGroup';

test('a time falls in the day it was, counted back from now in whole days', () => {
	const now = new Date(2026, 9, 20, 15, 0).getTime();
	const at = (day, hour) => new Date(2026, 9, day, hour).getTime();

	expect(dayGroup(at(20, 0), now)).toBe('Today');
	expect(dayGroup(at(19, 23), now)).toBe('Yesterday');
	expect(dayGroup(at(19, 0), now)).toBe('Yesterday');
	expect(dayGroup(at(14, 9), now)).toBe('Past week');
	expect(dayGroup(at(13, 23), now)).toBe('Past month');
	expect(dayGroup(new Date(2026, 8, 21).getTime(), now)).toBe('Past month');
	expect(dayGroup(new Date(2026, 8, 1).getTime(), now)).toBe('Older');
	expect(dayGroup(undefined, now)).toBe('Older');
});

test("a time is told in its group's terms: a clock for today and yesterday, a weekday this week, a date before", () => {
	const at = new Date(2026, 9, 14, 9, 5).getTime();
	const clock = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

	expect(whenIn('Today', at)).toBe(clock);
	expect(whenIn('Yesterday', at)).toBe(clock);
	expect(whenIn('Past week', at)).toEndWith(clock);
	expect(whenIn('Past week', at).length).toBeGreaterThan(clock.length);
	expect(whenIn('Older', at)).not.toContain(clock);
});
