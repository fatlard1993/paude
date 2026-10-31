// paude's own helpers, spending the owner's allowance beside the sessions: Haiku telling tours, placing prompts,
// describing links and artifacts, filing decisions; a Claude of its own writing a commit message or a pull request;
// keep-warm pings. Each job as it runs and for an hour after, so the ship can show its service crew at work.
const RECENT_MS = 60 * 60_000;

let jobs = [];

// `run`, counted as the crew doing `job` until it's done
export const crewJob = async (job, run) => {
	const entry = { job, at: Date.now(), done: null };

	jobs.push(entry);
	try {
		return await run();
	} finally {
		entry.done = Date.now();
	}
};

// A job that's done as soon as it's begun: a keep-warm ping typed in
export const noteCrew = job => jobs.push({ job, at: Date.now(), done: Date.now() });

// { busy: [job], lately: { [job]: count } }: what's running now, and what each kind did in the last hour
export const crewOf = (now = Date.now()) => {
	jobs = jobs.filter(({ done }) => done === null || now - done < RECENT_MS);

	const lately = {};

	for (const { job, done } of jobs) if (done !== null) lately[job] = (lately[job] ?? 0) + 1;

	return { busy: jobs.filter(({ done }) => done === null).map(({ job }) => job), lately };
};
