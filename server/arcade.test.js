import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { launchSettings } from './arcadeSettings';
import {
	READING,
	adoptArcade,
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

	test('moves a game whose server hot-swaps its code onto one that starts over on each save, and leaves other dev scripts be', async () => {
		const dev = script => JSON.stringify({ scripts: { dev: script } }, null, '\t');

		await writeFile(join(game, 'package.json'), dev('NODE_ENV=development bun --hot server.js'));
		await refreshArcade(game);
		expect(await readFile(join(game, 'package.json'), 'utf8')).toBe(dev('NODE_ENV=development bun --watch server.js'));

		await writeFile(join(game, 'package.json'), dev('vite --port 5000'));
		await refreshArcade(game);
		expect(await readFile(join(game, 'package.json'), 'utf8')).toBe(dev('vite --port 5000'));
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
		expect(text).toContain('harden it');
		expect(text).toContain('`IDEA.md`');
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

	test('names who it is for and how they read, and says nothing of age', () => {
		const text = arcadeInstructions({ title: 'Moon Rocks', player: 'Ada', reading: 'listening' });

		expect(text).toContain('# Building Moon Rocks together');
		expect(text).toContain('with Ada.');
		expect(text).toContain('by ear');
		expect(text).toContain('AskUserQuestion');
		expect(text).toContain('Do not offer "show me"');
		expect(text).toContain('never ask anyone to restart anything');
		expect(text).toContain('find another way to do it within the project and carry on');
		for (const reading of Object.keys(READING))
			expect(arcadeInstructions({ title: 'X', player: '', reading })).not.toMatch(
				/\b(kid|child|grown-up|parent|young)/i,
			);
	});

	test('with a voice that performs, Claude acts through the cues it takes, in the one voice every game shares', () => {
		const plain = arcadeInstructions({ title: 'X', player: 'Ada', reading: 'reading' });
		const voiced = arcadeInstructions({ title: 'X', player: 'Ada', reading: 'reading', performs: true });

		expect(plain).not.toContain('## Your voice');
		expect(voiced).toContain('## Your voice');
		expect(voiced).toContain('[laughs]');
		expect(voiced).toContain('the same one in every game');
		expect(voiced).not.toContain('"character"');
	});

	test('with an ElevenLabs key, Claude can have paude make real sounds for the game', () => {
		const text = arcadeInstructions({ title: 'X', player: 'Ada', reading: 'reading', sounds: true });

		expect(text).toContain('## Sounds for the game');
		expect(text).toContain('"$PAUDE_SOUNDS"');
		expect(text).toContain("import coin from './sounds/coin.mp3'");
		expect(arcadeInstructions({ title: 'X', player: 'Ada', reading: 'reading' })).not.toContain('PAUDE_SOUNDS');
	});

	test("keeps the game's face, its README's opening and manifest, saying what the game is", () => {
		const text = arcadeInstructions({ title: 'Moon Rocks', player: 'Ada', reading: 'reading' });

		expect(text).toContain("## The game's face");
		expect(text).toContain('first paragraph of `README.md`');
		expect(text).toContain('"description" in `client/manifest.json`');
		expect(arcadeInstructions({ title: 'x', named: false, player: '', reading: 'reading' })).toContain(
			'"name" and "short_name" in `client/manifest.json`',
		);
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
		expect(openingPrompt({ title: 'Moon Rocks' })).toContain('the person you are building with');
	});

	test('carries the idea in their words, to be hardened and built first, and asks for a name when the game has none', () => {
		const withIdea = openingPrompt({ title: 'Moon Rocks', player: 'Ada', idea: 'rocks fall\n\nyou dodge them' });

		expect(withIdea).toContain(
			'The game is called "Moon Rocks". Their idea, in their words:\n\nrocks fall\n\nyou dodge them\n\nThat is the brief: harden it',
		);
		expect(withIdea).toContain('build what it describes before asking');
		expect(withIdea).not.toContain('Offer a few names');

		const unnamed = openingPrompt({ title: 'rocks fall', named: false, player: 'Ada', idea: 'rocks fall' });

		expect(unnamed).toContain('The game has no name yet.');
		expect(unnamed).toContain('Offer a few names once what they described is built.');
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
	test('lets Claude work and check the game without asking, and refuses what reaches past it', () => {
		expect(claudeSettings.permissions.defaultMode).toBe('auto');
		expect(claudeSettings.permissions.allow).toEqual(
			expect.arrayContaining(['Read', 'Edit', 'Bash(bun *)', 'Bash(curl *)', 'WebFetch']),
		);
		expect(claudeSettings.permissions.allow).not.toContainEqual(expect.stringMatching(/^Bash\(\*|Bash\(rm|Bash\(sudo/));
		expect(claudeSettings.permissions.deny).toEqual(expect.arrayContaining(['Bash(git push*)', 'Bash(sudo *)']));
	});

	test("turns back any permission prompt at once, but lets Claude's questions to the person through", () => {
		const [{ matcher, hooks }] = claudeSettings.hooks.PermissionRequest;
		const answer = JSON.parse(Bun.spawnSync(['sh', '-c', hooks[0].command]).stdout.toString());

		expect(answer.hookSpecificOutput).toMatchObject({
			hookEventName: 'PermissionRequest',
			decision: { behavior: 'deny' },
		});
		for (const tool of ['Bash', 'Write', 'WebFetch', 'mcp__x__y']) expect(new RegExp(matcher).test(tool)).toBe(true);
		for (const tool of ['AskUserQuestion', 'ExitPlanMode']) expect(new RegExp(matcher).test(tool)).toBe(false);
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

describe('adoptArcade', () => {
	let repo;

	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), 'adopt-'));
		sh(repo, 'git init -q && mkdir .claude');
		await writeFile(
			join(repo, 'package.json'),
			JSON.stringify({ name: 'void-driller', scripts: { dev: 'bun --watch x.js' } }),
		);
		await writeFile(join(repo, '.claude', 'settings.json'), '{"theirs":true}');
		await writeFile(join(repo, 'CLAUDE.local.md'), 'Our own notes.\n');
	});
	afterEach(() => rm(repo, { recursive: true, force: true }));

	test("brings a project in without touching what's its own, and keeps paude's files out of its git status", async () => {
		const marker = await adoptArcade(repo, { player: 'chase', reading: 'reading' });

		expect(marker).toMatchObject({ title: 'void-driller', player: 'chase', adopted: true });
		expect(await readFile(join(repo, '.claude', 'settings.json'), 'utf8')).toBe('{"theirs":true}');
		expect(await readFile(join(repo, 'CLAUDE.local.md'), 'utf8')).toBe('@./.paude-arcade.md\n\nOur own notes.\n');
		expect(await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain(
			'/.paude-arcade.json\n/.paude-arcade.md\n/CLAUDE.local.md\n',
		);
		expect(sh(repo, 'git status --porcelain')).not.toContain('paude');
		expect(sh(repo, 'git status --porcelain')).not.toContain('CLAUDE.local.md');

		const rules = await readFile(join(repo, '.paude-arcade.md'), 'utf8');

		expect(rules).toContain('# Working on void-driller together');
		expect(rules).toContain('## It is already running');
		expect(rules).not.toContain('Game.js');
		expect(rules).not.toContain("## The game's face");
	});

	test('a project already in the arcade is left as it is, and how Claude writes must be known', async () => {
		await adoptArcade(repo, { player: 'chase', reading: 'reading' });
		await adoptArcade(repo, { player: 'someone else', reading: 'listening' });

		expect(JSON.parse(await readFile(join(repo, '.paude-arcade.json'), 'utf8')).player).toBe('chase');
		await expect(adoptArcade(await mkdtemp(join(tmpdir(), 'adopt-')), { reading: 'nope' })).rejects.toThrow('Pick how');
	});

	test("its arcade permissions come with paude's launch of Claude, and only for an adopted project", async () => {
		expect(launchSettings(repo)).toBeNull();
		await adoptArcade(repo, { player: 'chase', reading: 'reading' });
		expect(launchSettings(repo)).toBe(claudeSettings);
	});
});
