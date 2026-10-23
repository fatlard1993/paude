import { readdir } from 'fs/promises';
import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { followDecisions, sessionDecisions } from './decisions';
import { repoRoot } from './git';
import { runningSession } from './sessions/running';
import { claudeHome } from './sessions/transcript';

// Looking back over a project's sessions: those from before paude followed sessions as they went, and those it only
// read the end of, each read whole and what it settled filed as a live session's is, into the commits of its day. Begun
// when a turn ends in the project, a session at a time; one left unsettled (out of time, or filing waited on another
// session) is looked back on again next time, and one that grew since (resumed) is read again.

let readFile;
// { [repository]: { [session id]: the transcript's size when it was looked back on, 0 until it settles } }
let read = {};
// { [repository]: { done, total } }: those being looked back on now
const under = new Map();

export const initLookBack = async dataDir => {
	readFile = path.join(dataDir, 'decision-look-back.json');
	read = await readJsonFile(readFile, {});
};

// The sessions Claude Code started in the repository's folder, and how big each transcript is now
const sessionsIn = async root => {
	const folder = path.join(claudeHome(), 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
	const names = (await readdir(folder).catch(() => [])).filter(name => name.endsWith('.jsonl'));

	return names.map(name => ({ id: name.slice(0, -'.jsonl'.length), size: Bun.file(path.join(folder, name)).size }));
};

// Not one running: a live session is followed as it goes
export const lookBack = async (cwd, { follow = followDecisions } = {}) => {
	const root = readFile && (await repoRoot(cwd));

	if (!root || under.has(root)) return;

	const toRead = (await sessionsIn(root)).filter(
		session => !runningSession(session.id) && (read[root]?.[session.id] ?? -1) < session.size,
	);

	if (!toRead.length) return;
	under.set(root, { done: 0, total: toRead.length });
	try {
		for (const session of toRead) {
			// Known from here on, for what filing asks of it; looked back on again until it settles
			read = { ...read, [root]: { ...read[root], [session.id]: read[root]?.[session.id] ?? 0 } };
			if (await follow(session.id, root, { whole: true }))
				read = { ...read, [root]: { ...read[root], [session.id]: session.size } };
			await writeJsonFile(readFile, () => read);
			under.get(root).done += 1;
		}
	} finally {
		under.delete(root);
	}
};

// How far looking back has got in the session's repository, and what the sessions looked back on still need: what
// filing asked the person, and what's being filed. Each marked `earlier`.
export const lookedBack = async (sessionId, cwd) => {
	const root = await repoRoot(cwd);

	if (!root) return { lookingBack: null, earlier: [] };

	const sessions = Object.keys(read[root] ?? {}).filter(id => id !== sessionId && !runningSession(id));
	const earlier = await Promise.all(
		sessions.map(async id =>
			(await sessionDecisions(id, root, { whole: true })).decisions
				.filter(decision => decision.question || decision.filing)
				.map(decision => ({ ...decision, earlier: true })),
		),
	);

	return { lookingBack: under.get(root) ?? null, earlier: earlier.flat() };
};
