import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';

// How far the ship has come: everything this machine's work has delivered, kept on disk. Replies landed, commits
// pushed (as the hold sees them go: fewer not pushed than when last looked, on the same branch) and artifacts made,
// each weighed for the distance it adds; and what was delivered in the last hour, for how fast the ship goes now.
const WEIGHTS = { replies: 1, commits: 5, artifacts: 2 };
const RECENT_MS = 60 * 60_000;

const fresh = () => ({ replies: 0, commits: 0, artifacts: 0, recent: [] });

let file;
let journey = fresh();

export const initJourney = async dataDir => {
	file = path.join(dataDir, 'journey.json');
	journey = { ...fresh(), ...(await readJsonFile(file, {})) };
};

export const noteDelivered = async (kind, count = 1, now = Date.now()) => {
	if (!WEIGHTS[kind] || count <= 0) return;

	journey[kind] += count;
	journey.recent = [...journey.recent.filter(({ at }) => now - at < RECENT_MS), { at: now, kind, count }];
	if (file) await writeJsonFile(file, () => journey);
};

// { replies, commits, artifacts, distance, lately }: lately, the distance added in the last hour
export const journeyOf = (now = Date.now()) => {
	const weigh = entries => entries.reduce((sum, { kind, count }) => sum + WEIGHTS[kind] * count, 0);
	const { replies, commits, artifacts } = journey;

	return {
		replies,
		commits,
		artifacts,
		distance: weigh(Object.keys(WEIGHTS).map(kind => ({ kind, count: journey[kind] }))),
		lately: weigh(journey.recent.filter(({ at }) => now - at < RECENT_MS)),
	};
};
