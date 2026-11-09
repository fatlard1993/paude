import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
	READING,
	acceptTrust,
	arcadeInstructions,
	arcadeOf,
	claudeSettings,
	folderName,
	openingPrompt,
	refreshArcade,
	snapshotTurn,
	turnName,
	undoLastTurn,
	workingTitle,
} from './arcade';

describe('turnName', () => {
	test('is the last answer or prompt given, on one line, or "a change"', () => {
		expect(turnName([])).toBe('a change');
		expect(
			turnName([
				{ kind: 'prompt', text: 'make a frog' },
				{ kind: 'text', text: 'done' },
				{ kind: 'answer', text: ' 🐸 A frog\nthat jumps ' },
				{ kind: 'tool', name: 'Edit' },
			]),
		).toBe('🐸 A frog that jumps');
		expect(turnName([{ kind: 'answer', text: 'x'.repeat(100) }]).length).toBe(72);
	});
});

describe('refreshArcade', () => {
	let game;

	beforeEach(async () => {
		game = await mkdtemp(join(tmpdir(), 'refresh-'));
		await writeFile(
			join(game, '.paude-arcade.json'),
			JSON.stringify({ title: 'Moon Rocks', player: 'Ada', reading: 'listening', idea: 'rocks fall' }),
		);
	});
	afterEach(() => rm(game, { recursive: true, force: true }));

	test("writes Claude's rules and permissions from the marker, and a CLAUDE.local.md that imports the rules", async () => {
		expect(await refreshArcade(game)).toBe(true);

		const rules = await readFile(join(game, '.paude-arcade.md'), 'utf8');

		expect(rules).toContain('# Building Moon Rocks together');
		expect(rules).toContain('rocks fall');
		expect(JSON.parse(await readFile(join(game, '.claude', 'settings.json'), 'utf8'))).toEqual(claudeSettings);
		expect(await readFile(join(game, 'CLAUDE.local.md'), 'utf8')).toMatch(/^@\.\/\.paude-arcade\.md\n/);
	});

	test("replaces a CLAUDE.local.md paude wrote whole, keeps a person's own words under the import, and leaves one that imports already", async () => {
		await writeFile(join(game, 'CLAUDE.local.md'), '# Building Old together\n\nold rules\n');
		await refreshArcade(game);
		expect(await readFile(join(game, 'CLAUDE.local.md'), 'utf8')).not.toContain('old rules');

		await writeFile(join(game, 'CLAUDE.local.md'), 'Ada likes purple.\n');
		await refreshArcade(game);
		expect(await readFile(join(game, 'CLAUDE.local.md'), 'utf8')).toBe('@./.paude-arcade.md\n\nAda likes purple.\n');

		await refreshArcade(game);
		expect(await readFile(join(game, 'CLAUDE.local.md'), 'utf8')).toBe('@./.paude-arcade.md\n\nAda likes purple.\n');
	});

	test('a game past its first commit, with no idea recorded, is told it is under way rather than to brainstorm', async () => {
		await writeFile(
			join(game, '.paude-arcade.json'),
			JSON.stringify({ title: 'Old', player: 'Ada', reading: 'reading' }),
		);
		await refreshArcade(game);
		expect(await readFile(join(game, '.paude-arcade.md'), 'utf8')).toContain('## Finding the idea first');

		const sh = command => Bun.spawnSync(['sh', '-c', command], { cwd: game });

		sh(
			'git init -q && git -c user.name=t -c user.email=t@x commit -q --allow-empty -m scaffold && git -c user.name=t -c user.email=t@x commit -q --allow-empty -m "turn: a frog"',
		);
		await refreshArcade(game);

		const rules = await readFile(join(game, '.paude-arcade.md'), 'utf8');

		expect(rules).toContain('## Already under way');
		expect(rules).not.toContain('Finding the idea first');
	});

	test('an ordinary folder is left alone', async () => {
		const plain = await mkdtemp(join(tmpdir(), 'plain-'));

		expect(await refreshArcade(plain)).toBe(false);
		await rm(plain, { recursive: true, force: true });
	});
});

describe('workingTitle', () => {
	test("is the name, or the idea's first words while there is none, or nothing much", () => {
		expect(workingTitle({ name: ' Moon Rocks ', idea: 'a frog jumps' })).toBe('Moon Rocks');
		expect(workingTitle({ name: '', idea: 'A frog that jumps over logs, and eats flies.' })).toBe('A frog that jumps');
		expect(workingTitle({ name: '', idea: 'Frogs!' })).toBe('Frogs');
		expect(workingTitle({})).toBe('New game');
	});
});

describe('folderName', () => {
	test('is the title as a folder and package name', () => {
		expect(folderName("Ada's Moon Rocks!")).toBe('adas-moon-rocks');
		expect(folderName('   ')).toBe('game');
		expect(folderName('x'.repeat(80)).length).toBeLessThanOrEqual(40);
	});
});

describe('arcadeInstructions', () => {
	test('keeps the idea they started with, and says how to name a game that has no name', () => {
		const text = arcadeInstructions({
			title: 'rocks fall',
			named: false,
			idea: 'rocks fall\nyou dodge',
			player: 'Ada',
			reading: 'reading',
		});

		expect(text).toContain('# Building a game together');
		expect(text).toContain('## The idea they started with\n\nrocks fall\nyou dodge\n');
		expect(text).toContain('## It has no name yet');
		expect(text).toContain('.paude-arcade.json');

		const named = arcadeInstructions({ title: 'Moon Rocks', player: 'Ada', reading: 'reading' });

		expect(named).toContain('# Building Moon Rocks together');
		expect(named).not.toContain('idea they started with');
		expect(named).not.toContain('no name yet');
		// Without an idea, the brainstorm: what they love, what they want to do, three ideas, then a name, kept in the marker
		expect(named).toContain('## Finding the idea first');
		expect(named).toContain('"idea" in `.paude-arcade.json`');
		expect(text).not.toContain('Finding the idea first');
	});

	test('names who it is for and how they read', () => {
		const text = arcadeInstructions({ title: 'Moon Rocks', player: 'Ada', reading: 'listening' });

		expect(text).toContain('# Building Moon Rocks together');
		expect(text).toContain('with Ada,');
		expect(text).toContain('cannot read yet');
		expect(text).toContain('AskUserQuestion');
		expect(text).toContain('Do not offer "show me"');
		expect(text).toContain('never through shell commands');
		expect(text).toContain('Never start, stop or restart it');
	});

	test('has a voice for every reading level', () => {
		for (const reading of Object.keys(READING))
			expect(arcadeInstructions({ title: 'X', player: '', reading })).toContain('## How to write');
	});
});

describe('openingPrompt', () => {
	test('asks Claude to open the conversation about the named game', () => {
		expect(openingPrompt({ title: 'Moon Rocks', player: 'Ada' })).toBe(
			'Say hello to Ada. The game is called "Moon Rocks". There is no idea yet: find one together as your rules say, starting by asking what they love, with a few picture choices.',
		);
		expect(openingPrompt({ title: 'Moon Rocks' })).toContain('the kid you are building with');
	});

	test('carries the idea so far on one line, and asks for a name when the game has none', () => {
		const withIdea = openingPrompt({ title: 'Moon Rocks', player: 'Ada', idea: 'rocks fall\n\nyou dodge them' });

		expect(withIdea).toContain(
			'The game is called "Moon Rocks". Their idea so far: rocks fall you dodge them Start on it',
		);
		expect(withIdea).not.toContain('Offer a few names');

		const unnamed = openingPrompt({ title: 'rocks fall', named: false, player: 'Ada', idea: 'rocks fall' });

		expect(unnamed).toContain('The game has no name yet.');
		expect(unnamed).toContain('Offer a few names once the idea is clear.');
		expect(openingPrompt({ title: 'New game', named: false })).toContain(
			'Find a name together once the idea is clear.',
		);
	});
});

const screenOf = lines => ({
	ended: false,
	typed: [],
	lines,
	mirror: {
		buffer: {
			active: {
				get length() {
					return lines.length;
				},
				getLine: y => ({ translateToString: () => lines[y] }),
			},
		},
	},
	typeIn(data) {
		this.typed.push(data);
	},
});

const TRUST = [
	'Quick safety check: Is this a project you created or one you trust?',
	'❯ No, exit',
	'  Yes, I trust this folder',
	'Enter to confirm · Esc to cancel',
];

describe('acceptTrust', () => {
	test('presses Down until the cursor is on Yes, then Enter', async () => {
		const session = screenOf([...TRUST]);

		// The dialog takes the press on the next look, as the real one does
		session.typeIn = data => {
			session.typed.push(data);
			if (data === '\x1b[B') session.lines.splice(1, 2, '  No, exit', '❯ Yes, I trust this folder');
		};
		expect(await acceptTrust(session, { waitMs: 1000, pollMs: 10 })).toBe(true);
		expect(session.typed).toEqual(['\x1b[B', '\r']);
	});

	test('never presses Enter while the cursor sits on No', async () => {
		const session = screenOf([...TRUST]);

		expect(await acceptTrust(session, { waitMs: 300, pollMs: 10 })).toBe(false);
		expect(session.typed).not.toContain('\r');
		expect(session.typed.length).toBeLessThanOrEqual(6);
	});

	test('types nothing into a session that never asks', async () => {
		const session = screenOf(['❯ ', '  ⏵⏵ accept edits on']);

		expect(await acceptTrust(session, { waitMs: 50, pollMs: 10 })).toBe(false);
		expect(session.typed).toEqual([]);
	});
});

describe('claudeSettings', () => {
	test('lets Claude read, edit and check the game without asking, and refuses what reaches out or destroys', () => {
		expect(claudeSettings.permissions.defaultMode).toBe('auto');
		expect(claudeSettings.permissions.allow).toEqual(expect.arrayContaining(['Read', 'Edit', 'Bash(bun run *)']));
		expect(claudeSettings.permissions.allow).not.toContainEqual(expect.stringMatching(/^Bash\(\*|Bash\(rm|push/));
		expect(claudeSettings.permissions.deny).toEqual(expect.arrayContaining(['Bash(git push*)', 'Bash(sudo *)']));
	});
});

const sh = (cwd, command) => Bun.spawnSync(['sh', '-c', command], { cwd }).stdout.toString().trim();

describe('snapshotTurn and undoLastTurn', () => {
	let game;

	beforeEach(async () => {
		game = await mkdtemp(join(tmpdir(), 'arcade-game-'));
		await writeFile(
			join(game, '.paude-arcade.json'),
			JSON.stringify({ title: 'Moon', player: 'Ada', reading: 'learning' }),
		);
		await writeFile(join(game, 'Game.js'), 'export default 1;\n');
		sh(
			game,
			'git init -q && git -c user.name=t -c user.email=t@x commit -q --allow-empty -m start && git add -A && git -c user.name=t -c user.email=t@x commit -q -m scaffold',
		);
	});
	afterEach(() => rm(game, { recursive: true, force: true }));

	test('an ordinary folder is no arcade and gets no snapshot', async () => {
		const plain = await mkdtemp(join(tmpdir(), 'plain-'));

		expect(await arcadeOf(plain)).toBeNull();
		expect(await snapshotTurn('s1', plain)).toBeNull();
		await rm(plain, { recursive: true, force: true });
	});

	test("a turn's changes become one snapshot, and putting it back reverts it as a new commit", async () => {
		expect((await arcadeOf(game)).player).toBe('Ada');
		expect(await snapshotTurn('s1', game)).toBeNull();

		await writeFile(join(game, 'Game.js'), 'export default 2;\n');
		expect(await snapshotTurn('s1', game)).toBe('turn: a change');
		expect(sh(game, 'git log --format=%s -1')).toBe('turn: a change');
		expect(sh(game, 'git status --porcelain')).toBe('');

		expect(await undoLastTurn('s1', game)).toEqual({ undone: 'a change' });
		expect(sh(game, 'cat Game.js')).toBe('export default 1;');
		expect(sh(game, 'git log --format=%s -1')).toMatch(/^Revert "turn: a change"/);
	});

	test('nothing to put back when the newest commit is not a snapshot', async () => {
		await expect(undoLastTurn('s1', game)).rejects.toThrow('nothing');
	});
});
