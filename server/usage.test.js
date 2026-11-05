import { expect, test } from 'bun:test';

import { usageFrom } from './usage';

test("the account's limits as /usage has them: a window not yet open is none of it used, and each model's own week", () => {
	expect(
		usageFrom({
			five_hour: null,
			seven_day: { utilization: 28, resets_at: '2026-11-06T10:00:00Z' },
			limits: [
				{ kind: 'weekly_all', percent: 28, resets_at: '2026-11-06T10:00:00Z', scope: null },
				{
					kind: 'weekly_scoped',
					percent: 4,
					resets_at: '2026-11-06T10:00:00Z',
					scope: { model: { display_name: 'Fable' } },
				},
			],
		}),
	).toEqual({
		session: { percent: 0, resetsAt: null },
		week: { percent: 28, resetsAt: '2026-11-06T10:00:00Z' },
		models: [{ name: 'Fable', percent: 4, resetsAt: '2026-11-06T10:00:00Z' }],
	});
	expect(usageFrom({ five_hour: { utilization: 61.5, resets_at: 'soon' } })).toMatchObject({
		session: { percent: 61.5, resetsAt: 'soon' },
		week: null,
		models: [],
	});
});
