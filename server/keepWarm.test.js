import { expect, test } from 'bun:test';

import { MAX_HOURS, PING, PING_AFTER_MS, checkWarm, claudeActive, keepWarm, warmUntil } from './keepWarm';

const HOUR = 60 * 60 * 1000;

// Only its own session is running: any other test's is let go
const only = (id, session) => other => (other === id ? session : undefined);

const fakeSession = () => {
	const session = { busy: false, draft: '', typed: [] };

	session.promptDraft = () => session.draft;
	session.typeIn = data => session.typed.push(data);

	return session;
};

test('a warm session is pinged once Claude has been quiet long enough, and not before', async () => {
	const session = fakeSession();
	const sessionOf = only('quiet', session);

	await keepWarm('quiet', 12, 0);

	expect(await checkWarm(sessionOf, PING_AFTER_MS - 1)).toEqual([]);
	expect(await checkWarm(sessionOf, PING_AFTER_MS)).toEqual(['quiet']);
	expect(session.typed[0]).toContain(PING);
	// The ping counts as Claude's turn: the next is a full wait away
	expect(await checkWarm(sessionOf, PING_AFTER_MS + 1)).toEqual([]);
});

test("Claude's own turns push the ping back", async () => {
	const session = fakeSession();

	await keepWarm('busy-day', 12, 0);
	claudeActive('busy-day', { hook_event_name: 'Stop' }, 30 * 60 * 1000);

	expect(await checkWarm(only('busy-day', session), PING_AFTER_MS)).toEqual([]);
	expect(await checkWarm(only('busy-day', session), 30 * 60 * 1000 + PING_AFTER_MS)).toEqual(['busy-day']);
});

test("a ping waits for Claude to finish and for what's typed in the prompt box", async () => {
	const session = fakeSession();
	const sessionOf = only('drafting', session);

	await keepWarm('drafting', 12, 0);
	session.draft = 'half a thou';
	expect(await checkWarm(sessionOf, PING_AFTER_MS)).toEqual([]);
	session.draft = '';
	session.busy = true;
	expect(await checkWarm(sessionOf, PING_AFTER_MS + 60_000)).toEqual([]);
	session.busy = false;
	expect(await checkWarm(sessionOf, PING_AFTER_MS + 120_000)).toEqual(['drafting']);
});

test('past its cutoff, or no longer running, a session is let go', async () => {
	const session = fakeSession();

	await keepWarm('cutoff', 1, 0);
	await checkWarm(only('cutoff', session), HOUR);
	expect(warmUntil('cutoff', 0)).toBeNull();
	expect(session.typed).toEqual([]);

	await keepWarm('ended', 12, 0);
	await checkWarm(() => undefined, 1);
	expect(warmUntil('ended', 0)).toBeNull();
});

test('kept warm for at most MAX_HOURS, and 0 hours stops it', async () => {
	expect(await keepWarm('long', 1000, 0)).toBe(MAX_HOURS * HOUR);
	expect(await keepWarm('long', 0, 0)).toBeNull();
});

test("a ping's turn is known as one, from its prompt to its Stop", () => {
	expect(claudeActive('turns', { hook_event_name: 'UserPromptSubmit', prompt: PING })).toBe(true);
	expect(claudeActive('turns', { hook_event_name: 'Stop' })).toBe(true);
	expect(claudeActive('turns', { hook_event_name: 'UserPromptSubmit', prompt: 'fix the build' })).toBe(false);
	expect(claudeActive('turns', { hook_event_name: 'Stop' })).toBe(false);
});
