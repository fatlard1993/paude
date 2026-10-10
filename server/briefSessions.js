import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { statusOf } from './activity';
import { limitOf } from './usageLimit';

// Short-lived sessions: started for one quick thing, they go away by themselves. Once Claude's prompt cache has let go
// of one (its last request, plus the cache's hour) with nobody in it and Claude neither working nor asking, it's ended
// and deleted. One never prompted goes an hour after it started. Keeping one (keepSession) makes it an ordinary
// session. { [sessionId]: startedAt }
const CHECK_MS = 60 * 1000;
const NEVER_PROMPTED_MS = 60 * 60 * 1000;

let file;
let brief = {};

const save = () => file && writeJsonFile(file, () => brief);

export const isBrief = id => id in brief;

export const markBrief = async (id, now = Date.now()) => {
	brief[id] = now;
	await save();
};

export const keepSession = async id => {
	if (!(id in brief)) return;
	delete brief[id];
	await save();
};

// Whether a short-lived session is due to go: its cache gone (warmUntil, from its meter; null before Claude's first
// answer), nobody attached, Claude idle, and no usage limit it's waiting out
export const dueToGo = ({ startedAt, warmUntil, session, status, limited }, now) => {
	if (session && (session.clients.size || session.busy)) return false;
	if (status === 'working' || status === 'waiting' || limited) return false;

	return now >= (warmUntil ?? startedAt + NEVER_PROMPTED_MS);
};

// sessionOf(id): the running session; meterOf(id): its cache meter; remove(id): ends and deletes it
export const checkBrief = async ({ sessionOf, meterOf, remove }, now = Date.now()) => {
	const gone = [];

	for (const [id, startedAt] of Object.entries(brief)) {
		const meter = await meterOf(id).catch(() => null);
		const due = dueToGo(
			{
				startedAt,
				warmUntil: meter?.warmUntil ?? null,
				session: sessionOf(id),
				status: statusOf(id),
				limited: Boolean(limitOf(id)),
			},
			now,
		);

		if (!due) continue;
		console.log(`Short-lived session ${id}: deleted, its cache let go with nobody in it`);
		delete brief[id];
		await save();
		await remove(id).catch(error => console.error(`Deleting short-lived session ${id} failed:`, error));
		gone.push(id);
	}

	return gone;
};

export const initBriefSessions = async (dataDir, sweep) => {
	file = path.join(dataDir, 'brief-sessions.json');
	brief = await readJsonFile(file, {});
	setInterval(
		() => checkBrief(sweep).catch(error => console.error('Sweeping short-lived sessions failed:', error)),
		CHECK_MS,
	).unref();
};
