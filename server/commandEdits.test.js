import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import {
	changedBetween,
	commandEditsOf,
	commandEnded,
	commandStarting,
	forgetCommandEdits,
	initCommandEdits,
	noteChanged,
} from './commandEdits';
import { turnsOf } from './diffs';
import { blobText } from './git';
import { editedFiles, withCommandEdits } from './timeline';

let dir;
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const git = (...args) =>
	Bun.spawnSync(['git', ...args], { cwd: dir, env })
		.stdout.toString()
		.trim();
const run = async (id, toolUseId, change, now = Date.now()) => {
	await commandStarting(id, toolUseId, dir, now);
	await change();

	return commandEnded(id, toolUseId, now + 1);
};

beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), 'paude-command-edits-'));
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	await writeFile(path.join(dir, 'kept.js'), 'one\n');
	await writeFile(path.join(dir, '.gitignore'), 'build/\n');
	git('add', '.');
	git('commit', '-q', '-m', 'start');
});

afterEach(async () => {
	await forgetCommandEdits('s1');
	await forgetCommandEdits('s2');
	await rm(dir, { recursive: true, force: true });
});

test('a command that rewrites a file or makes one is an edit of each, and one that only reads is none', async () => {
	expect(await run('s1', 'read', async () => {})).toEqual([]);
	expect(
		await run('s1', 'sed', async () => {
			await writeFile(path.join(dir, 'kept.js'), 'two\n');
			await writeFile(path.join(dir, 'new.js'), 'made\n');
		}),
	).toEqual(['kept.js', 'new.js']);
});

test("files git ignores aren't the work", async () => {
	await Bun.write(path.join(dir, 'build', 'out.js'), 'built');
	expect(await run('s1', 'build', () => Bun.write(path.join(dir, 'build', 'out.js'), 'built again'))).toEqual([]);
});

test('a file already changed counts when the command changes it again, by its content', async () => {
	await writeFile(path.join(dir, 'kept.js'), 'two\n');
	expect(await run('s1', 'again', () => writeFile(path.join(dir, 'kept.js'), 'three\n'))).toEqual(['kept.js']);
	// The same bytes written again change nothing
	expect(await run('s1', 'same', () => writeFile(path.join(dir, 'kept.js'), 'three\n'))).toEqual([]);
});

test('committing changes nothing in the checkout; putting a file back does', async () => {
	await writeFile(path.join(dir, 'kept.js'), 'two\n');
	expect(await run('s1', 'commit', async () => git('commit', '-q', '-am', 'two'))).toEqual([]);

	await writeFile(path.join(dir, 'kept.js'), 'three\n');
	expect(await run('s1', 'restore', async () => git('checkout', '--', 'kept.js'))).toEqual(['kept.js']);
});

test('what it started from and what it left are kept, a file it made starting from nothing', async () => {
	await run('s1', 'both', async () => {
		await writeFile(path.join(dir, 'kept.js'), 'two\n');
		await writeFile(path.join(dir, 'new.js'), 'made\n');
	});

	const { before, after } = commandEditsOf('s1').both;

	expect(await blobText(dir, before['kept.js'])).toBe('one\n');
	expect(await blobText(dir, after['kept.js'])).toBe('two\n');
	expect(before['new.js']).toBeNull();
	expect(await blobText(dir, after['new.js'])).toBe('made\n');
});

test("a file another session changed while the command ran isn't the command's", async () => {
	const now = Date.now();

	expect(
		await run(
			's1',
			'tests',
			async () => {
				await writeFile(path.join(dir, 'kept.js'), 'theirs\n');
				noteChanged('s2', [path.join(dir, 'kept.js')], now);
			},
			now,
		),
	).toEqual([]);
});

test('outside git, nothing is looked at', async () => {
	const plain = await mkdtemp(path.join(os.tmpdir(), 'paude-plain-'));

	await commandStarting('s1', 'plain', plain);
	await writeFile(path.join(plain, 'a.txt'), 'x');
	expect(await commandEnded('s1', 'plain')).toEqual([]);
	await rm(plain, { recursive: true, force: true });
});

test('snapshots compare by state; a file gone from the list counts only while HEAD stays', () => {
	const before = {
		head: 'a',
		files: new Map([
			['x', '1'],
			['y', '2'],
		]),
	};

	expect(
		changedBetween(before, {
			head: 'a',
			files: new Map([
				['x', '1'],
				['z', '3'],
			]),
		}),
	).toEqual(['y', 'z']);
	expect(changedBetween(before, { head: 'b', files: new Map([['x', '1']]) })).toEqual([]);
});

test("the timeline marks a command's step as an edit of each file it changed", async () => {
	await run('s1', 'tool-1', () => writeFile(path.join(dir, 'kept.js'), 'two\n'));

	const [turn] = withCommandEdits(
		[
			{
				steps: [
					{ id: 'tool-1', tool: 'Bash' },
					{ id: 'tool-2', tool: 'Read' },
				],
			},
		],
		's1',
	);

	expect(turn.steps[0]).toMatchObject({ edits: true, files: ['kept.js'], file: 'kept.js' });
	expect(editedFiles(turn.steps[0])).toEqual(['kept.js']);
	expect(editedFiles(turn.steps[1])).toEqual([]);
});

test("a turn's diff starts a command's file from what it started from and ends it at what it left", async () => {
	await run('s1', 'tool-1', () => writeFile(path.join(dir, 'kept.js'), 'two\n'));

	const [turn] = turnsOf(
		[
			{ type: 'user', uuid: 't1', timestamp: 'now', message: { role: 'user', content: 'change it' } },
			{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }] } },
		],
		{ commands: commandEditsOf('s1'), cwd: dir },
	);
	const full = path.join(dir, 'kept.js');

	expect(await blobText(dir, turn.edited.get(full).blob)).toBe('one\n');
	expect(await blobText(dir, turn.left.get(full))).toBe('two\n');
});

const write = text => writeFile(path.join(dir, 'kept.js'), text);
const credit = (id, toolUseId) => commandEditsOf(id)?.[toolUseId]?.files ?? [];

test("a quick edit inside another session's long command is the edit's, whichever ends first", async () => {
	// The edit ends first
	await commandStarting('s1', 'tests', dir, 0);
	await commandStarting('s2', 'sed', dir, 10);
	await write('two\n');
	expect(await commandEnded('s2', 'sed', 20)).toEqual(['kept.js']);
	expect(await commandEnded('s1', 'tests', 100)).toEqual([]);

	// The long one ends first: the edit's, once both have
	await commandStarting('s1', 'tests-2', dir, 200);
	await commandStarting('s2', 'sed-2', dir, 210);
	await write('three\n');
	await commandEnded('s2', 'sed-2', 290);
	expect(await commandEnded('s1', 'tests-2', 300)).toEqual([]);
	expect(credit('s2', 'sed-2')).toEqual(['kept.js']);
});

test('a command credited first is weighed again when a tighter one that overlapped it ends', async () => {
	await commandStarting('s1', 'long', dir, 0);
	await commandStarting('s2', 'short', dir, 5);
	await write('two\n');
	expect(await commandEnded('s1', 'long', 10)).toEqual(['kept.js']);
	expect(await commandEnded('s2', 'short', 12)).toEqual(['kept.js']);
	expect(credit('s1', 'long')).toEqual([]);
});

test('each keeps the files only it changed, and a file both changed in their own ways', async () => {
	await commandStarting('s1', 'long', dir, 0);
	await commandStarting('s2', 'short', dir, 10);
	await writeFile(path.join(dir, 'theirs.js'), 'theirs\n');
	await write('two\n');
	await commandEnded('s2', 'short', 20);
	// The long one changes the file again after the edit, and makes one of its own
	await write('three\n');
	await writeFile(path.join(dir, 'mine.js'), 'mine\n');

	expect(await commandEnded('s1', 'long', 100)).toEqual(['kept.js', 'mine.js']);
	expect(credit('s2', 'short')).toEqual(['kept.js', 'theirs.js']);
});

test("one session's commands running side by side aren't weighed against each other", async () => {
	await commandStarting('s1', 'long', dir, 0);
	await commandStarting('s1', 'short', dir, 10);
	await write('two\n');
	await commandEnded('s1', 'short', 20);
	expect(await commandEnded('s1', 'long', 100)).toEqual(['kept.js']);
});

// Last: from here on this file's commands are kept on disk
test("a restart forgets neither a command under way nor one that ended, so a quick edit inside another session's long command stays the edit's", async () => {
	const data = await mkdtemp(path.join(os.tmpdir(), 'paude-command-data-'));
	const restart = () => initCommandEdits(data, 1000);

	await restart();
	await commandStarting('s1', 'tests', dir, 0);
	await commandStarting('s2', 'sed', dir, 40);
	await write('two\n');
	await restart();
	expect(await commandEnded('s1', 'tests', 50)).toEqual(['kept.js']);
	await restart();
	expect(await commandEnded('s2', 'sed', 45)).toEqual(['kept.js']);
	expect(credit('s1', 'tests')).toEqual([]);

	// An edit tool's change is remembered too
	await commandStarting('s1', 'tests-2', dir, 100);
	await write('three\n');
	await noteChanged('s2', [path.join(dir, 'kept.js')], 110);
	await restart();
	expect(await commandEnded('s1', 'tests-2', 120)).toEqual([]);
	await rm(data, { recursive: true, force: true });
});
