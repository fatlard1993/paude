import { mkdir, mkdtemp, realpath } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { beforeEach, expect, test } from 'bun:test';

import { parseDiff } from '../shared/diff';
import { diffSet, diffTexts, keepShownText, turnsWithChanges } from './diffs';
import { trackProposals } from './sessions/proposals';

const ID = 'session-1';
let home;
let cwd;

const prompt = (uuid, text) => ({ type: 'user', uuid, timestamp: '2026-10-06T10:00:00Z', message: { content: text } });
const snapshot = (messageId, trackedFileBackups) => ({
	type: 'file-history-snapshot',
	messageId,
	snapshot: { messageId, trackedFileBackups },
});
const call = (id, name, input) => ({
	type: 'assistant',
	message: { content: [{ type: 'tool_use', id, name, input }] },
});
const result = (id, filePath, originalFile) => ({
	type: 'user',
	message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
	toolUseResult: { filePath, originalFile },
});

// The lines of a diff a person would read: what was taken out and put in
const changed = diff =>
	parseDiff(diff)
		.hunks.flatMap(({ lines }) => lines)
		.filter(({ kind }) => kind !== 'context')
		.map(({ kind, text }) => `${kind === 'added' ? '+' : '-'}${text}`);

beforeEach(async () => {
	home = await realpath(await mkdtemp(join(os.tmpdir(), 'paude-claude-')));
	cwd = join(home, 'project');
	process.env.CLAUDE_CONFIG_DIR = home;
	await mkdir(join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-')), { recursive: true });
	await mkdir(join(home, 'file-history', ID), { recursive: true });
	await Bun.write(join(cwd, 'a.js'), 'three\n');
	await Bun.write(join(cwd, 'b.js'), 'new\n');
	await Bun.write(join(home, 'file-history', ID, 'aaaa@v2'), 'two\n');
	await Bun.write(join(home, 'file-history', ID, 'bbbb@v2'), 'new\n');

	// Turn one edits a.js and creates b.js (and touches files outside the project, and a secret); turn two edits
	// a.js again. The snapshot at turn two's prompt holds both files as turn one left them.
	const lines = [
		prompt('p1', 'make it two'),
		snapshot('p1', {}),
		call('t1', 'Edit', { file_path: join(cwd, 'a.js'), old_string: 'one', new_string: 'two' }),
		result('t1', join(cwd, 'a.js'), 'one\n'),
		call('t2', 'Write', { file_path: join(cwd, 'b.js'), content: 'new\n' }),
		result('t2', join(cwd, 'b.js'), null),
		result('t3', '/etc/hosts', 'outside\n'),
		result('t4', join(cwd, '.env'), 'TOKEN=secret\n'),
		prompt('p2', 'now three'),
		snapshot('p2', {
			'a.js': { backupFileName: 'aaaa@v2', version: 2, realParentDir: cwd },
			[join(cwd, 'b.js')]: { backupFileName: 'bbbb@v2', version: 2, realParentDir: cwd },
		}),
		call('t5', 'Edit', { file_path: join(cwd, 'a.js'), old_string: 'two', new_string: 'three' }),
		result('t5', join(cwd, 'a.js'), 'two\n'),
	];

	await Bun.write(
		join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${ID}.jsonl`),
		lines.map(line => JSON.stringify(line)).join('\n'),
	);
});

test('two texts diff the way git would', async () => {
	expect(changed(await diffTexts('a\nb\n', 'a\nc\n'))).toEqual(['-b', '+c']);
	expect(await diffTexts('same\n', 'same\n')).toBeNull();
});

test('the turns that changed files in the project, newest first, counting only files inside it', async () => {
	expect(await turnsWithChanges(ID, cwd)).toEqual([
		{ id: 'p2', prompt: 'now three', at: '2026-10-06T10:00:00Z', files: 1 },
		{ id: 'p1', prompt: 'make it two', at: '2026-10-06T10:00:00Z', files: 2 },
	]);
});

test("a turn's diff runs from before its first edit to its end: the next prompt's snapshot, or the disk now", async () => {
	const first = await diffSet(ID, cwd, { source: 'turn', turn: 'p1' });

	expect(first.title).toBe('make it two');
	expect(first.files.map(({ path, status, diff }) => ({ path, status, lines: changed(diff) }))).toEqual([
		{ path: 'a.js', status: 'modified', lines: ['-one', '+two'] },
		{ path: 'b.js', status: 'added', lines: ['+new'] },
	]);

	const latest = await diffSet(ID, cwd, { source: 'turn', turn: 'p2' });

	expect(latest.files.map(({ path, diff }) => ({ path, lines: changed(diff) }))).toEqual([
		{ path: 'a.js', lines: ['-two', '+three'] },
	]);
	await expect(diffSet(ID, cwd, { source: 'turn', turn: 'nope' })).rejects.toThrow('not in this session');
});

test("a proposal is an edit Claude asked for and hasn't made, applied to the file as it is now", async () => {
	const ask = (tool_use_id, tool_name, tool_input) =>
		trackProposals(ID, { hook_event_name: 'PreToolUse', tool_use_id, tool_name, tool_input });

	ask('t6', 'Edit', { file_path: join(cwd, 'a.js'), old_string: 'three', new_string: 'four' });
	ask('t7', 'MultiEdit', { file_path: join(cwd, 'b.js'), edits: [{ old_string: 'gone', new_string: 'never' }] });
	ask('t8', 'Write', { file_path: '/etc/passwd', content: 'nope' });
	ask('t9', 'Write', { file_path: join(cwd, 'b.js'), content: 'replaced\n' });
	trackProposals(ID, { hook_event_name: 'PostToolUse', tool_use_id: 't9', tool_name: 'Write' });

	const { title, files } = await diffSet(ID, cwd, { source: 'proposal' });

	expect(title).toBe('Proposed by Claude');
	expect(files.map(({ path, diff, note }) => ({ path, lines: diff ? changed(diff) : [], note }))).toEqual([
		{ path: 'a.js', lines: ['-three', '+four'], note: undefined },
		{ path: 'b.js', lines: [], note: 'This edit no longer applies to the file.' },
	]);

	// A new prompt, or the turn ending, means nothing is waiting any more
	trackProposals(ID, { hook_event_name: 'Stop' });
	expect((await diffSet(ID, cwd, { source: 'proposal' })).files).toEqual([]);
});

test('two project files compare, and anything else is refused', async () => {
	const { files } = await diffSet(ID, cwd, { source: 'files', a: 'a.js', b: 'b.js' });

	expect(files.map(({ path, from, diff }) => ({ path, from, lines: changed(diff) }))).toEqual([
		{ path: 'b.js', from: 'a.js', lines: ['-three', '+new'] },
	]);
	await expect(diffSet(ID, cwd, { source: 'files', a: 'a.js', b: '../../etc/hosts' })).rejects.toThrow('text files');
	await expect(diffSet(ID, cwd, { source: 'whatever' })).rejects.toThrow('Unknown');
});

test('in git, each file of a diff names the two texts it is between, from any source, without writing them into git', async () => {
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
	const git = (...args) =>
		Bun.spawnSync(['git', ...args], { cwd, env: { ...env, GIT_CONFIG_NOSYSTEM: '1', HOME: home } })
			.stdout.toString()
			.trim();
	const blobOfText = text =>
		Bun.spawnSync(['git', 'hash-object', '--stdin'], { cwd, env, stdin: new TextEncoder().encode(text) })
			.stdout.toString()
			.trim();
	const kept = hash => Bun.spawnSync(['git', 'cat-file', '-e', hash], { cwd, env }).exitCode === 0;

	git('init', '-q');
	git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
	git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
	await Bun.write(join(cwd, 'a.js'), 'four\n');

	const [working] = (await diffSet(ID, cwd, { source: 'changes', path: 'a.js' })).files;

	expect(working.blobs).toEqual({ old: blobOfText('three\n'), new: blobOfText('four\n') });
	expect(kept(working.blobs.new)).toBe(false);

	const turn = await diffSet(ID, cwd, { source: 'turn', turn: 'p1' });

	expect(turn.files.map(({ path, blobs }) => [path, blobs])).toEqual([
		['a.js', { old: blobOfText('one\n'), new: blobOfText('two\n') }],
		// Added in the turn: nothing before it
		['b.js', { new: blobOfText('new\n') }],
	]);
	expect(kept(blobOfText('one\n'))).toBe(false);
	expect(kept(blobOfText('two\n'))).toBe(false);

	// A comment on lines picked in it keeps the text they were picked in, read again from the turn, and only that one
	expect(await keepShownText(ID, cwd, { source: 'turn', turn: 'p1' }, 'a.js', blobOfText('two\n'))).toBe(
		blobOfText('two\n'),
	);
	expect(kept(blobOfText('two\n'))).toBe(true);
	expect(kept(blobOfText('one\n'))).toBe(false);
	expect(await keepShownText(ID, cwd, { source: 'turn', turn: 'p1' }, 'a.js', 'f'.repeat(40))).toBeUndefined();
	expect(await keepShownText(ID, cwd, { source: 'turn', turn: 'nope' }, 'a.js', blobOfText('one\n'))).toBeUndefined();
	expect(await keepShownText(ID, cwd, { source: 'commit', ref: 'HEAD' }, 'a.js', blobOfText('one\n'))).toBeUndefined();
});

test("the branch's diff with its work says how many files it leaves out", async () => {
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
	const repo = join(home, 'repo');
	const git = (...args) =>
		Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
			cwd: repo,
			env: { ...env, GIT_CONFIG_NOSYSTEM: '1', HOME: home },
		});

	await Bun.write(join(repo, 'a.js'), 'one\n');
	git('init', '-q', '-b', 'main');
	git('add', '-A');
	git('commit', '-qm', 'first');
	git('switch', '-q', '-c', 'idea');
	await Promise.all(
		Array.from({ length: 201 }, (_, index) => Bun.write(join(repo, `n${String(index).padStart(3, '0')}.js`), 'n\n')),
	);

	const { title, files } = await diffSet(ID, repo, { source: 'compare' });

	expect(files).toHaveLength(200);
	expect(title).toBe(
		'0 commits beyond main, and 200 files changed and not committed (1 more file left out, past what fits here)',
	);
});

test("a commit's files are named from the session's folder, as comments and the files panel name them", async () => {
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
	const repo = join(home, 'repo');
	const git = (...args) =>
		Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
			cwd: repo,
			env: { ...env, GIT_CONFIG_NOSYSTEM: '1', HOME: home },
		});

	await Bun.write(join(repo, 'app', 'a.js'), 'one\n');
	await Bun.write(join(repo, 'lib', 'b.js'), 'two\n');
	git('init', '-q');
	git('add', '-A');
	git('commit', '-qm', 'first');

	const { files } = await diffSet(ID, join(repo, 'app'), { source: 'commit', ref: 'HEAD' });

	expect(files.map(({ path }) => path)).toEqual(['a.js', '../lib/b.js']);
	expect(Object.keys(files[0].blobs)).toEqual(['new']);

	// The Git panel lists the whole repository's changes; one outside the folder opens by its name from the folder
	await Bun.write(join(repo, 'lib', 'b.js'), 'three\n');
	await Bun.write(join(repo, 'lib', 'c.js'), 'new\n');

	const outside = await diffSet(ID, join(repo, 'app'), { source: 'changes', path: '../lib/b.js' });

	expect(outside.files.map(({ path, status, diff }) => [path, status, changed(diff)])).toEqual([
		['../lib/b.js', 'modified', ['-two', '+three']],
	]);
	expect(Object.keys(outside.files[0].blobs)).toEqual(['old', 'new']);
	expect(
		(await diffSet(ID, join(repo, 'app'), { source: 'changes', path: '../lib/c.js' })).files.map(f => f.status),
	).toEqual(['untracked']);
	await expect(diffSet(ID, join(repo, 'app'), { source: 'changes', path: '../../etc/hosts' })).rejects.toThrow(
		'no changes',
	);
});
