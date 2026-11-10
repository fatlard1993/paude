import { expect, test } from 'bun:test';

import {
	DRAFT_LEFT_MS,
	MAX_HOURS,
	PING,
	PING_AFTER_MS,
	boostOf,
	noteAsking,
	readingOf,
	checkWarm,
	claudeActive,
	forgetMonitorsWith,
	keepWarm,
	keptOf,
	monitorOf,
	noteMonitor,
	spentOf,
	stopKeepingWarm,
	nudgeWith,
	typeWhenIdle,
	warmMonitorsWith,
	warmUntil,
} from './keepWarm';

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

test('a ping waits for Claude to finish and for someone typing in the prompt box', async () => {
	const session = fakeSession();
	const sessionOf = only('drafting', session);

	await keepWarm('drafting', 12, 0);
	session.draft = 'half a thou';
	session.typedAt = PING_AFTER_MS - DRAFT_LEFT_MS + 1;
	expect(await checkWarm(sessionOf, PING_AFTER_MS)).toEqual([]);
	expect(session.typed).toEqual([]);
	session.draft = '';
	session.busy = true;
	expect(await checkWarm(sessionOf, PING_AFTER_MS + 60_000)).toEqual([]);
	session.busy = false;
	expect(await checkWarm(sessionOf, PING_AFTER_MS + 120_000)).toEqual(['drafting']);
});

test('a draft left in the prompt box is stashed for the ping, so the cache outlives it', async () => {
	const session = fakeSession();

	session.typeIn = data => {
		session.typed.push(data);
		if (data === '\x13') session.draft = '';
	};
	await keepWarm('left', 12, 0);
	session.draft = 'half a thou';
	session.typedAt = PING_AFTER_MS - DRAFT_LEFT_MS;
	expect(await checkWarm(only('left', session), PING_AFTER_MS, { pause: async () => {} })).toEqual(['left']);
	expect(session.typed[0]).toBe('\x13');
	expect(session.typed[1]).toContain(PING);
});

test("a stash that doesn't empty the box sends no ping into the draft", async () => {
	const session = fakeSession();

	await keepWarm('rebound', 12, 0);
	session.draft = 'half a thou';
	expect(await checkWarm(only('rebound', session), PING_AFTER_MS, { pause: async () => {} })).toEqual([]);
	expect(session.typed).toEqual(['\x13']);
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

test('a real prompt starts the hours over; a ping does not', async () => {
	await keepWarm('sliding', 12, 0);
	expect(warmUntil('sliding', 0)).toBe(12 * HOUR);

	claudeActive('sliding', { hook_event_name: 'UserPromptSubmit', prompt: PING }, 5 * HOUR);
	expect(warmUntil('sliding', 0)).toBe(12 * HOUR);

	claudeActive('sliding', { hook_event_name: 'UserPromptSubmit', prompt: 'fix the build' }, 10 * HOUR);
	expect(warmUntil('sliding', 0)).toBe(22 * HOUR);
});

test('how a session is kept, and the last ping or nudge typed into it and how long ago', async () => {
	const session = fakeSession();

	await keepWarm('kept', 12, 0);
	expect(keptOf('kept', 0)).toBe('warm');
	expect(boostOf('kept', 0)).toBeNull();
	await checkWarm(only('kept', session), PING_AFTER_MS);
	expect(boostOf('kept', PING_AFTER_MS + 500)).toEqual({ kind: 'warm', ago: 500 });

	await keepWarm('kept', 12, 0, { going: true });
	expect(keptOf('kept', 0)).toBe('going');
	// Its reply with Haiku, until the nudge is typed
	expect(readingOf('kept', 8000)).toBeNull();
	await noteAsking('kept', 'turn-9', 8000);
	expect(readingOf('kept', 8500)).toEqual({ kind: 'going', ago: 500 });
	expect(typeWhenIdle('kept', session, nudgeWith('next'), 9000)).toBe(true);
	expect(boostOf('kept', 9100)).toEqual({ kind: 'going', ago: 100 });
	await noteAsking('kept', null);
	expect(readingOf('kept', 9100)).toBeNull();

	await keepWarm('kept', 0, 0);
	expect(keptOf('kept', 0)).toBeNull();
});

test('a fabled session has a monitor of its own, kept through a switch to warm to be put back, and let go with the record', async () => {
	const forgotten = [];

	forgetMonitorsWith(async id => {
		forgotten.push(id);
	});
	await keepWarm('fabled', 24, 0, { fabled: true });
	expect(keptOf('fabled', 0)).toBe('fabled');
	expect(warmUntil('fabled', 0)).toBe(24 * HOUR);

	const { monitor } = monitorOf('fabled');

	expect(monitor).toBeTruthy();
	expect(monitorOf('fabled').seen).toBeNull();
	await noteMonitor('fabled', { monitor, seen: 'turn-1' });
	expect(monitorOf('fabled')).toEqual({ monitor, seen: 'turn-1', missed: 0 });
	await noteMonitor('fabled', { monitor, seen: 'turn-1', missed: 2 });
	expect(monitorOf('fabled')).toEqual({ monitor, seen: 'turn-1', missed: 2 });
	await noteMonitor('fabled', { monitor, seen: 'turn-1' });

	// Its nudge is the monitor's
	expect(typeWhenIdle('fabled', fakeSession(), nudgeWith('next', { fabled: true }), 500)).toBe(true);
	expect(boostOf('fabled', 600)).toEqual({ kind: 'fabled', ago: 100 });
	expect(nudgeWith('next', { fabled: true })).toContain('a monitor that has followed this run');

	await keepWarm('fabled', 12, 0);
	expect(keptOf('fabled', 0)).toBe('warm');
	expect(monitorOf('fabled')).toEqual({ monitor, seen: 'turn-1', missed: 0 });
	await keepWarm('fabled', 24, 0, { fabled: true });
	expect(monitorOf('fabled')).toEqual({ monitor, seen: 'turn-1', missed: 0 });
	expect(forgotten).toEqual([]);

	// Its conversation gone: forgotten, and a fresh one made the next time it's kept fabled
	await noteMonitor('fabled', { monitor: null });
	expect(forgotten).toEqual([monitor]);
	expect(monitorOf('fabled')).toBeNull();
	expect(keptOf('fabled', 0)).toBe('fabled');
	await keepWarm('fabled', 24, 0, { fabled: true });

	const fresh = monitorOf('fabled').monitor;

	expect(fresh).toBeTruthy();
	expect(fresh).not.toBe(monitor);
	await keepWarm('fabled', 0, 0);
	expect(forgotten).toEqual([monitor, fresh]);
	expect(monitorOf('fabled')).toBeNull();
	forgetMonitorsWith(async () => {});
});

test("what's typed in carries no control characters, and a suggestion that runs on is cut", () => {
	const session = fakeSession();

	expect(typeWhenIdle('typed', session, 'fix it\x1b[201~ rm -rf /\x07\ttwo\nlines')).toBe(true);
	expect(session.typed[0]).toBe('\x1b[200~fix it[201~ rm -rf /\ttwo\nlines\x1b[201~');

	const long = nudgeWith('x'.repeat(5000), { fabled: true });

	expect(long).toContain('x'.repeat(800));
	expect(long).not.toContain('x'.repeat(801));
	expect(nudgeWith('short').endsWith('without them.')).toBe(true);
});

test("a fabled session's monitor is pinged on its own clock once quiet long enough, even while the session itself can't be", async () => {
	const warmed = [];

	warmMonitorsWith(async (id, monitor, cwd) => {
		warmed.push({ id, monitor, cwd });
	});
	try {
		const session = { ...fakeSession(), cwd: '/work' };

		await keepWarm('fabled-pinged', 24, 0, { fabled: true });
		// First seen at the first check: counted from then
		expect(await checkWarm(only('fabled-pinged', session), 1)).toEqual([]);
		expect(warmed).toEqual([]);
		// Quiet long enough: the session is pinged, and so is its monitor
		expect(await checkWarm(only('fabled-pinged', session), PING_AFTER_MS + 1)).toEqual([
			'fabled-pinged',
			"fabled-pinged's monitor",
		]);
		expect(warmed).toEqual([{ id: 'fabled-pinged', monitor: monitorOf('fabled-pinged').monitor, cwd: '/work' }]);
		// Not again until it has been quiet as long again
		expect(await checkWarm(only('fabled-pinged', session), PING_AFTER_MS + 60_000)).toEqual([]);

		// Asked at a turn end: that read counts, and the monitor's clock starts over from it while the session's runs on
		await noteMonitor(
			'fabled-pinged',
			{ monitor: monitorOf('fabled-pinged').monitor, seen: 't1' },
			PING_AFTER_MS + 120_000,
		);
		expect(await checkWarm(only('fabled-pinged', session), 2 * PING_AFTER_MS + 2)).toEqual(['fabled-pinged']);

		// The session busy (or asking, or being typed into) isn't pinged; its monitor still is, once quiet long enough
		session.busy = true;
		expect(await checkWarm(only('fabled-pinged', session), 2 * PING_AFTER_MS + 120_001)).toEqual([
			"fabled-pinged's monitor",
		]);
		expect(warmed).toHaveLength(2);

		// The clock is the record's, so a restart or a switch of lifetime that rebuilds the record keeps it
		await keepWarm('fabled-pinged', 24, 2 * PING_AFTER_MS + 120_001, { fabled: true });
		session.busy = false;
		// (the session's own ping falls due here; the monitor's a moment later)
		expect(await checkWarm(only('fabled-pinged', session), 3 * PING_AFTER_MS + 120_000)).toEqual(['fabled-pinged']);
		expect(await checkWarm(only('fabled-pinged', session), 3 * PING_AFTER_MS + 120_001)).toEqual([
			"fabled-pinged's monitor",
		]);
		expect(warmed).toHaveLength(3);

		// Only kept warm or going: no monitor to ping
		await keepWarm('only-pinged', 12, 0, { going: true });
		await checkWarm(only('only-pinged', fakeSession()), PING_AFTER_MS);
		expect(warmed).toHaveLength(3);
		await keepWarm('fabled-pinged', 0, 0);
		await keepWarm('only-pinged', 0, 0);
	} finally {
		warmMonitorsWith(async () => {});
	}
});

test('a session kept until its time ran out is remembered as spent, until it is kept again or ends; one switched off by hand is not', async () => {
	const session = fakeSession();

	await keepWarm('ran-out', 1, 0, { going: true });
	expect(spentOf('ran-out')).toBeNull();
	await checkWarm(only('ran-out', session), HOUR);
	expect(keptOf('ran-out', HOUR)).toBeNull();
	expect(spentOf('ran-out')).toBe('going');
	// Kept again: what the last keeping left is cleared away
	await keepWarm('ran-out', 1, HOUR);
	expect(spentOf('ran-out')).toBeNull();
	await checkWarm(only('ran-out', session), 2 * HOUR);
	expect(spentOf('ran-out')).toBe('warm');
	await stopKeepingWarm('ran-out');
	expect(spentOf('ran-out')).toBeNull();

	// Switched off before its time, or let go because it isn't running: nothing spent
	await keepWarm('switched-off', 1, 0);
	await keepWarm('switched-off', 0, 10);
	expect(spentOf('switched-off')).toBeNull();
	await keepWarm('stopped', 1, 0);
	await checkWarm(only('other', session), 10);
	expect(spentOf('stopped')).toBeNull();
});
