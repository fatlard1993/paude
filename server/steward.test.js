import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import { commitOwned } from './arcade';
import { STEWARD_QUIET_MS, checkWarm, keepWarm, noteMonitor, stewardWith, stopKeepingWarm } from './keepWarm';
import { OWNED, OWNERSHIP_NOTE, ownedPaths, stewardNote, stewardPass } from './steward';

let game;
const sh = (cwd, command) => Bun.spawnSync(['sh', '-c', command], { cwd }).stdout.toString().trim();

beforeAll(async () => {
	game = await mkdtemp(join(tmpdir(), 'steward-'));
	await writeFile(join(game, 'README.md'), '# Game\n');
	await writeFile(join(game, 'Game.js'), 'export default 1;\n');
	await writeFile(join(game, '.paude-arcade.json'), JSON.stringify({ title: 'Game', reading: 'reading' }));
	sh(game, 'git init -q && git add -A && git -c user.name=t -c user.email=t@x commit -qm start');
});

afterAll(() => rm(game, { recursive: true, force: true }));

test('the building Claude is told once that the steward keeps its files, and hears what it found when it has', async () => {
	expect(stewardNote('plain')).toBeNull();
	await keepWarm('steward-told', 24, Date.now(), { fabled: true });
	expect(stewardNote('steward-told')).toBe(OWNERSHIP_NOTE);
	expect(stewardNote('steward-told')).toBeNull();
	await stopKeepingWarm('steward-told');
});

test('its files are the paths it may edit, folders whole', () => {
	expect(ownedPaths('/g')).toEqual(['/g/README.md', '/g/IDEA.md', '/g/docs/**']);
});

test('only its own files are committed, whatever else is half done beside them', async () => {
	await writeFile(join(game, 'README.md'), '# Game\n\nA game.\n');
	await writeFile(join(game, 'Game.js'), 'export default 2;\n');

	expect(await commitOwned(game, OWNED, 'steward: the README says what the game is')).toBe(true);
	expect(sh(game, 'git log -1 --format=%s')).toBe('steward: the README says what the game is');
	expect(sh(game, 'git status --porcelain')).toBe('M Game.js');
	expect(await commitOwned(game, OWNED, 'steward: nothing')).toBe(false);
	sh(game, 'git checkout -q Game.js');
});

test("a quiet fabled arcade's steward takes a turn with its writes scoped, and leaves its findings for the building Claude", async () => {
	const session = { cwd: game, busy: false };
	const asks = [];
	const askMonitor = async (monitor, cwd, prompt, options) => {
		asks.push({ monitor, options });

		return {
			answer: JSON.stringify({ changed: '', forClaude: 'The start screen never says it waits for a second player.' }),
			delivered: true,
			usage: { turns: 3, cacheRead: 0, cacheWrite: 0, input: 0, output: 0, cost: 0.1, ms: 1000 },
		};
	};

	await keepWarm('steward-quiet', 24, Date.now(), { fabled: true });
	await noteMonitor('steward-quiet', { monitor: '11111111-1111-4111-8111-111111111111', seen: 't1' });
	stewardNote('steward-quiet');

	const verdict = await stewardPass('steward-quiet', session, {
		askMonitor,
		commit: async () => false,
		repoOf: async () => '',
		homeOf: () => game,
	});

	expect(verdict.forClaude).toContain('second player');
	expect(asks[0].options.writes.paths).toEqual(ownedPaths(game));
	expect(asks[0].options.writes.commands[0]).toBe(`bun --cwd ${game} test`);
	expect(stewardNote('steward-quiet')).toContain('The start screen never says it waits');
	await stopKeepingWarm('steward-quiet');
});

test('keep-warm gives a fabled session its steward once it has gone quiet, and not again until something happens', async () => {
	const given = [];

	stewardWith(async id => given.push(id));
	await keepWarm('steward-stilled', 24, 0, { fabled: true });

	const sessionOf = id =>
		id === 'steward-stilled' ? { busy: false, promptDraft: () => null, typeIn: () => {} } : undefined;

	// Its quiet counted from the first look
	await checkWarm(sessionOf, 0);
	await checkWarm(sessionOf, STEWARD_QUIET_MS - 1);
	expect(given).toEqual([]);
	await checkWarm(sessionOf, STEWARD_QUIET_MS);
	await checkWarm(sessionOf, STEWARD_QUIET_MS * 2);
	expect(given).toEqual(['steward-stilled']);
	stewardWith(null);
	await stopKeepingWarm('steward-stilled');
});
