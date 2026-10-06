import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, expect, test } from 'bun:test';

import {
	activitySummary,
	initActivity,
	markSeen,
	recordChange,
	setStatus,
	setWatching,
	watchIfNew,
	watchedBy,
} from './activity';

const owner = { owner: true };
const guest = { owner: false, inviteId: 'abc' };
const running = { running: true, busy: false };

beforeEach(async () => initActivity(await mkdtemp(path.join(os.tmpdir(), 'paude-activity-'))));

test('a watcher counts the changes since they last looked', async () => {
	await recordChange('s');
	await watchIfNew(owner, 's');
	expect(activitySummary(owner, 's', running)).toMatchObject({ watching: true, unseen: 0 });

	await recordChange('s');
	await recordChange('s');
	expect(activitySummary(owner, 's', running).unseen).toBe(2);
	expect(activitySummary(guest, 's', running)).toMatchObject({ watching: false, unseen: 0 });

	await markSeen(owner, 's');
	expect(activitySummary(owner, 's', running).unseen).toBe(0);
	expect(watchedBy(owner)).toEqual(['s']);
});

test('turning watching off sticks; joining or posting again does not turn it back on', async () => {
	await watchIfNew(guest, 's');
	await setWatching(guest, 's', false);
	await watchIfNew(guest, 's');

	expect(activitySummary(guest, 's', running).watching).toBe(false);
	expect(watchedBy(guest)).toEqual([]);
});

test('a question outranks the spinner, and a session that is not running is stopped', async () => {
	await setStatus('s', 'waiting');

	expect(activitySummary(owner, 's', { running: true, busy: true }).status).toBe('waiting');
	expect(activitySummary(owner, 's', { running: false }).status).toBe('stopped');

	await setStatus('s', 'ready');
	expect(activitySummary(owner, 's', { running: true, busy: true }).status).toBe('working');
	expect(activitySummary(owner, 's', running).status).toBe('ready');
});

test('watches and counts survive a restart', async () => {
	const dataDir = await mkdtemp(path.join(os.tmpdir(), 'paude-activity-'));

	await initActivity(dataDir);
	await watchIfNew(owner, 's');
	await recordChange('s');
	await initActivity(dataDir);

	expect(activitySummary(owner, 's', running)).toMatchObject({ watching: true, unseen: 1 });
});
