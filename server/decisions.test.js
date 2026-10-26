import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import {
	designsToFile,
	fileDesigns,
	findPrompt,
	initDecisions,
	lookForPlaces,
	othersWorkIn,
	parseFound,
	parsePlaces,
	placesFor,
	rankedDocuments,
	pushEnded,
	pushStarted,
	toLookFor,
	turnsToRead,
	turnText,
	waitingToPush,
	writeDownPrompt,
} from './decisions';

let dir;
let claudeConfig;
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const git = (...args) =>
	Bun.spawnSync(['git', ...args], { cwd: dir, env })
		.stdout.toString()
		.trim();

beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), 'paude-decisions-'));
	// The person's own CLAUDE.md and skills, here rather than whoever runs the tests
	claudeConfig = process.env.CLAUDE_CONFIG_DIR;
	process.env.CLAUDE_CONFIG_DIR = path.join(dir, '.claude-home');
	await mkdir(path.join(dir, '.claude-home', 'skills', 'commits'), { recursive: true });
	await writeFile(path.join(dir, '.claude-home', 'skills', 'commits', 'SKILL.md'), 'Every commit says why.\n');
	git('init', '-q', '-b', 'main');
	git('config', 'user.name', 'Ana');
	git('config', 'user.email', 'ana@example.com');
	git('config', 'commit.gpgsign', 'false');
});

afterEach(async () => {
	if (claudeConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = claudeConfig;
	await rm(dir, { recursive: true, force: true });
});

test('a turn reads with how the person steered, what they answered and turned down, and what changed', () => {
	const text = turnText(
		{
			asked: 'lock accounts after failed logins',
			stopped: true,
			steps: [
				{ tool: 'AskUserQuestion', output: 'User has answered: per user, not per session' },
				{ tool: 'Bash', summary: 'drop the sessions table', declined: true },
				{ tool: 'Edit', edits: true, file: 'auth.js' },
			],
			said: 'Locked per user after five tries.',
		},
		0,
	);

	expect(text).toContain('Asked: lock accounts after failed logins');
	expect(text).toContain('The person stopped partway');
	expect(text).toContain('Answered: User has answered: per user, not per session');
	expect(text).toContain('Turned down: Bash drop the sessions table');
	expect(text).toContain('Changed: auth.js');
	expect(turnText({ asked: 'lock', added: ['per user'], steps: [] }, 0)).toContain(
		'The person added while Claude worked: per user',
	);
	expect(findPrompt([])).toContain('Routine edits, questions and fixes settle nothing');
});

test("a turn going on from a summary isn't read as the person's words, nor answers the turn before it", () => {
	const turns = turnsToRead(
		[
			{ id: 't1', prompt: 'lock accounts', asked: 'lock accounts', steps: [] },
			{ id: 't2', prompt: 'This session is being continued', asked: 'Earlier, we chose X', summary: true, steps: [] },
		],
		{ running: false },
	);

	expect(turns[0].reply).toBeUndefined();
	expect(turnText(turns[1], 1)).not.toContain('chose X');
	expect(turnText(turns[1], 1)).toContain("nothing here is the person's words");
});

test('what Haiku found keeps only the three kinds, each with what was chosen', () => {
	expect(
		parseFound(
			'Here: {"1": [], "2": [{"kind": "decision", "chose": " per user ", "rejected": "per session", "because": "a new session would reset it"}, {"kind": "musing", "chose": "x"}, {"kind": "direction", "chose": ""}], "3": "none"}',
		),
	).toEqual({
		1: [],
		2: [{ kind: 'decision', chose: 'per user', rejected: 'per session', because: 'a new session would reset it' }],
	});
});

test('the design documents most about what the decisions say come first, then those nearest what they changed', () => {
	const texts = {
		'api/api.lld.md': 'Requests retry twice.',
		'components/Button/Button.lld.md': 'A press is the release.',
		'components/Tooltip/Tooltip.lld.md': 'An unknown position throws.',
		'lld/component.lld.md': 'build() runs in the constructor, before the options are set.',
	};
	const documents = Object.keys(texts);

	// A base class's decision, though its turn changed a Tooltip
	expect(
		rankedDocuments(documents, {
			texts,
			near: ['components/Tooltip/Tooltip.js'],
			about: 'Leave build() in the base constructor, before subclass fields exist',
		})[0],
	).toBe('lld/component.lld.md');
	expect(rankedDocuments(documents, { texts, near: ['components/Tooltip/Tooltip.js', 'components/index.js'] })).toEqual(
		['components/Tooltip/Tooltip.lld.md', 'components/Button/Button.lld.md', 'api/api.lld.md', 'lld/component.lld.md'],
	);
	expect(rankedDocuments(documents)).toEqual(documents);
});

test('a place is only one of those given', () => {
	const names = new Set(['382a290', 'CLAUDE.md']);

	expect(parsePlaces('{"1": "382a290", "2": "somewhere.md", "3": null}', names)).toEqual({
		1: '382a290',
		2: null,
		3: null,
	});
	expect(parsePlaces('no idea', names)).toBeNull();
});

test("a design document's claim is overruled, or one belongs in it, only when it's one of those given", () => {
	const names = new Set(['382a290', 'CLAUDE.md', 'auth/auth.lld.md']);
	const reply = JSON.stringify({
		1: { overrules: 'auth/auth.lld.md', claim: ' Failed attempts are tracked per session. ' },
		2: { overrules: 'other.lld.md', claim: 'Tokens never expire.' },
		3: { overrules: 'CLAUDE.md', claim: 'Commit often.' },
		4: { overrules: 'auth/auth.lld.md', claim: '' },
		5: { belongs: 'auth/auth.lld.md' },
		6: { belongs: 'CLAUDE.md' },
	});

	expect(parsePlaces(reply, names)).toEqual({
		1: { overrules: { file: 'auth/auth.lld.md', claim: 'Failed attempts are tracked per session.' } },
		2: null,
		3: null,
		4: null,
		5: { belongs: 'auth/auth.lld.md' },
		6: null,
	});
});

test('an overruled claim is kept with the decision, and looked at again once the documents change', async () => {
	await initDecisions(dir);

	const decisions = [{ id: 't3:0', chose: 'per user', rejected: 'per session' }];
	const places = {
		fingerprint: 'a',
		names: new Set(['auth/auth.lld.md']),
		text: 'Failed attempts are tracked per session.',
	};
	const ask = async () =>
		'{"1": {"overrules": "auth/auth.lld.md", "claim": "Failed attempts are tracked per session."}}';

	await lookForPlaces(decisions, async () => places, ask);
	expect(toLookFor(decisions, 'a')).toEqual([]);
	expect(toLookFor(decisions, 'b').map(decision => decision.id)).toEqual(['t3:0']);

	const prompt = writeDownPrompt({
		kind: 'decision',
		chose: 'per user',
		overrules: { file: 'auth/auth.lld.md', claim: 'Failed attempts are tracked per session.' },
	});

	expect(prompt).toContain('overrules a claim the design document auth/auth.lld.md still makes: "Failed attempts');
	expect(prompt).not.toContain('is not written down anywhere yet');

	const adding = writeDownPrompt({ kind: 'decision', chose: 'per user', belongs: 'auth/auth.lld.md' });

	expect(adding).toContain('design intent for what the design document auth/auth.lld.md describes');
	expect(adding).toContain('with a perspective that checks it');
	expect(adding).not.toContain('is not written down anywhere yet');
});

test('the places are the commits since, the instruction files and the design documents', async () => {
	await writeFile(path.join(dir, 'old.txt'), 'old\n');
	git('add', '-A');
	git('commit', '-q', '-m', 'before', '--date', '2020-01-01T00:00:00Z');
	Bun.spawnSync(['git', 'commit', '-q', '--amend', '--no-edit', '--reset-author'], {
		cwd: dir,
		env: { ...env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' },
	});
	await writeFile(path.join(dir, 'CLAUDE.md'), 'Commits carry their reasoning.\n');
	await writeFile(path.join(dir, 'auth.lld.md'), '# Auth\n- locks per user\n');
	git('add', '-A');
	git('commit', '-q', '-m', 'lock per user', '-m', 'Chose per user over per session.');

	const places = await placesFor(dir, '2024-01-01T00:00:00Z');
	const lockCommit = git('rev-parse', '--short', 'HEAD');

	expect(places.names.has(lockCommit)).toBe(true);
	expect(places.names.has('CLAUDE.md')).toBe(true);
	expect(places.names.has('auth.lld.md')).toBe(true);
	expect(places.text).toContain('Chose per user over per session.');
	expect(places.text).not.toContain('before');
	expect(places.text).toContain('== CLAUDE.md\nCommits carry their reasoning.');
	expect(places.text).toContain('- locks per user');
	expect(places.text).toContain('Every commit says why.');
	expect(places.names.has(path.join(dir, '.claude-home', 'skills', 'commits', 'SKILL.md'))).toBe(true);

	git('commit', '-q', '--allow-empty', '-m', 'later');
	// Oldest first: what records a decision is usually made soon after it
	expect((await placesFor(dir, '2024-01-01T00:00:00Z')).text).toMatch(/per session\.[\s\S]*later/);

	const before = places.fingerprint;

	await writeFile(path.join(dir, 'CLAUDE.md'), 'Commits carry their reasoning. And more.\n');
	expect((await placesFor(dir, '2024-01-01T00:00:00Z')).fingerprint).not.toBe(before);
});

test('a place found stays found; nowhere is looked into again once the places change', async () => {
	await initDecisions(dir);

	const decisions = [
		{ id: 't1:0', chose: 'per user' },
		{ id: 't2:0', chose: 'five tries' },
	];
	const places = { fingerprint: 'a', names: new Set(['382a290']), text: 'commit 382a290\nper user' };
	const asked = [];

	await lookForPlaces(
		decisions,
		async () => places,
		async prompt => {
			asked.push(prompt);

			return '{"1": "382a290", "2": null}';
		},
	);
	expect(asked[0]).toContain('1. per user');
	expect(toLookFor(decisions, 'a')).toEqual([]);
	expect(toLookFor(decisions, 'b').map(decision => decision.id)).toEqual(['t2:0']);
});

test('each batch is looked for in the places since its earliest', async () => {
	await initDecisions(dir);

	const asked = [];

	await lookForPlaces(
		[
			{ id: 't2:0', at: '2026-10-02T00:00:00.000Z', chose: 'five tries' },
			{ id: 't1:0', at: '2026-10-01T00:00:00.000Z', chose: 'per user' },
		],
		async since => {
			asked.push(since);

			return { fingerprint: 'a', names: new Set(), text: '' };
		},
		async () => '{"1": null, "2": null}',
	);
	expect(asked).toEqual(['2026-10-01T00:00:00.000Z']);
});

test('writing one down asks for its place, and says what was rejected and why', () => {
	const prompt = writeDownPrompt({ kind: 'decision', chose: 'per user', rejected: 'per session', because: 'resets' });

	expect(prompt).toContain('Decided: per user\nRejected: per session\nBecause: resets');
	expect(prompt).toContain('amend!');
});

test("filing waits out any session's push, wherever it goes, until its call or turn is over", () => {
	expect(othersWorkIn('/repo', 'filing')).toBe(false);

	pushStarted('elsewhere', 'call');
	expect(othersWorkIn('/repo', 'filing')).toBe(true);
	pushEnded('elsewhere', 'another call');
	expect(othersWorkIn('/repo', 'filing')).toBe(true);
	pushEnded('elsewhere', 'call');
	expect(othersWorkIn('/repo', 'filing')).toBe(false);

	pushStarted('elsewhere', 'call');
	pushEnded('elsewhere');
	expect(othersWorkIn('/repo', 'filing')).toBe(false);
});

test("filing waits out another session's push waiting to go, and the first to wait isn't held by one after", async () => {
	const { promise: firstGoes, resolve: firstPushes } = Promise.withResolvers();
	const { promise: secondGoes, resolve: secondPushes } = Promise.withResolvers();
	const first = waitingToPush('first', async () => {
		expect(othersWorkIn('/repo', 'filing')).toBe(true);
		expect(othersWorkIn('/repo', 'first')).toBe(false);
		await firstGoes;
	});
	const second = waitingToPush('second', async () => {
		expect(othersWorkIn('/repo', 'first')).toBe(false);
		expect(othersWorkIn('/repo', 'second')).toBe(true);
		await secondGoes;
	});

	firstPushes();
	await first;
	expect(othersWorkIn('/repo', 'second')).toBe(false);
	expect(othersWorkIn('/repo', 'filing')).toBe(true);
	secondPushes();
	await second;
	expect(othersWorkIn('/repo', 'filing')).toBe(false);
});

test('one belonging in a design document is filed there once the code holds it; one it does not is refuted', async () => {
	await initDecisions(dir);
	await writeFile(path.join(dir, 'a.lld.md'), '# A\n- one\n');

	const decisions = [
		{ id: 't4:0', kind: 'decision', chose: 'two' },
		{ id: 't5:0', kind: 'decision', chose: 'three' },
	];
	const places = { fingerprint: 'a', names: new Set(['a.lld.md']), text: '# A\n- one' };

	await lookForPlaces(
		decisions,
		async () => places,
		async () => '{"1": {"belongs": "a.lld.md"}, "2": {"belongs": "a.lld.md"}}',
	);
	expect(designsToFile(decisions).map(decision => decision.id)).toEqual(['t4:0', 't5:0']);

	const asked = [];
	const ask = async prompt => {
		const chose = prompt.includes('Settled: two') ? 'two' : 'three';

		asked.push(chose);

		return JSON.stringify({ document: `# A\n- one\n- ${chose}\n`, message: `a: ${chose}` });
	};
	const outcome = passed => ({ passed, failed: 0, pending: 0, indirect: 0, shallow: 0 });
	const run = async (root, file, [, drafted]) => [outcome(1), outcome(drafted.includes('two') ? 2 : 1)];
	const filed = [];

	await fileDesigns(dir, designsToFile(decisions), { ask, run, file: async (...args) => filed.push(args[3]) });
	expect(asked).toEqual(['two', 'three']);
	expect(filed).toEqual(['a: two']);
	// Neither is tried again: one is in its document, the other is what the code doesn't do
	expect(designsToFile(decisions)).toEqual([]);
	expect(toLookFor(decisions, 'a')).toEqual([]);
});

test("one being looked for again isn't filed until the look settles where it goes", async () => {
	await initDecisions(dir);

	const decisions = [{ id: 't6:0', kind: 'decision', chose: 'two' }];
	const places = fingerprint => async () => ({ fingerprint, names: new Set(['a.lld.md']), text: '# A' });
	const { promise: answered, resolve: answer } = Promise.withResolvers();

	await lookForPlaces(decisions, places('a'), async () => '{"1": {"belongs": "a.lld.md"}}');
	expect(designsToFile(decisions)).toHaveLength(1);

	const lookingAgain = lookForPlaces(decisions, places('b'), () => answered);

	expect(designsToFile(decisions)).toEqual([]);
	answer('{"1": {"belongs": "a.lld.md"}}');
	await lookingAgain;
	expect(designsToFile(decisions)).toHaveLength(1);
});
