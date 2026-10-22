import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import {
	findPrompt,
	initDecisions,
	lookForPlaces,
	parseFound,
	parsePlaces,
	placesFor,
	toLookFor,
	turnsToRead,
	turnText,
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

test('a place is only one of those given', () => {
	const names = new Set(['382a290', 'CLAUDE.md']);

	expect(parsePlaces('{"1": "382a290", "2": "somewhere.md", "3": null}', names)).toEqual({
		1: '382a290',
		2: null,
		3: null,
	});
	expect(parsePlaces('no idea', names)).toBeNull();
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

	await lookForPlaces(decisions, places, async prompt => {
		asked.push(prompt);

		return '{"1": "382a290", "2": null}';
	});
	expect(asked[0]).toContain('1. per user');
	expect(toLookFor(decisions, 'a')).toEqual([]);
	expect(toLookFor(decisions, 'b').map(decision => decision.id)).toEqual(['t2:0']);
});

test('writing one down asks for its place, and says what was rejected and why', () => {
	const prompt = writeDownPrompt({ kind: 'decision', chose: 'per user', rejected: 'per session', because: 'resets' });

	expect(prompt).toContain('Decided: per user\nRejected: per session\nBecause: resets');
	expect(prompt).toContain('amend!');
});
