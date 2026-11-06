import { afterAll, expect, test } from 'bun:test';

import { fabledOn, goingOn, monitorOf } from './keepWarm';
import { UNDO_MS, lastSwitch, lifetimeOf, switchLifetime } from './lifetime';

// Every test file in a run shares briefSessions; a session left brief here gets swept in its tests
afterAll(() =>
	Promise.all(['switched', 'walked-back', 'unchanged', 'going', 'fabled'].map(id => switchLifetime(id, 'ordinary'))),
);

test('a switch by hand keeps what it was for an hour, to put back', async () => {
	const now = Date.now();

	await switchLifetime('switched', 'warm', now);
	expect(lifetimeOf('switched')).toBe('warm');
	expect(lastSwitch('switched', now)).toEqual({ was: 'ordinary', until: now + UNDO_MS });

	await switchLifetime('switched', 'brief', now + 1);
	expect(lastSwitch('switched', now + 1)?.was).toBe('warm');
	expect(lastSwitch('switched', now + 1 + UNDO_MS)).toBeNull();
});

test('putting it back leaves nothing to undo', async () => {
	const now = Date.now();

	await switchLifetime('walked-back', 'brief', now);
	await switchLifetime('walked-back', 'ordinary', now + 1);
	expect(lastSwitch('walked-back', now + 1)).toBeNull();
});

test('choosing what it already is changes nothing', async () => {
	await switchLifetime('unchanged', 'ordinary');
	expect(lastSwitch('unchanged')).toBeNull();
});

test('keeping going is kept warm besides, and switching to warm stops it going', async () => {
	await switchLifetime('going', 'going');
	expect(lifetimeOf('going')).toBe('going');
	expect(goingOn('going')).toBe(true);

	await switchLifetime('going', 'warm');
	expect(lifetimeOf('going')).toBe('warm');
	expect(goingOn('going')).toBe(false);
});

test('fabled keeps going with a monitor of its own, for longer; switching to going keeps the monitor to put back, ordinary lets it go', async () => {
	await switchLifetime('fabled', 'fabled');
	expect(lifetimeOf('fabled')).toBe('fabled');
	expect(goingOn('fabled')).toBe(true);
	expect(fabledOn('fabled')).toBe(true);

	const { monitor } = monitorOf('fabled');

	expect(monitor).toBeTruthy();
	await switchLifetime('fabled', 'going');
	expect(lifetimeOf('fabled')).toBe('going');
	expect(fabledOn('fabled')).toBe(false);
	expect(monitorOf('fabled').monitor).toBe(monitor);
	await switchLifetime('fabled', 'fabled');
	expect(monitorOf('fabled').monitor).toBe(monitor);
	await switchLifetime('fabled', 'ordinary');
	expect(lifetimeOf('fabled')).toBe('ordinary');
	expect(monitorOf('fabled')).toBeNull();
});
