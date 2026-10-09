import { meterOf } from './cacheMeter';
import askHaiku, { jsonIn } from './haiku';
import { listProjects } from './projects';
import { ownedRemotes, remoteApi } from './remotes';
import { serverName } from './serverSettings';
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
							`${index + 1}. "${clip(session.title)}" in ${session.where ?? session.project}${session.worktree ? `, worktree ${session.worktree}` : ''}`,
							session.firstPrompt && `   Began with: ${clip(session.firstPrompt)}`,
							...session.latest.map(text => `   Lately: ${text}`),
							session.changed.length && `   Changed lately: ${session.changed.join(', ')}`,
						]
							.filter(Boolean)
							.join('\n'),
					)
					.join('\n')}`
			: 'There are no conversations going.',
		projects && `For a new session, the projects (each on its server) are: ${projects.join(', ')}.`,
		`Reply with only a JSON object: {"matches": [{"n": 2, "why": "…"}], "fresh": {${projects ? '"project": "…", ' : ''}"why": "…"}}.${projects ? ' "project" is one of the projects exactly as written above.' : ''} "matches" holds at most ${MOST_MATCHES} conversations this truly carries on, best first, and is empty when none does; each "why" is one plain sentence that names a conversation by its title, never by its number.`,
	]
		.filter(Boolean)
		.join('\n\n');

// This server's sessions worth weighing, each with what it has been about lately; project keeps them to one
export const localCandidates = async ({ project, identity }) => {
	const all = await listAllSessions(identity);

	return Promise.all(
		candidatesFrom(project ? all.filter(session => session.project === project) : all).map(async session => ({
			...session,
			...(await lately(session.id)),
		})),
	);
};

// Every server's candidates and projects: this one's, and with `remotes`, those of the other servers this machine is
// logged into as owner, each marked with its server ({ url, name }; none for this one)
const everyPlace = async ({ project, identity, remotes }) => {
	const here = { remote: undefined, candidates: await localCandidates({ project, identity }) };
	const there = remotes
		? await Promise.all(
				(await ownedRemotes()).map(async ({ server, name }) => {
					const remote = { url: server.url, name };
					const query = project ? `?project=${encodeURIComponent(project)}` : '';
					const [candidates, projects] = await Promise.all([
						remoteApi(server.url, `/api/prompt-candidates${query}`).catch(() => []),
						project ? [] : remoteApi(server.url, '/api/projects').catch(() => []),
					]);

					return { remote, candidates: candidates ?? [], projects: (projects ?? []).map(({ name: found }) => found) };
				}),
			)
		: [];
	const places = [{ ...here, projects: project ? [] : await listProjects() }, ...there];

	return {
		candidates: places.flatMap(({ remote, candidates }) => candidates.map(session => ({ ...session, remote }))),
		projects: project ? null : places.flatMap(({ remote, projects }) => projects.map(name => ({ name, remote }))),
	};
};

const placeName = ({ name, remote }, here) => `${name} on ${remote?.name ?? here}`;

const meterFor = async ({ id, remote }) => {
	if (remote) return (await remoteApi(remote.url, `/api/sessions/${id}/meter`).catch(() => null))?.meter ?? null;

	const record = await sessionRecord(id);

	return record ? meterOf(id, record.cwd) : null;
};

// project: a project's name keeps the search to its sessions, and a new session to it. remotes: weigh the other
// servers' sessions and projects too.
export const findHome = async ({ prompt, project, identity, remotes = false }) => {
	const here = await serverName();
	const { candidates, projects } = await everyPlace({ project, identity, remotes });
	const named = candidates.map(session => ({
		...session,
		where: placeName({ name: session.project, remote: session.remote }, here),
	}));
	const reply = jsonIn(
		await askHaiku(homePrompt({ prompt, candidates: named, projects: projects?.map(found => placeName(found, here)) })),
	);

	if (!reply) return null;

	const matches = await Promise.all(
		(Array.isArray(reply.matches) ? reply.matches : [])
			.map(match => ({ session: candidates[Number(match?.n) - 1], why: String(match?.why ?? '') }))
			.filter(match => match.session)
			.slice(0, MOST_MATCHES)
			.map(async ({ session, why }) => {
				const { latest, changed, remote, ...summary } = session;

				return { session: summary, remote, why, meter: await meterFor(session) };
			}),
	);
	// As written, or by the project's name alone (this server's first) when Haiku left the server off
	const said = String(reply.fresh?.project ?? '').trim();
	const fresh = project
		? { name: project }
		: (projects.find(found => placeName(found, here) === said) ?? projects.find(found => found.name === said));

	return {
		matches,
		fresh: { project: fresh?.name ?? null, remote: fresh?.remote, why: String(reply.fresh?.why ?? '') },
	};
};
