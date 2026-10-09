import { expect, test } from 'bun:test';

import { checkLimits, continueSession, limitHook, limitOf, resetTimeOf } from './usageLimit';

// 2026-10-09 12:00 UTC
const NOON = Date.UTC(2026, 9, 9, 12, 0);
const MINUTE = 60_000;

const fakeSession = () => {
	const session = { busy: false, draft: '', typed: [] };

	session.promptDraft = () => session.draft;
	session.typeIn = data => session.typed.push(data);

	return session;
};

test('when the limit resets, from the ways Claude says it', () => {
	expect(resetTimeOf('resets in 2h 15m', NOON)).toBe(NOON + 135 * MINUTE);
	expect(resetTimeOf("You've hit your limit · resets 3pm (UTC)", NOON)).toBe(Date.UTC(2026, 9, 9, 15, 0));
	expect(resetTimeOf('Your limit will reset at 3:30pm (America/Denver)', NOON)).toBe(Date.UTC(2026, 9, 9, 21, 30));
	// Already past today: tomorrow's
	expect(resetTimeOf('resets 9am (UTC)', NOON)).toBe(Date.UTC(2026, 9, 10, 9, 0));
	expect(resetTimeOf('weekly limit · resets Oct 12, 9am (UTC)', NOON)).toBe(Date.UTC(2026, 9, 12, 9, 0));
	expect(resetTimeOf('API Error: Rate limit reached', NOON)).toBeNull();
});

test('a turn stopped by the limit is limited until Claude works again', async () => {
	await limitHook(
		'stopped',
		{ hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: 'resets 3pm (UTC)' },
		NOON,
	);
	expect(limitOf('stopped')).toMatchObject({ resetAt: Date.UTC(2026, 9, 9, 15, 0), armed: false, stale: false });

	await limitHook('stopped', { hook_event_name: 'Notification', notification_type: 'quota_auto_resume_stale' });
	expect(limitOf('stopped').stale).toBe(true);

	await limitHook('stopped', { hook_event_name: 'Notification', notification_type: 'quota_auto_resume_fired' });
	expect(limitOf('stopped')).toBeNull();
});

test('other failures and quiet hooks leave a session alone', async () => {
	expect(await limitHook('fine', { hook_event_name: 'StopFailure', error: 'overloaded' })).toBe(false);
	expect(await limitHook('fine', { hook_event_name: 'Stop' })).toBe(false);
	expect(limitOf('fine')).toBeNull();
});

test('armed, it carries on once the reset has come, and only then', async () => {
	const session = fakeSession();
	const sessionOf = id => (id === 'armed' ? session : undefined);

	await limitHook(
		'armed',
		{ hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: 'resets 3pm (UTC)' },
		NOON,
	);
	await continueSession('armed', session, 'reset');

	expect(checkLimits(sessionOf, Date.UTC(2026, 9, 9, 15, 0))).toEqual([]);
	expect(checkLimits(sessionOf, Date.UTC(2026, 9, 9, 15, 5))).toEqual(['armed']);
	expect(session.typed[0]).toContain('continue');
	// Once
	expect(checkLimits(sessionOf, Date.UTC(2026, 9, 9, 15, 10))).toEqual([]);
});

test('continuing waits for an empty prompt box, and presses Enter when Claude waits for one', async () => {
	const session = fakeSession();

	await limitHook('typing', { hook_event_name: 'StopFailure', error: 'rate_limit' }, NOON);
	session.draft = 'half typed';
	expect(await continueSession('typing', session, 'now')).toBe(false);

	await limitHook('typing', { hook_event_name: 'Notification', notification_type: 'quota_auto_resume_stale' });
	expect(await continueSession('typing', session, 'now')).toBe(true);
	expect(session.typed).toEqual(['\r']);
});

test("a reset Claude didn't say is tried every half hour", async () => {
	const session = fakeSession();
	const sessionOf = () => session;

	await limitHook('unknown', { hook_event_name: 'StopFailure', error: 'rate_limit' }, NOON);
	await continueSession('unknown', session, 'reset');

	expect(checkLimits(sessionOf, NOON + 29 * MINUTE)).toEqual([]);
	expect(checkLimits(sessionOf, NOON + 30 * MINUTE)).toEqual(['unknown']);
	expect(checkLimits(sessionOf, NOON + 40 * MINUTE)).toEqual([]);
	expect(checkLimits(sessionOf, NOON + 60 * MINUTE)).toEqual(['unknown']);
});
