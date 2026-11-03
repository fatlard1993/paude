import os from 'os';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

import { facilityOf } from '../shared/facilities';
import { folderHue, sessionHue } from '../shared/hues';
import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';

import { activitySummary, identityKey, watchedBy, watchesProject } from './activity';
import { sessionArtifacts } from './artifacts';
import { meterOf } from './cacheMeter';
import { boostOf, keptOf } from './keepWarm';
import { crewOf } from './crew';
import { fuelOf } from './fuel';
import { getNotes } from './notes';
import { pullRequest } from './pullRequests';
import { sharesOf } from './shares';
import { processesOf } from './tasks';
import { journeyOf, noteDelivered } from './journey';
import { combinedHistory, foldersOf, languageOf } from './character';
import { defaultBase, gitLog, gitStatus, linkedWorktree, openBase, repoHistory, repoRoot, trackedFiles } from './git';
import { pinnedName } from './names';
import { listProjects, projectOf, projectPath } from './projects';
import { serverName } from './serverSettings';
import { sessionRecord } from './sessions/record';
import { allRunning } from './sessions/running';
import { listAllSessions } from './sessions/stored';
import { limitOf } from './usageLimit';
import { verification } from './verification';

const REPLY_LIMIT = 6000;
const PROMPT_PREVIEW = 200;
// A stopped session's name and folder change rarely; looked up again after this long
const RECORD_MS = 60_000;
// How long a checkout's cargo, a session's context, what it has made and whether it's tested are kept before looked
// at again
const CARGO_MS = 8000;
const CONTEXT_MS = 5000;
const ASSETS_MS = 30_000;
const TESTED_MS = 20_000;
const PROCESSES_MS = 10_000;
const PULL_REQUEST_MS = 2 * 60_000;
// The most of a session's processes named, and of its chat; chat older than this isn't what's being said now
const MOST_PROCESSES = 6;
const MOST_TALK = 3;
const TALK_MS = 15 * 60_000;
const CHARACTER_MS = 10 * 60_000;
// When a stopped session's cache went, which doesn't change until it's resumed (when it's no longer stopped)
const COLD_MS = 60 * 60_000;
// A context past Claude's usual window is on the larger one
const WINDOWS = [200_000, 1_000_000];
const UNPUSHED_LIMIT = 50;
// The changed files and commits not pushed a checkout's cargo names, as many as the hold shows
const CARGO_SHOWN = { files: 8, commits: 6 };
// The lounge's: sessions stopped within a day, newest first, as many as it seats. Listing every saved session reads
// each one's transcript, so it's looked at again only every half minute, or once one is archived or deleted.
const LOUNGE_MS = 24 * 60 * 60_000;
const LOUNGE_MOST = 8;
const LOUNGE_LOOK_MS = 30_000;

// Every tool Claude has used on this machine, kept: what it can reach here, its MCP servers among them. Each running
// session's last tool, null once a prompt starts a turn with none used yet; and each session's last finished turn's
// reply, with the prompt it answered, kept by id so it outlives the session's process.
let toolsFile;
let tools = new Set();
const lastTools = new WeakMap();
const prompts = new Map();
const replies = new Map();
const records = new Map();
const looks = new Map();
// What each running session's hooks have said lately, for the ship's instruments: how many tools failed this turn and
// when the last did, its todo list as last written, the subagents it has out now, its permission mode, and when its
// turn began
const signals = new WeakMap();
const AGENT_TOOLS = new Set(['Task', 'Agent']);
const MOST_TODOS = 12;
// Each tool used on this machine lately, and whether it failed, for how hard each of its facilities is working, and
// what it was used on, for each facility's log of its latest
const USAGE_MS = 10 * 60_000;
const LOG_LENGTH = 12;
const DETAIL_LENGTH = 80;
let uses = [];

// A tool's use in a few words: the file relative to the session's folder, a command's first line, the address,
// the pattern or query, a subagent's task
const detailOf = (input, cwd) => {
	if (!input || typeof input !== 'object') return null;

	const file = input.file_path ?? input.notebook_path ?? input.path;
	const text = file
		? path.relative(cwd ?? '', String(file)) || String(file)
		: (input.command ?? input.url ?? input.pattern ?? input.query ?? input.description ?? input.prompt);

	return typeof text === 'string' && text ? text.split('\n')[0].slice(0, DETAIL_LENGTH) : null;
};

// What `look` answers for `key`, worked out again only once it's older than `ms`; a look that fails answers null.
// Asked again while it's being worked out, the answer on its way is shared rather than worked out twice.
const kept = async (key, ms, look) => {
	const known = looks.get(key);

	if (known && Date.now() - known.at < ms) return known.value;
	if (known?.coming) return known.coming;

	const coming = look()
		.catch(() => null)
		.then(value => {
			looks.set(key, { at: Date.now(), value });

			return value;
		});

	looks.set(key, { ...known, coming });

	return coming;
};

export const initUniverse = async dataDir => {
	toolsFile = path.join(dataDir, 'tools.json');
	tools = new Set(await readJsonFile(toolsFile, []));
};

export const noteTool = async (session, name, failed = false, input = undefined) => {
	lastTools.set(session, name ?? null);
	if (name)
		uses.push({
			at: Date.now(),
			facility: facilityOf(name),
			failed,
			tool: name,
			session: session?.id,
			detail: detailOf(input, session?.cwd),
		});
	if (!name || tools.has(name)) return;

	tools.add(name);
	if (toolsFile) await writeJsonFile(toolsFile, () => [...tools]);
};

// Each facility's uses in the last ten minutes, and how many of them failed: { [facility]: { uses, failures } }
export const usageOf = (now = Date.now()) => {
	uses = uses.filter(({ at }) => now - at < USAGE_MS);

	const usage = {};

	for (const { facility, failed } of uses) {
		usage[facility] ??= { uses: 0, failures: 0 };
		usage[facility].uses += 1;
		if (failed) usage[facility].failures += 1;
	}

	return usage;
};

// Each facility's latest uses, newest first, kept to the last ten minutes: { [facility]: [{ ago, tool, session,
// detail, failed }] }
export const logOf = (now = Date.now()) => {
	const log = {};

	for (const { at, facility, failed, tool, session, detail } of uses.filter(use => now - use.at < USAGE_MS).reverse()) {
		log[facility] ??= [];
		if (log[facility].length < LOG_LENGTH) log[facility].push({ ago: now - at, tool, session, detail, failed });
	}

	return log;
};

export const notePrompt = (session, prompt) => {
	lastTools.set(session, null);
	if (typeof prompt === 'string') prompts.set(session.id, prompt.slice(0, PROMPT_PREVIEW));
};

// Claude Code hands the turn's last message to the Stop hook; a turn that ended without writing one keeps none
export const noteTurnDone = (session, reply) => {
	noteDelivered('replies');
	replies.set(session.id, {
		turn: (replies.get(session.id)?.turn ?? 0) + 1,
		at: Date.now(),
		prompt: prompts.get(session.id) ?? null,
		text: typeof reply === 'string' ? reply.slice(0, REPLY_LIMIT) : null,
		cut: typeof reply === 'string' && reply.length > REPLY_LIMIT,
	});
};

export const replyOf = id => replies.get(id) ?? null;

const signalsOf = session => {
	if (!signals.has(session))
		signals.set(session, { faults: 0, faultAt: null, todos: null, agents: new Map(), mode: null, turnAt: null });

	return signals.get(session);
};

// A subagent is out from its tool's start to its end, with what it was sent to do; a turn that ends or is cut short
// calls them all back
export const noteHook = (session, payload) => {
	const known = signalsOf(session);
	const event = payload.hook_event_name;

	if (typeof payload.permission_mode === 'string') known.mode = payload.permission_mode;
	if (event === 'UserPromptSubmit') Object.assign(known, { faults: 0, turnAt: Date.now() });
	if (['UserPromptSubmit', 'Stop', 'StopFailure'].includes(event)) known.agents.clear();
	if (['Stop', 'StopFailure'].includes(event)) known.turnAt = null;
	if (event === 'PreToolUse' && AGENT_TOOLS.has(payload.tool_name))
		known.agents.set(
			payload.tool_use_id,
			String(payload.tool_input?.description || payload.tool_input?.subagent_type || '').slice(0, PROMPT_PREVIEW),
		);
	if (['PostToolUse', 'PostToolUseFailure'].includes(event)) known.agents.delete(payload.tool_use_id);
	if (event === 'PostToolUseFailure') Object.assign(known, { faults: known.faults + 1, faultAt: Date.now() });
	if (event === 'PostToolUse' && payload.tool_name === 'TodoWrite' && Array.isArray(payload.tool_input?.todos))
		known.todos = payload.tool_input.todos.slice(0, MOST_TODOS).map(({ status, content, activeForm }) => ({
			status,
			text: String(activeForm || content || '').slice(0, PROMPT_PREVIEW),
		}));
};

// Times as how long ago, so a machine's clock never has to agree with the browser's
export const instrumentsOf = session => {
	const { faults, faultAt, todos, agents, mode, turnAt } = signalsOf(session);
	const now = Date.now();

	return {
		faults,
		faultAgo: faultAt === null ? undefined : now - faultAt,
		todos: todos ?? undefined,
		agents: agents.size,
		subagents: agents.size ? [...agents.values()] : undefined,
		mode: mode ?? undefined,
		turnAge: turnAt === null ? undefined : now - turnAt,
	};
};

// The owner on two devices is one person; so is a guest watching from two
export const peopleOf = sessions => {
	const people = new Map();

	for (const session of sessions)
		for (const client of [...session.clients, ...session.readers.values()]) {
			const key = `${identityKey(client.identity ?? client.socket?.data.identity)}\n${client.name}`;
			// Told apart by an opaque mark of who they are, not their invite itself
			const person = people.get(key) ?? {
				key: Bun.hash(key).toString(36),
				name: client.name,
				role: client.role,
				sessions: [],
			};

			if (!person.sessions.includes(session.id)) person.sessions.push(session.id);
			people.set(key, person);
		}

	return [...people.values()];
};

const recordOf = async id => {
	const known = records.get(id);

	if (known && Date.now() - known.at < RECORD_MS) return known.record;

	const record = await sessionRecord(id);

	records.set(id, { at: Date.now(), record });

	return record;
};

// Each checkout's commits not pushed when last looked, and on which branch
const pushedBefore = new Map();

// A checkout's cargo: files changed and not committed, and commits not pushed (ahead of its upstream, or of where it
// left the default branch when it has none); and where it is: its branch, whether that's the one work is compared
// with (the trunk), and whether it's a worktree beside the repository's first checkout. The files and commits it names
// are only as many as the hold shows.
const cargoOf = root =>
	kept(`cargo:${root}`, CARGO_MS, async () => {
		const status = await gitStatus(root);
		const entries = [...status.conflicted, ...status.staged, ...status.unstaged, ...status.untracked];
		const changed = new Set(entries.map(entry => entry.path));
		const ahead = status.upstream ? '@{upstream}' : await openBase(root);
		// With an upstream, git already counted them, and only those named are asked for
		const commits =
			ahead && (!status.upstream || status.ahead)
				? await gitLog(root, {
						ref: `${ahead}..HEAD`,
						limit: status.upstream ? CARGO_SHOWN.commits : UNPUSHED_LIMIT,
					})
				: [];
		const [base, worktree] = await Promise.all([defaultBase(root), linkedWorktree(root)]);
		const files = [...changed].slice(0, CARGO_SHOWN.files).map(file => ({
			path: file,
			status: entries.find(entry => entry.path === file).status ?? 'conflicted',
		}));

		const unpushed = status.upstream ? status.ahead : commits.length;
		const before = pushedBefore.get(root);

		// Fewer not pushed on the same branch than when last looked: those went
		if (before?.branch === status.branch && unpushed < before.unpushed)
			noteDelivered('commits', before.unpushed - unpushed);
		pushedBefore.set(root, { branch: status.branch, unpushed });

		return {
			changed: changed.size,
			unpushed,
			files,
			commits: commits.slice(0, CARGO_SHOWN.commits).map(({ short, subject }) => ({ short, subject })),
			branch: status.branch,
			trunk: Boolean(base) && status.branch === base.replace(/^[^/]+\//, ''),
			worktree,
		};
	});

// Whether what a session changed has been tested since: { state, said }, state 'current', 'stale', 'failing' or
// 'untested'; null with neither changes nor runs. Reading its turns is slow, so it's looked at again only now and then.
const testedOf = session =>
	kept(`tested:${session.id}`, TESTED_MS, async () => {
		const verdict = await verification(session.id, session.cwd);

		return verdict && { state: verdict.state, said: verdict.said };
	});

// What a session runs beside Claude (its dev servers, test runs, watchers), each with its CPU and memory, and what it
// shares out: each port another can reach at its name
const busyOf = async session =>
	(await kept(`busy:${session.id}`, PROCESSES_MS, async () => ({
		processes: (await processesOf(session.id))
			.slice(0, MOST_PROCESSES)
			.map(({ command, cpuSeconds, memoryBytes }) => ({ command, cpuSeconds, memoryBytes })),
		services: sharesOf(session.id)
			.filter(({ kind }) => kind === 'port')
			.map(({ name, port }) => ({ name, port })),
	}))) ?? {};

// What the people in a session have said lately (the chat's last few lines in the last quarter hour, each with who and
// whether it went to Claude or came from it), and how many comments are still open
const talkOf = async session => {
	const { chat = [], comments = [] } = await getNotes(session.id);
	const now = Date.now();

	return {
		lately: chat
			.filter(({ at }) => now - at < TALK_MS)
			.slice(-MOST_TALK)
			.map(({ author, text, at, toClaude, fromClaude }) => ({
				author,
				text: text.slice(0, PROMPT_PREVIEW),
				ago: now - at,
				toClaude: toClaude || undefined,
				fromClaude: fromClaude || undefined,
			})),
		open: comments.filter(({ resolved }) => !resolved).length,
	};
};

// The pull request for a checkout's branch off the trunk, as GitHub's gh says: its number, title, state, and its
// checks counted by how they stand. Asking gh is slow, so it's looked at again only every couple of minutes.
const pullRequestOf = (root, trunk) =>
	trunk
		? null
		: kept(`pr:${root}`, PULL_REQUEST_MS, async () => {
				const found = await pullRequest(root);

				if (!found || found.unavailable) return null;

				const checks = { passing: 0, failing: 0, pending: 0 };

				for (const { state } of found.checks)
					if (['success', 'neutral', 'skipped'].includes(state)) checks.passing += 1;
					else if (['failure', 'error', 'cancelled', 'timed_out', 'action_required'].includes(state))
						checks.failing += 1;
					else checks.pending += 1;

				return { number: found.number, title: found.title, state: found.state, draft: found.isDraft, checks };
			});

// How full a session's context is, against the window it fits; whether Claude's prompt cache still holds it; and the
// model that last answered
const contextOf = session =>
	kept(`context:${session.id}`, CONTEXT_MS, async () => {
		const meter = await meterOf(session.id, session.cwd);

		if (!meter) return null;

		const window = WINDOWS.find(size => meter.context <= size) ?? WINDOWS.at(-1);

		return {
			tokens: meter.context,
			window,
			fill: meter.context / window,
			warm: meter.warm,
			// How long its cache has left of the life it was written with, so a waiting grey can doze off as it goes
			// and, gone, how long ago, for its empties in the lounge it goes to
			cache: {
				left: Math.max(0, meter.warmUntil - Date.now()),
				life: meter.life,
				ago: Math.max(0, Date.now() - meter.warmUntil),
			},
			model: meter.model,
		};
	});

// A project's character, for its machine: the language most of its files are in, how many it tracks, the top-level
// folders it's built from, when its first commit was made and how many it has had, and how busy it's been lately;
// null outside git
const characterOf = name =>
	kept(`character:${name}`, CHARACTER_MS, async () => {
		const folder = projectPath(name);
		const root = await repoRoot(folder);

		if (root) {
			const [files, history] = await Promise.all([trackedFiles(root), repoHistory(root)]);

			return { language: languageOf(files), files: files.length, folders: foldersOf(files), ...history };
		}

		// Not a repository itself but a folder of them (a suite of mods, say): one project built from them all, each a
		// folder of it, their histories as one
		const repos = await reposIn(folder);

		if (!repos.length) return null;

		const files = [];
		const histories = [];

		// A few at a time, a folder of dozens being a few hundred git calls
		for (let start = 0; start < repos.length; start += 6)
			for (const [name, tracked, history] of await Promise.all(
				repos.slice(start, start + 6).map(async repo => {
					const at = path.join(folder, repo);

					return [repo, await trackedFiles(at), await repoHistory(at)];
				}),
			)) {
				files.push(...tracked.map(file => `${name}/${file}`));
				histories.push(history);
			}

		return {
			language: languageOf(files),
			files: files.length,
			folders: foldersOf(files),
			...combinedHistory(histories),
		};
	});

// The repositories directly inside a folder that isn't one itself
const reposIn = async folder => {
	try {
		const entries = await fs.readdir(folder, { withFileTypes: true });

		return entries
			.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
			.map(entry => entry.name)
			.filter(name => existsSync(path.join(folder, name, '.git')));
	} catch {
		return [];
	}
};

// How many artifacts a session has made; more than when last counted is more delivered (the first count only sets
// where it starts)
const madeBefore = new Map();
const assetsOf = session =>
	kept(`assets:${session.id}`, ASSETS_MS, async () => {
		const made = (await sessionArtifacts(session.id, session.cwd)).length;

		if (madeBefore.has(session.id)) noteDelivered('artifacts', made - madeBefore.get(session.id));
		madeBefore.set(session.id, made);

		return made;
	});

// When a stopped session's prompt cache went cold, by its last answer and the cache's lifetime; null before any answer.
// Kept for each time it stopped (`since`), so one resumed and stopped again isn't given its earlier stop's
export const coldAt = (id, cwd, since) =>
	kept(`cold:${id}:${since}`, COLD_MS, async () => (await meterOf(id, cwd))?.warmUntil ?? null);

// A stopped session, as the lounge shows it, with how long since it was last at work and since its cache went cold
const stoppedOf = async (identity, id) => {
	const record = await recordOf(id);

	if (!record) return null;

	const project = projectOf(record.cwd);

	return {
		id,
		title: pinnedName(id) || record.title,
		project,
		hue: sessionHue(id),
		...activitySummary(identity, id, { running: false, project }),
		tool: null,
		reply: replyOf(id),
		stoppedAgo: record.stored?.lastModified ? Date.now() - record.stored.lastModified : undefined,
		coldAgo: await coldAt(id, record.cwd, record.stored?.lastModified).then(at =>
			at ? Math.max(0, Date.now() - at) : undefined,
		),
	};
};

// The stopped sessions this person sees: those they watch by hand with news for them, then those stopped lately.
// (Those a watched project covers without a hand-set watch are found among the lately stopped, or left to the home
// page.)
const stoppedFor = async (identity, running) => {
	const withNews = watchedBy(identity).filter(
		id => !running.has(id) && activitySummary(identity, id, { running: false }).unseen > 0,
	);
	const lately = await kept(`lately:${identityKey(identity)}`, LOUNGE_LOOK_MS, async () =>
		(await listAllSessions(identity))
			.filter(({ live, archived, lastModified }) => !live && !archived && Date.now() - (lastModified ?? 0) < LOUNGE_MS)
			.slice(0, LOUNGE_MOST)
			.map(({ id }) => id),
	);
	const ids = [...new Set([...withNews, ...(lately ?? []).filter(id => !running.has(id))])];

	return (await Promise.all(ids.map(id => stoppedOf(identity, id)))).filter(Boolean);
};

// Archived or deleted, a session leaves the lounge on the next look
export const refreshLounge = () => {
	for (const key of looks.keys()) if (key.startsWith('lately:')) looks.delete(key);
};

// This machine as the universe view draws it, for this person: what its Claude can reach, its projects, the sessions
// running on it (each with how full its context is, how long it's run, how much it has made, any usage limit it's
// waiting out, what its hooks said lately, and its screen) and the stopped ones with news for them or stopped lately,
// the cargo of each checkout they work in, and who's here to see
export const universe = async identity => {
	const running = [...allRunning()].filter(session => !session.ended);
	const roots = new Map(
		await Promise.all(
			running.map(async session => [
				session,
				await kept(`root:${session.cwd}`, RECORD_MS, () => repoRoot(session.cwd)),
			]),
		),
	);
	const checkouts = await Promise.all(
		[...new Set(roots.values())].filter(Boolean).map(async root => {
			const cargo = await cargoOf(root);

			return { root, ...cargo, pullRequest: (await pullRequestOf(root, cargo?.trunk)) ?? undefined };
		}),
	);
	const live = await Promise.all(
		running.map(async session => {
			const project = projectOf(session.cwd);
			const [context, assets, tested, busy, talk] = await Promise.all([
				contextOf(session),
				assetsOf(session),
				testedOf(session),
				busyOf(session),
				talkOf(session),
			]);

			return {
				id: session.id,
				title: pinnedName(session.id) || session.title,
				project,
				hue: sessionHue(session.id),
				...activitySummary(identity, session.id, { running: true, busy: session.busy, project }),
				tool: lastTools.get(session) ?? null,
				reply: replyOf(session.id),
				asking: session.asking() ?? undefined,
				checkout: roots.get(session) ?? undefined,
				context: context ?? undefined,
				untilCompact: session.untilCompact?.() ?? undefined,
				assets: assets ?? 0,
				tested: tested ?? undefined,
				...busy,
				talk,
				age: Date.now() - session.startedAt,
				limit: limitOf(session.id) ?? undefined,
				// Kept warm, or kept going, and the last ping or nudge it was sent
				kept: keptOf(session.id) ?? undefined,
				boost: boostOf(session.id) ?? undefined,
				...instrumentsOf(session),
				// Its size, for a terminal opened from the universe to take
				screen: { cols: session.cols, rows: session.rows },
			};
		}),
	);

	const sessions = [...live, ...(await stoppedFor(identity, new Set(live.map(({ id }) => id))))];

	return {
		name: await serverName(),
		tools: [...tools],
		usage: usageOf(),
		log: logOf(),
		fuel: await fuelOf(),
		crew: crewOf(),
		journey: journeyOf(),
		projects: await Promise.all(
			(await listProjects()).map(async name => {
				const watching = watchesProject(identity, name);

				return {
					name,
					hue: folderHue(projectPath(name), os.homedir()),
					watching,
					// Every project is a machine aboard, at work or not, so every one is looked into
					character: (await characterOf(name)) || undefined,
				};
			}),
		),
		sessions,
		checkouts: checkouts.filter(({ changed }) => changed !== undefined),
		people: peopleOf(running),
	};
};
