import { stat } from 'fs/promises';
import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { statusOf } from './activity';
import { changedFiles, explainInto, fileInto, openConcerns, targetFor } from './backfill';
import { markInterruptions, steeringOf } from './catchUp';
import describer from './describer';
import { explainedHash, headCommit, repoRoot } from './git';
import askHaiku, { jsonIn } from './haiku';
import { allRunning, runningSession } from './sessions/running';
import { claudeHome } from './sessions/transcript';
import { sessionTurns } from './timeline';
import { linkedCommits, turnNote } from './turnCommits';
import gitEnvironment from './utils/gitEnvironment';

// What a session decided that was never written down. The code holds what was decided and a commit can hold why; this
// finds the rest: Haiku reads each finished turn once for its decisions (chosen, rejected, why), the directions the
// person gave and the work put off, then looks for each in the places they'd be written down (the commits since, the
// instruction files, the design documents). What's found nowhere is filed into the open commit it shaped, once the
// session is idle (backfill.js); what has no open commit, or needs the person to settle it, is what the panel leads
// with.
const KINDS = new Set(['decision', 'direction', 'deferred']);
const TURNS_AT_ONCE = 4;
const JUDGED_AT_ONCE = 15;
const ANSWERS = 600;
// What the person said next, read with a turn
const REPLY = 1000;
// How much of each kind of place Haiku reads, at most, and of any one file
const PLACE_CHARACTERS = 30_000;
// What looking for a place asks, by version: changing what it asks looks again for every one found nowhere, as the
// places changing does. 2: whether one overrules a design document's claim, or belongs in one.
const PLACES_ASKED = 2;
const FILE_CHARACTERS = 8000;
// A look for a decision's place that came back with nothing waits this long before it's tried again
const RETRY_MS = 10 * 60 * 1000;
const KEEP_WARM_PING = /^keep-?warm ping/i;
// How often, and how long, a session is followed after a prompt or a turn's end
const FOLLOW_MS = 5000;
const FOLLOW_ROUNDS = 120;
const SETTLING_ROUNDS = 3;
const PUSH_POLL_MS = 1000;

// A turn as Haiku reads it: what was asked, how the person steered, what they answered and turned down, what changed,
// what Claude ended with
export const turnText = (turn, index) =>
	[
		`Turn ${index + 1}`,
		turn.summary
			? "  (Claude went on from a summary of the conversation before it: nothing here is the person's words.)"
			: `  Asked: ${turn.asked ?? turn.prompt}`,
		...(turn.added ?? []).map(added => `  The person added while Claude worked: ${added}`),
		steeringOf(turn).length && `  The person ${steeringOf(turn).join(', ')}.`,
		...turn.steps
			.filter(step => step.declined)
			.map(step => `  Turned down: ${step.tool} ${step.summary ?? ''}`.trimEnd()),
		...turn.steps
			.filter(step => step.tool === 'AskUserQuestion' && step.output)
			.map(step => `  Answered: ${step.output.replace(/\s+/g, ' ').slice(0, ANSWERS)}`),
		turn.steps.some(step => step.edits) &&
			`  Changed: ${[...new Set(turn.steps.filter(step => step.edits).map(step => step.file))].join(', ')}`,
		turn.said && `  Claude ended with: ${turn.said}`,
		turn.reply && `  Then the person said: ${turn.reply}`,
	]
		.filter(Boolean)
		.join('\n');

export const findPrompt = turns =>
	[
		'Below are turns of a conversation between a person and Claude, a coding assistant. Find what each turn settled that someone working on this later would need to know. Three kinds:',
		'- decision: a choice about what the work is or how it is built, one someone later could get wrong without knowing it: what it should do, which way was taken, what was turned down',
		'- direction: an instruction from the person about how the work is done',
		'- deferred: work agreed to but put off for later',
		"Routine edits, questions and fixes settle nothing: leave those turns empty. The person's own words settle the most; where they steered (stopped Claude, redirected it, turned something down, answered a question), look there first. What Claude proposed, offered or asked is settled only when the person agreed to it: read what they said next, and when they turned it down, it is what was rejected.",
		'Each as {"kind", "chose", "rejected", "because"}: chose is the decision, the direction or the work put off, in one plain sentence; rejected is what was turned down, "" when nothing was; because is why, in one sentence, "" when no reason was given. Never invent a reason. Call them "the person", never "the user".',
		'Reply with only a JSON object from each turn number to its list, every number given one: {"1": [], "2": [{"kind": "decision", "chose": "…", "rejected": "…", "because": "…"}]}.',
		turns.map(turnText).join('\n\n'),
	].join('\n\n');

const plain = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

// Haiku's reply as { [number]: [{ kind, chose, rejected, because }] }: what isn't one of those, left out
export const parseFound = reply =>
	Object.fromEntries(
		Object.entries(jsonIn(reply) ?? {})
			.filter(([, found]) => Array.isArray(found))
			.map(([number, found]) => [
				number,
				found
					.filter(item => KINDS.has(item?.kind) && plain(item.chose))
					.map(item => ({
						kind: item.kind,
						chose: plain(item.chose),
						rejected: plain(item.rejected),
						because: plain(item.because),
					})),
			]),
	);

// A turn going on from a summary is read under a key of its own: read as the person's words, it once found the whole
// summary's decisions over again
const keyOf = turn => (turn.summary ? `${turn.id}:summary` : turn.id);

const found = describer({
	fileName: 'decisions.json',
	keyOf,
	promptFor: findPrompt,
	// The latest first: what the panel shows at the top
	sooner: (a, b) => String(b.at).localeCompare(String(a.at)),
	batchSize: TURNS_AT_ONCE,
	parse: parseFound,
	keep: list => list,
});

const gitOut = async (args, cwd) => {
	const child = Bun.spawn(['git', ...args], { cwd, env: gitEnvironment(), stdout: 'pipe', stderr: 'ignore' });
	const out = await new Response(child.stdout).text();

	return (await child.exited) === 0 ? out : '';
};

const readCapped = async file =>
	Bun.file(file)
		.slice(0, FILE_CHARACTERS)
		.text()
		.catch(() => '');

// The files of one kind, each under its path, to PLACE_CHARACTERS in all
const filesText = async (files, root) => {
	let text = '';

	for (const file of files) {
		const contents = await readCapped(path.isAbsolute(file) ? file : path.join(root, file));

		if (!contents.trim()) continue;
		text += `== ${file}\n${contents.trim()}\n\n`;
		if (text.length > PLACE_CHARACTERS) break;
	}

	return text.slice(0, PLACE_CHARACTERS);
};

// The person's own skills: where a standing direction is often written down
const skillFiles = async () => {
	const folder = path.join(claudeHome(), 'skills');
	const files = [];

	try {
		for await (const file of new Bun.Glob('*/SKILL.md').scan({ cwd: folder, followSymlinks: true }))
			files.push(path.join(folder, file));
	} catch {
		// No skills folder
	}

	return files.sort();
};

// How many folders down a file and a document share
const sharedDepth = (file, document) => {
	const [a, b] = [path.dirname(file), path.dirname(document)].map(folder => (folder === '.' ? [] : folder.split('/')));
	let depth = 0;

	while (depth < a.length && a[depth] === b[depth]) depth += 1;

	return depth;
};

// Documents by the most folders shared with any of the files, deepest first; otherwise as they were
export const nearestFirst = (documents, files) => {
	const nearness = document => Math.max(0, ...files.map(file => sharedDepth(file, document)));

	return documents.toSorted((a, b) => nearness(b) - nearness(a));
};

// The places a decision would be written down, as Haiku reads them, with the names it may answer with and a
// fingerprint that changes when any of them does: the commits since `since`, the instruction files (the project's, and
// the person's own CLAUDE.md and skills), the design documents. The commits oldest first: what records a decision is
// usually made soon after it, and a session looked back on weeks later has more since than Haiku reads. The design
// documents nearest the files `near` first (those the decisions' turns changed), as a project's whole set doesn't fit.
export const placesFor = async (cwd, since, { near = [] } = {}) => {
	const root = await repoRoot(cwd);
	const userInstructions = path.join(claudeHome(), 'CLAUDE.md');
	const listed = async patterns =>
		root ? (await gitOut(['ls-files', '-z', '--', ...patterns], root)).split('\0').filter(Boolean) : [];
	const [head, log, instructions, designs] = await Promise.all([
		root ? gitOut(['rev-parse', 'HEAD'], root) : '',
		root && since ? gitOut(['log', '--reverse', `--since=${since}`, '--format=commit %h%n%B%x00'], root) : '',
		listed(['CLAUDE.md', '*/CLAUDE.md', 'AGENTS.md', '*/AGENTS.md']),
		listed(['*.lld.md']).then(files => nearestFirst(files, near)),
	]);
	const instructionFiles = [...instructions, userInstructions, ...(await skillFiles())];
	const stamps = await Promise.all(
		[...instructionFiles, ...designs].map(async file => {
			const info = await stat(path.isAbsolute(file) ? file : path.join(root, file)).catch(() => null);

			return info ? `${file}:${info.size}:${info.mtimeMs}` : '';
		}),
	);
	const commits = [];
	let length = 0;

	for (const entry of log.split('\0').map(text => text.trim())) {
		if (!entry) continue;
		if (length + entry.length > PLACE_CHARACTERS) break;
		commits.push(entry);
		length += entry.length + 2;
	}

	return {
		fingerprint: [`asked ${PLACES_ASKED}`, head.trim(), ...stamps].join('|'),
		names: new Set([
			...commits.map(commit => commit.split('\n')[0].replace('commit ', '')),
			...instructionFiles,
			...designs,
		]),
		text: [
			commits.length && `Commits since:\n${commits.join('\n\n')}`,
			`Instruction files:\n${await filesText(instructionFiles, root)}`,
			designs.length && `Design documents:\n${await filesText(designs, root)}`,
		]
			.filter(Boolean)
			.join('\n\n'),
	};
};

export const placePrompt = (decisions, placesText) =>
	[
		'Each item below was settled in a conversation about a codebase. After them are the places its people write things down: commit messages, instruction files, design documents.',
		'For each item, say where it is written down: a commit by its short sha, or a file by its path, as given below. Written down means that place says the same thing, not that it touches the topic. When no place says it, null.',
		'Where a design document still claims what an item overrules (it states the opposite, or what the item rejected), answer that instead, as {"overrules": its path, "claim": the claim, quoted from it}. Only a claim the item cannot hold beside: a claim on a nearby topic is not overruled.',
		'Where no place says an item, but it is design intent for what a design document describes (the kind of thing that document claims, about the code it covers), answer {"belongs": its path}. Not a standing direction, a process or a preference: those belong elsewhere.',
		'Reply with only a JSON object from each number to its answer, like {"1": "382a290", "2": null, "3": {"overrules": "auth/auth.lld.md", "claim": "Failed attempts are tracked per session."}, "4": {"belongs": "auth/auth.lld.md"}}.',
		decisions
			.map((decision, index) =>
				[
					`${index + 1}. ${decision.chose}`,
					decision.rejected && `   Rejected: ${decision.rejected}`,
					decision.because && `   Because: ${decision.because}`,
				]
					.filter(Boolean)
					.join('\n'),
			)
			.join('\n'),
		placesText,
	].join('\n\n');

// A design document named as one of those given
const designDocument = (file, names) => typeof file === 'string' && file.endsWith('.lld.md') && names.has(file);

// A design document's claim an item overrules, when Haiku's answer names one of those given and quotes it
const overruled = (answer, names) =>
	designDocument(answer?.overrules, names) && typeof answer.claim === 'string' && answer.claim.trim()
		? { file: answer.overrules, claim: answer.claim.trim() }
		: null;

// Haiku's reply as { [number]: place | { overrules: { file, claim } } | { belongs: file } | null }, a place only when
// it is one of those given; null for no reply at all
export const parsePlaces = (reply, names) => {
	const json = jsonIn(reply);

	if (!json) return null;

	return Object.fromEntries(
		Object.entries(json).map(([number, answer]) => {
			const overrules = overruled(answer, names);

			if (overrules) return [number, { overrules }];
			if (designDocument(answer?.belongs, names)) return [number, { belongs: answer.belongs }];

			return [number, typeof answer === 'string' && names.has(answer) ? answer : null];
		}),
	);
};

let placesFile;
// { [decision id]: { place, overrules, belongs, fingerprint } }: a place found is kept; nowhere is looked into again
// when the places change, as is a design document's claim it overrules (by then, perhaps changed to agree) and one it
// belongs in
let placed = {};
let marksFile;
// { [session id]: [decision id] }: the ones set aside as not worth writing down
let dismissed = {};
const looking = new Set();
const failedAt = new Map();
let filingFile;
// { [decision id]: { into, question, answer, waiting, answered } }: the concern it was offered to, and what the person
// was asked about it and answered. It isn't offered to that concern again unless an answer came since.
let filing = {};
// Repositories a filing runs in, one at a time each, and the decisions it's filing
const filingIn = new Set();
const filingNow = new Set();

export const initDecisions = async dataDir => {
	await found.init(dataDir);
	placesFile = path.join(dataDir, 'decision-places.json');
	marksFile = path.join(dataDir, 'decision-marks.json');
	filingFile = path.join(dataDir, 'decision-filing.json');
	[placed, dismissed, filing] = await Promise.all([
		readJsonFile(placesFile, {}),
		readJsonFile(marksFile, {}),
		readJsonFile(filingFile, {}),
	]);
};

// Those still to look for: never looked for, or found nowhere since the places last changed
const toLookFor = (decisions, fingerprint) =>
	decisions.filter(
		decision =>
			!looking.has(decision.id) &&
			Date.now() - (failedAt.get(decision.id) ?? 0) > RETRY_MS &&
			(!placed[decision.id] || (placed[decision.id].place === null && placed[decision.id].fingerprint !== fingerprint)),
	);

// Each batch against the places since its earliest: `placesSince(since, batch)` gives them
const lookFor = async (decisions, placesSince, ask = askHaiku) => {
	const sorted = decisions.toSorted((a, b) => String(a.at).localeCompare(String(b.at)));

	for (const decision of decisions) looking.add(decision.id);
	try {
		for (let at = 0; at < sorted.length; at += JUDGED_AT_ONCE) {
			const batch = sorted.slice(at, at + JUDGED_AT_ONCE);
			const places = await placesSince(batch[0].at, batch);
			const answer = parsePlaces(await ask(placePrompt(batch, places.text)), places.names);

			if (!answer) {
				for (const decision of sorted.slice(at)) failedAt.set(decision.id, Date.now());
				break;
			}
			batch.forEach((decision, index) => {
				const said = answer[String(index + 1)] ?? null;

				placed[decision.id] = {
					place: typeof said === 'string' ? said : null,
					...(said?.overrules && { overrules: said.overrules }),
					...(said?.belongs && { belongs: said.belongs }),
					fingerprint: places.fingerprint,
				};
			});
			await writeJsonFile(placesFile, () => placed);
		}
	} finally {
		for (const decision of decisions) looking.delete(decision.id);
	}
};

// Those recorded nowhere, grouped by where each is filed: [[{ concern } or { commit }, decisions]]. Not work put off (no
// commit's why), not one waiting on the person, not one already offered there and left out. One about a pushed commit
// goes to the open commit already explaining it, when there is one.
export const toFile = async (decisions, turns, { concerns, links = {}, sessionId, cwd, root }) => {
	const groups = new Map();

	for (const decision of decisions) {
		if (decision.kind === 'deferred' || placed[decision.id]?.place !== null || failedAt.has(`file:${decision.id}`))
			continue;

		const at = turns.findIndex(turn => turn.id === decision.turnId);
		const linked = [...new Set(turns.slice(at, at + 2).flatMap(turn => links[turnNote(sessionId, turn.id)] ?? []))];
		let target = await targetFor(root, {
			files: changedFiles(turns, decision.turnId, { cwd, root }),
			linked: at === -1 ? [] : linked,
			concerns,
			at: decision.at,
		});
		const explaining = target?.commit && concerns.find(open => explainedHash(open.body) === target.commit.hash);

		if (explaining) target = { concern: explaining };

		const into = target?.concern?.hash ?? target?.commit?.hash;
		const offered = filing[decision.id];

		// Answered, but there's nowhere left to file it
		if (!into && offered?.answered) filing[decision.id] = { ...offered, answered: false };
		if (!into || (offered?.into === into && !offered.answered)) continue;
		groups.set(into, [target, [...(groups.get(into)?.[1] ?? []), { ...decision, ...offered }]]);
	}

	return [...groups.values()];
};

const fileAll = async (root, groups, options) => {
	const all = groups.flatMap(([, decisions]) => decisions);

	filingIn.add(root);
	for (const decision of all) filingNow.add(decision.id);
	try {
		for (const [target, decisions] of groups) {
			let outcomes;

			try {
				outcomes = target.concern
					? await fileInto(root, target.concern, decisions, options)
					: await explainInto(root, target.commit, decisions, { ask: options?.ask, file: options?.explain });
			} catch {
				// No answer, or the stack moved under it: tried again later, against the stack as it is then
				for (const decision of all) failedAt.set(`file:${decision.id}`, Date.now());
				break;
			}
			decisions.forEach((decision, index) => {
				const { into, place, question } = outcomes[index];

				if (place) placed[decision.id] = { place, filed: true };
				filing[decision.id] = question
					? { into, question, waiting: true }
					: { into, question: decision.question, answer: decision.answer };
			});
			await Promise.all([writeJsonFile(placesFile, () => placed), writeJsonFile(filingFile, () => filing)]);
		}
	} finally {
		filingIn.delete(root);
		for (const decision of all) filingNow.delete(decision.id);
	}
};

// { [session id]: the follow under way }
const following = new Map();
// Sessions whose Claude waits on its push, in the order they came: { [session id]: its place }. Its own filing may run
// mid-turn, as nothing it does can race it; anyone else's waits, as the push may go to their repository.
const pushing = new Map();
let pushesWaited = 0;
// The pushes running now, any session's, by the call running each: { [call id]: session id }. Filing waits them out,
// since where one goes (git -C "$repo" push, in a loop) can't be told from its command, and a commit filed meanwhile
// would leave with it unsettled.
const pushesUnderWay = new Map();

export const pushStarted = (sessionId, callId) => pushesUnderWay.set(callId ?? sessionId, sessionId);
// Its call done, or the session's turn over: a push it ran then is over too
export const pushEnded = (sessionId, callId) => {
	if (callId) pushesUnderWay.delete(callId);
	else for (const [call, session] of pushesUnderWay) if (session === sessionId) pushesUnderWay.delete(call);
};

// Without anyone opening the panel: what the session settled is read, looked for and filed as it goes, from when the
// person's next prompt settles the turn before it until nothing is under way. Filing still waits for the turn to end.
// A few rounds whatever happens, as a prompt reaches the transcript a moment after its hook.
export const followDecisions = (id, cwd, { every = FOLLOW_MS, settling = SETTLING_ROUNDS, whole = false } = {}) => {
	if (!placesFile) return Promise.resolve();
	if (following.has(id)) return following.get(id);

	// Whether it settled: nothing left reading, looking or filing
	const follow = (async () => {
		for (let round = 0; round < FOLLOW_ROUNDS; round += 1) {
			const { reading, held, decisions } = await sessionDecisions(id, cwd, { whole });

			if (round >= settling && !reading && !held && !decisions.some(decision => decision.looking || decision.filing))
				return true;
			await Bun.sleep(every);
		}

		return false;
	})().finally(() => following.delete(id));

	following.set(id, follow);

	return follow;
};

// The session's Claude waiting on its push for as long as wait runs
export const waitingToPush = async (id, wait) => {
	pushing.set(id, (pushesWaited += 1));
	try {
		return await wait();
	} finally {
		pushing.delete(id);
	}
};

// Before Claude pushes from the session's folder: what the session settled is filed first, with Claude waiting on
// it, so a push never leaves without it. Whether anything was filed: then the stack holds amend! commits to settle
// before the push, which would otherwise carry them unfolded.
export const fileBeforePush = async (id, cwd) => {
	const root = await repoRoot(cwd);

	if (!root || !placesFile) return false;

	const before = await headCommit(root);

	await waitingToPush(id, async () => {
		// One under way since the prompt ran without filing; this one files
		await following.get(id);
		await followDecisions(id, cwd, { every: PUSH_POLL_MS, settling: 0 });
	});

	return (await headCommit(root)) !== before;
};

// The person's answer to what filing one asked them: it's offered to its concern again, with the answer
export const answerDecision = async (decisionId, answer) => {
	if (!filing[decisionId]?.waiting) return false;
	filing = { ...filing, [decisionId]: { ...filing[decisionId], answer, waiting: false, answered: true } };
	await writeJsonFile(filingFile, () => filing);

	return true;
};

// Another session working in the repository: its commits would race a filing, unless it's this one's Claude waiting
// on its push. Any push under way, wherever it goes, or waiting before this session's own: one waiting since after
// waits on this one instead, so two pushing at once don't hold each other.
export const othersWorkIn = (root, sessionId) =>
	pushesUnderWay.size > 0 ||
	[...pushing].some(([other, place]) => other !== sessionId && place < (pushing.get(sessionId) ?? Infinity)) ||
	(!pushing.has(sessionId) &&
		[...allRunning()].some(
			session =>
				session.id !== sessionId &&
				(session.cwd === root || session.cwd?.startsWith(`${root}${path.sep}`)) &&
				statusOf(session.id) === 'working',
		));

// Whether it was held back for another session at work, to file once that one stops
const backfill = async (sessionId, decisions, turns, cwd) => {
	if (!decisions.some(decision => decision.kind !== 'deferred' && placed[decision.id]?.place === null)) return false;

	const root = await repoRoot(cwd);

	if (!root || filingIn.has(root)) return false;
	if (othersWorkIn(root, sessionId)) return true;
	for (const [key, at] of failedAt) if (key.startsWith('file:') && Date.now() - at > RETRY_MS) failedAt.delete(key);

	const [concerns, links] = await Promise.all([openConcerns(root), linkedCommits(root)]);
	const groups = await toFile(decisions, turns, { concerns, links, sessionId, cwd, root });

	// Started, not waited on: those being filed say so from now on, and the panel keeps reading until they're done
	if (groups.length && !filingIn.has(root)) fileAll(root, groups).catch(() => {});

	return false;
};

// The session's turns worth reading, each with what the person said next (which settles what Claude proposed): not a
// cut-short marker or a keep-warm ping, and the latest only once the session has stopped, when nothing more will
// answer it
export const turnsToRead = (turns, { running }) => {
	const told = markInterruptions(turns).filter(turn => !turn.interrupted && !KEEP_WARM_PING.test(turn.prompt));
	const read = told.map((turn, index) => ({
		...turn,
		reply: told[index + 1]?.summary ? undefined : told[index + 1]?.asked?.slice(0, REPLY),
	}));

	return running ? read.slice(0, -1) : read;
};

// What the session settled, newest first: [{ id, turnId, at, asked, kind, chose, rejected, because, place, looking,
// dismissed }], whether Haiku is still reading turns or looking for places, and whether filing waits on another session
export const sessionDecisions = async (id, cwd, { withDismissed = false, whole = false } = {}) => {
	const turns = turnsToRead(await sessionTurns(id, cwd, { whole }), {
		running: Boolean(runningSession(id)) || statusOf(id) === 'working',
	});

	if (placesFile) found.describe(turns);

	const decisions = turns.flatMap(turn =>
		(found.descriptionOf(keyOf(turn)) ?? []).map((decision, index) => ({
			id: `${keyOf(turn)}:${index}`,
			turnId: turn.id,
			at: turn.at,
			asked: turn.prompt,
			...decision,
		})),
	);
	const set = new Set(dismissed[id] ?? []);
	const open = decisions.filter(decision => !set.has(decision.id));
	let held = false;

	if (open.length && placesFile) {
		// Without a since, no commits: only the fingerprint is wanted here
		const { fingerprint } = await placesFor(cwd);
		const unplaced = toLookFor(open, fingerprint);

		if (unplaced.length)
			lookFor(unplaced, async (since, batch) => {
				const root = await repoRoot(cwd);
				const near = root ? batch.flatMap(decision => changedFiles(turns, decision.turnId, { cwd, root })) : [];

				return placesFor(cwd, since, { near });
			});
		// Not mid-turn: Claude's own commits move HEAD, and a filing would race them
		else if (pushing.has(id) || !['working', 'waiting'].includes(statusOf(id)))
			held = await backfill(id, open, turns, cwd).catch(() => false);
	}

	return {
		reading: turns.some(turn => found.describingOf(keyOf(turn))),
		held,
		decisions: decisions
			.map(decision => ({
				...decision,
				place: placed[decision.id]?.place ?? null,
				overrules: placed[decision.id]?.overrules ?? null,
				belongs: placed[decision.id]?.belongs ?? null,
				looking: looking.has(decision.id),
				filed: Boolean(placed[decision.id]?.filed),
				// Being filed, or answered and about to be
				filing: filingNow.has(decision.id) || Boolean(filing[decision.id]?.answered),
				question: filing[decision.id]?.waiting ? filing[decision.id].question : null,
				dismissed: set.has(decision.id),
			}))
			.filter(decision => withDismissed || !decision.dismissed)
			.reverse(),
	};
};

export const dismissDecision = async (sessionId, decisionId, dismiss = true) => {
	const now = new Set(dismissed[sessionId] ?? []);

	if (dismiss) now.add(decisionId);
	else now.delete(decisionId);
	dismissed = { ...dismissed, [sessionId]: [...now] };
	await writeJsonFile(marksFile, () => dismissed);
};

// What the session's Claude is asked, to write one down where it belongs
export const writeDownPrompt = decision =>
	[
		decision.overrules &&
			`This was settled earlier in the session, and it overrules a claim the design document ${decision.overrules.file} still makes: "${decision.overrules.claim}". Change that claim (and its perspectives) to what was settled, and commit the document with why the design moved. If the claim should hold after all, leave it and say why.`,
		decision.belongs &&
			`This was settled earlier in the session, and it is design intent for what the design document ${decision.belongs} describes, which doesn't claim it yet. Add it there as a claim in the document's own style, with a perspective that checks it and what was rejected where a naive implementer would choose that, and commit the document with why. If it isn't design intent after all, write it into the message of the commit it shaped instead, and say so.`,
		!decision.overrules &&
			!decision.belongs &&
			"This was settled earlier in the session and is not written down anywhere yet. Write it down where it belongs, then say where: in the message of the commit it shaped (folded in with amend! while that commit is unpushed), in CLAUDE.md if it is a standing direction, in the slice's .lld.md if it is design intent, or nowhere if it no longer holds (say why).",
		`${{ decision: 'Decided', direction: 'Direction', deferred: 'Put off' }[decision.kind]}: ${decision.chose}`,
		decision.rejected && `Rejected: ${decision.rejected}`,
		decision.because && `Because: ${decision.because}`,
	]
		.filter(Boolean)
		.join('\n');

export { fileAll, lookFor as lookForPlaces, toLookFor };
