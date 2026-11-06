import { limitsOf } from './accountLimits';
import { meterOf } from './cacheMeter';
import askHaiku, { jsonIn } from './haiku';
import { isNudge } from './keepWarm';
import { MODEL_NAMES, MODELS } from '../shared/models';
import { listProjects } from './projects';
import { ownedRemotes, remoteApi } from './remotes';
import { serverName } from './serverSettings';
import { sessionRecord } from './sessions/record';
import { listAllSessions } from './sessions/stored';
import { editedFiles, sessionTimeline } from './timeline';

// Where a prompt should go before it's sent: one of the conversations already going, when it carries one on, or a new
// session (in which project, when that's open too). Haiku judges the fit from each session's title and latest prompts;
// what sending costs, warm or cold, comes from each match's cache meter.
const RECENT_MS = 3 * 24 * 60 * 60 * 1000;
const MOST_CANDIDATES = 15;
const MOST_MATCHES = 3;
const LATEST_PROMPTS = 5;
const CHANGED_FILES = 10;
const PROMPT_CHARACTERS = 160;
// The keep-warm pings and keep-going nudges say nothing of what a session is about
const KEEP_WARM_PING = /^keep-?warm ping/i;
// What Haiku may pick for how long a new session lasts: the ones its prompt offers. Keeping going (and fabled, going
// with a Fable monitor) acts unattended on the owner's usage, so those are only ever chosen by hand.
export const PLACED_LIFETIMES = ['ordinary', 'warm', 'brief'];

export const placedLifetime = said => (PLACED_LIFETIMES.includes(said) ? said : 'ordinary');

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
	const files = turns.flatMap(turn => turn.steps.flatMap(editedFiles));

	return {
		latest: turns
			.map(turn => turn.prompt)
			.filter(prompt => prompt && !KEEP_WARM_PING.test(prompt) && !isNudge(prompt))
			.slice(0, LATEST_PROMPTS)
			.map(clip),
		changed: [...new Set(files)].slice(0, CHANGED_FILES),
	};
};

// How long until `at`, roughly: minutes, hours, or days
const until = (at, now) => {
	const minutes = Math.max(0, Math.round((new Date(at).getTime() - now) / 60_000));

	if (minutes < 90) return `${minutes} minutes`;

	return minutes < 36 * 60 ? `${Math.round(minutes / 60)} hours` : `${Math.round(minutes / (24 * 60))} days`;
};

const limitWords = (name, { percent, resetsAt }, now) =>
	`${name} ${Math.round(percent)}% used${resetsAt ? `, resetting in ${until(resetsAt, now)}` : ''}`;

// The account's limits as Haiku is told them, to weigh the model against; none when they aren't known
export const limitsPrompt = (limits, now = Date.now()) =>
	limits &&
	[
		`The account's usage limits right now: ${[
			limits.session.resetsAt
				? limitWords('the five-hour window', limits.session, now)
				: 'the five-hour window not yet begun (none of it used)',
			limits.week && limitWords('the week', limits.week, now),
			...limits.models.map(model => limitWords(`${model.name}'s own week`, model, now)),
		]
			.filter(Boolean)
			.join('; ')}.`,
		'Weigh them in the model: with a limit well used and long to reset, suggest a lighter model unless the task truly needs a heavier one; never one whose own week is nearly used up; with plenty left, the task alone decides.',
	].join(' ');

export const homePrompt = ({ prompt, candidates, projects, limits, now = Date.now() }) =>
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
		`For a new session, also say which model suits the task, the lightest that will do it well: ${MODEL_NAMES.map(name => `"${name}" (${MODELS[name].detail})`).join('; ')}.`,
		limitsPrompt(limits, now),
		'For a new session, also say how long it should last: "brief" for a quick question or one-off check nobody will come back to (it deletes itself once done), "warm" for deep work likely to be picked up again after a break of an hour or more (kept ready while away), or "ordinary".',
		`Reply with only a JSON object: {"matches": [{"n": 2, "why": "…"}], "fresh": {${projects ? '"project": "…", ' : ''}"model": "sonnet", "modelWhy": "…", "lifetime": "ordinary", "why": "…"}}.${projects ? ' "project" is one of the projects exactly as written above.' : ''} "matches" holds at most ${MOST_MATCHES} conversations this truly carries on, best first, and is empty when none does; each "why" is one plain sentence that names a conversation by its title, never by its number. "modelWhy" is one plain sentence saying why that model fits, naming the limits when they swayed it.`,
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
	const [{ candidates, projects }, limits] = await Promise.all([
		everyPlace({ project, identity, remotes }),
		limitsOf(),
	]);
	const named = candidates.map(session => ({
		...session,
		where: placeName({ name: session.project, remote: session.remote }, here),
	}));
	const reply = jsonIn(
		await askHaiku(
			homePrompt({ prompt, candidates: named, projects: projects?.map(found => placeName(found, here)), limits }),
			'placing a prompt',
		),
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
		fresh: {
			project: fresh?.name ?? null,
			remote: fresh?.remote,
			lifetime: placedLifetime(reply.fresh?.lifetime),
			model: MODEL_NAMES.includes(reply.fresh?.model) ? reply.fresh.model : 'default',
			modelWhy: MODEL_NAMES.includes(reply.fresh?.model) ? String(reply.fresh?.modelWhy ?? '') : '',
			why: String(reply.fresh?.why ?? ''),
		},
	};
};
