import { meterOf } from './cacheMeter';
import askHaiku, { jsonIn } from './haiku';
import { listProjects } from './projects';
import { sessionRecord } from './sessions/record';
import { listAllSessions } from './sessions/stored';
import { sessionTimeline } from './timeline';

// Where a prompt should go before it's sent: one of the conversations already going, when it carries one on, or a new
// session (in which project, when that's open too). Haiku judges the fit from each session's title and latest prompts;
// what sending costs, warm or cold, comes from each match's cache meter.
const RECENT_MS = 3 * 24 * 60 * 60 * 1000;
const MOST_CANDIDATES = 15;
const MOST_MATCHES = 3;
const LATEST_PROMPTS = 5;
const CHANGED_FILES = 10;
const PROMPT_CHARACTERS = 160;
// The keep-warm pings say nothing of what a session is about
const KEEP_WARM_PING = /^keep-?warm ping/i;

const clip = text =>
	String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, PROMPT_CHARACTERS);

// The sessions worth weighing: those running, and those touched lately, newest first
export const candidatesFrom = (sessions, now = Date.now()) =>
	sessions
		.filter(session => session.live || now - (session.lastModified ?? session.activeAt ?? 0) < RECENT_MS)
		.slice(0, MOST_CANDIDATES);

// What a session has been about lately: its latest prompts, and the files it changed (which say what it works on
// better than its title, for one working outside the folder it started in)
const lately = async id => {
	const record = await sessionRecord(id);
	const { turns } = record ? await sessionTimeline(id, record.cwd) : { turns: [] };
	const files = turns.flatMap(turn => turn.steps.filter(step => step.edits && step.file).map(step => step.file));

	return {
		latest: turns
			.map(turn => turn.prompt)
			.filter(prompt => prompt && !KEEP_WARM_PING.test(prompt))
			.slice(0, LATEST_PROMPTS)
			.map(clip),
		changed: [...new Set(files)].slice(0, CHANGED_FILES),
	};
};

export const homePrompt = ({ prompt, candidates, projects }) =>
	[
		'Someone is about to give Claude, a coding assistant, the task below. Decide where it belongs: in one of the conversations already going, if it carries one on (the same piece of work, or one that needs what that conversation already knows), or in a new session. A different task in the same project belongs in a new session.',
		`The task:\n${prompt}`,
		candidates.length
			? `The conversations:\n${candidates
					.map((session, index) =>
						[
							`${index + 1}. "${clip(session.title)}" in ${session.project}${session.worktree ? `, worktree ${session.worktree}` : ''}`,
							session.firstPrompt && `   Began with: ${clip(session.firstPrompt)}`,
							...session.latest.map(text => `   Lately: ${text}`),
							session.changed.length && `   Changed lately: ${session.changed.join(', ')}`,
						]
							.filter(Boolean)
							.join('\n'),
					)
					.join('\n')}`
			: 'There are no conversations going.',
		projects && `For a new session, the projects are: ${projects.join(', ')}.`,
		`Reply with only a JSON object: {"matches": [{"n": 2, "why": "…"}], "fresh": {${projects ? '"project": "…", ' : ''}"why": "…"}}. "matches" holds at most ${MOST_MATCHES} conversations this truly carries on, best first, and is empty when none does; each "why" is one plain sentence.`,
	]
		.filter(Boolean)
		.join('\n\n');

// project: a project's name keeps the search to its sessions, and a new session to it
export const findHome = async ({ prompt, project, identity }) => {
	const all = await listAllSessions(identity);
	const candidates = await Promise.all(
		candidatesFrom(project ? all.filter(session => session.project === project) : all).map(async session => ({
			...session,
			...(await lately(session.id)),
		})),
	);
	const projects = project ? null : await listProjects();
	const reply = jsonIn(await askHaiku(homePrompt({ prompt, candidates, projects })));

	if (!reply) return null;

	const matches = await Promise.all(
		(Array.isArray(reply.matches) ? reply.matches : [])
			.map(match => ({ session: candidates[Number(match?.n) - 1], why: String(match?.why ?? '') }))
			.filter(match => match.session)
			.slice(0, MOST_MATCHES)
			.map(async ({ session, why }) => {
				const record = await sessionRecord(session.id);
				const { latest, changed, ...summary } = session;

				return { session: summary, why, meter: record ? await meterOf(session.id, record.cwd) : null };
			}),
	);
	const freshProject = project ?? (projects.includes(reply.fresh?.project) ? reply.fresh.project : null);

	return { matches, fresh: { project: freshProject, why: String(reply.fresh?.why ?? '') } };
};
