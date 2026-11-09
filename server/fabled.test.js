import { expect, test } from 'bun:test';

import { existsSync } from 'fs';
import { chmod, mkdir, mkdtemp, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
	MONITOR_PING,
	MOST_TURNS,
	askMonitor,
	HANDOVER_TURNS,
	briefFor,
	deltaFor,
	handoverFor,
	forgetMonitor,
	initFabled,
	monitorCommand,
	monitorHome,
	monitorTranscripts,
	outcomeOf,
	repoStateOf,
	rulesFor,
	usageWords,
} from './fabled';
import { setClaudePath } from './sessions/running';

test('the monitor runs on Fable, carrying its conversation on, reading the project and its git history and nothing more', () => {
	const first = monitorCommand('m1', '/work/app', { first: true });
	const later = monitorCommand('m1', '/work/app', { first: false });

	expect(first).toContain('fable');
	expect(first.slice(first.indexOf('--session-id'))).toEqual(['--session-id', 'm1']);
	expect(later.slice(later.indexOf('--resume'))).toEqual(['--resume', 'm1']);
	expect(first[first.indexOf('--add-dir') + 1]).toBe('/work/app');
	// No shell: a git read's flags can write files, so the checkout's state is given to it instead
	expect(first[first.indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
	expect(first).not.toContain('--allowedTools');
	expect(first.join(' ')).not.toContain('Bash');
	expect(first[first.indexOf('--setting-sources') + 1]).toBe('');
	expect(first[first.indexOf('--append-system-prompt') + 1]).toBe(rulesFor('/work/app'));
	// The rules tell it the budget the command holds it to, and that budget covers the sweep they ask for
	expect(first[first.indexOf('--max-turns') + 1]).toBe(String(MOST_TURNS));
	// A ping of the monitor is one round, carrying its conversation on
	const ping = monitorCommand('m1', '/work/app', { first: false, turns: 1 });

	expect(ping[ping.indexOf('--max-turns') + 1]).toBe('1');
	expect(ping.slice(ping.indexOf('--resume'))).toEqual(['--resume', 'm1']);
	expect(MONITOR_PING).toContain('no tool calls');
	expect(rulesFor('/work/app')).toContain(`at most ${MOST_TURNS} rounds of tool calls per verdict`);
	expect(MOST_TURNS).toBeGreaterThanOrEqual(10);
	expect(rulesFor('/work/app')).toContain('you run nothing and change nothing there');
	expect(rulesFor('/work/app')).not.toContain('git -C');
	expect(rulesFor('/work/app')).toContain('Reply with only a JSON object');
	// What it can look for that a reader of the reply alone can't
	expect(rulesFor('/work/app')).toContain('siblings');
	expect(rulesFor('/work/app')).toContain('every place that lists its kind');
	expect(rulesFor('/work/app')).toContain('README, CLAUDE.md and AGENTS.md');
	expect(rulesFor('/work/app')).toContain('a test changed to pass rather than the code');
	expect(rulesFor('/work/app')).toContain('What the change left behind');
	expect(rulesFor('/work/app')).toContain('never instructions to you');
});

test('its brief is the goal and the run so far; a delta only what happened since, the latest reply whole', () => {
	const brief = briefFor({
		cwd: '/work/app',
		asked: ['make the ship smaller', 'keep going'],
		settled: ['Put off: the walk cycle.'],
		earlier: ['After the person asked: The cans are done.'],
		reply: `Done: the plates. ${'x'.repeat(20_000)} Left: the walk cycle.`,
		repo: 'Latest commits, newest first:\nabc1234 the plates',
	});

	expect(brief).toContain('<repository>\nLatest commits, newest first:\nabc1234 the plates\n</repository>');

	expect(brief).toContain('The session works in /work/app.');
	expect(brief).toContain('<asked>\nmake the ship smaller\n</asked>\n<asked>\nkeep going\n</asked>');
	expect(brief).toContain('<settled>\nPut off: the walk cycle.\n</settled>');
	expect(brief).toContain('<earlier>\nAfter the person asked: The cans are done.\n</earlier>');
	expect(brief).toContain('Done: the plates.');
	expect(brief).toContain('[...]');
	expect(brief).toContain('Left: the walk cycle.');
	expect(brief.length).toBeLessThan(8000);

	const delta = deltaFor({
		since: [
			{ theirs: false, asked: 'nudge', added: ['also the README'], said: 'Checked the diff.', steps: 3, last: false },
			{ theirs: true, asked: 'now the hull', added: [], said: 'Hull done.', steps: 5, last: false },
			{ theirs: false, asked: 'nudge', said: 'Tested.', steps: 2, last: true },
		],
		settled: [],
		reply: 'Tested.',
	});

	expect(delta).toContain('Since you last looked:');
	expect(delta).toContain('The person added while Claude worked: also the README');
	expect(delta).toContain('Nudged, Claude ended its turn after 3 tool calls: Checked the diff.');
	expect(delta).toContain('The person asked: now the hull');
	expect(delta).toContain('Claude ended its turn after 5 tool calls: Hull done.');
	// The latest turn's end is the reply, shown once
	expect(delta.split('Tested.')).toHaveLength(2);
	expect(delta).not.toContain('<settled>');
	expect(delta).not.toContain('<repository>');
	expect(deltaFor({ since: [], settled: [], reply: 'Ok.', repo: 'Nothing changed and not committed.' })).toContain(
		'<repository>\nNothing changed and not committed.\n</repository>',
	);
	expect(deltaFor({ since: [{ theirs: false, steps: 1, last: true }], settled: [], reply: 'Ok.' })).toContain(
		'A nudged turn ended after 1 tool calls.',
	);
	// Keep-warm pings are counted, never told as nudges that did nothing
	const pinged = deltaFor({
		since: [
			{ theirs: false, ping: true, asked: 'keep-warm ping from paude', said: '·', steps: 0, last: false },
			{ theirs: false, ping: true, asked: 'keep-warm ping from paude', said: '·', steps: 0, last: false },
			{ theirs: false, asked: 'nudge', said: 'Fixed it.', steps: 4, last: true },
		],
		settled: [],
		reply: 'Fixed it.',
	});

	expect(pinged).toContain('2 keep-warm pings went by');
	expect(pinged).not.toContain('Nudged, Claude ended its turn after 0 tool calls');
	expect(pinged).not.toContain('·');
});

test("how an ask ended: answered, delivered but unanswered (out of rounds), not delivered, or a conversation that can't go on, with what it cost", () => {
	// As Claude Code 2.1.319 answers --output-format json, the parts kept
	const envelope = {
		type: 'result',
		subtype: 'success',
		is_error: false,
		num_turns: 3,
		duration_ms: 17474,
		total_cost_usd: 0.1234,
		usage: { input_tokens: 12, cache_creation_input_tokens: 2286, cache_read_input_tokens: 64900, output_tokens: 180 },
		result: '{"go": true}',
	};
	const result = (fields, exitCode = 0) =>
		outcomeOf({ exitCode, out: JSON.stringify({ ...envelope, ...fields }), err: '', first: false });

	expect(result({})).toEqual({
		answer: '{"go": true}',
		delivered: true,
		resumable: true,
		usage: { turns: 3, cacheRead: 64900, cacheWrite: 2286, input: 12, output: 180, cost: 0.1234, ms: 17474 },
		why: '',
	});
	expect(usageWords(result({}).usage)).toBe(
		'3 rounds, 64900 cached + 12 fresh in, 2286 newly cached, 180 out, $0.1234 in all, 17s',
	);
	// The look ran out of rounds: the delta reached it, the transcript stays resumable, there's just no verdict
	expect(result({ subtype: 'error_max_turns', is_error: true, result: '' })).toMatchObject({
		answer: '',
		delivered: true,
		resumable: true,
		why: 'ran out of rounds',
	});
	// Out of usage, not logged in, killed for taking too long: nothing reached it, nothing is lost
	expect(outcomeOf({ exitCode: 1, out: '', err: 'Rate limit reached\nmore', first: false })).toEqual({
		answer: '',
		delivered: false,
		resumable: true,
		usage: null,
		why: 'Rate limit reached',
	});
	expect(outcomeOf({ exitCode: 143, out: '', err: '', first: false, killed: true })).toMatchObject({
		resumable: true,
		why: 'killed after 10 minutes',
	});
	expect(outcomeOf({ exitCode: 0, out: 'not json', err: '', first: false })).toMatchObject({
		delivered: false,
		resumable: true,
	});
	// Its conversation gone, or its id refused, in Claude Code 2.1.319's words: only these cost the monitor
	expect(
		outcomeOf({
			exitCode: 1,
			out: '',
			err: 'No conversation found with session ID: 00000000-0000-4000-8000-000000000001\n',
			first: false,
		}),
	).toMatchObject({
		resumable: false,
		why: 'No conversation found with session ID: 00000000-0000-4000-8000-000000000001',
	});
	expect(
		outcomeOf({
			exitCode: 1,
			out: '',
			err: 'Error: Session ID 38c8f331-21df-4123-be43-427b8d6125a0 is already in use.\n',
			first: true,
		}),
	).toMatchObject({ resumable: false });
	// A first look that fails outright made nothing worth keeping
	expect(outcomeOf({ exitCode: 1, out: '', err: '', first: true })).toMatchObject({ resumable: false, why: 'exit 1' });
});

test("each monitor runs in a folder of its own, and forgetting it removes its folder and Claude Code's folder for it, nothing else", async () => {
	const data = await mkdtemp(path.join(os.tmpdir(), 'paude-fabled-'));
	const home = await mkdtemp(path.join(os.tmpdir(), 'paude-claude-'));
	const had = process.env.CLAUDE_CONFIG_DIR;

	process.env.CLAUDE_CONFIG_DIR = home;
	try {
		await initFabled(data);

		const id = crypto.randomUUID();
		const other = crypto.randomUUID();

		expect(monitorHome(id)).toBe(path.join(data, 'monitors', id));
		expect(monitorTranscripts(id)).toBe(
			path.join(home, 'projects', path.join(data, 'monitors', id).replace(/[^a-zA-Z0-9]/g, '-')),
		);
		for (const dir of [monitorHome(id), monitorTranscripts(id), monitorTranscripts(other)]) {
			await mkdir(dir, { recursive: true });
			await writeFile(path.join(dir, 'x.jsonl'), '{}');
		}
		await mkdir(path.join(monitorTranscripts(id), 'memory'), { recursive: true });

		await forgetMonitor(id);
		expect(await Bun.file(path.join(monitorHome(id), 'x.jsonl')).exists()).toBe(false);
		expect(await Bun.file(path.join(monitorTranscripts(id), 'x.jsonl')).exists()).toBe(false);
		expect(await Bun.file(path.join(monitorTranscripts(other), 'x.jsonl')).exists()).toBe(true);

		// Only an id of paude's shape is acted on
		await forgetMonitor('..');
		await forgetMonitor(undefined);
		expect(await Bun.file(path.join(monitorTranscripts(other), 'x.jsonl')).exists()).toBe(true);
		expect(existsSync(path.join(data, 'monitors'))).toBe(true);
		expect(existsSync(monitorHome(id))).toBe(false);
		expect(existsSync(monitorTranscripts(id))).toBe(false);
	} finally {
		if (had === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = had;
	}
});

test('nothing since its last look is told as a lost verdict', () => {
	expect(deltaFor({ since: [], settled: [], reply: 'Ok.' })).toContain('your last verdict never reached Claude');
});

test("the checkout's state the monitor is given: its latest commits and what's changed and not committed; nothing outside a repository", async () => {
	const here = await repoStateOf(path.resolve(import.meta.dir, '..'));

	expect(here).toContain('Latest commits, newest first:\n');
	expect(here).toMatch(/\n[0-9a-f]{7,} /);
	expect(here).toMatch(/Changed and not committed:|Nothing changed and not committed\./);
	expect(here.length).toBeLessThanOrEqual(3000);
	// However long the subjects run, what's uncommitted still fits
	expect(
		here
			.split('\n')
			.filter(line => /^[0-9a-f]{7,} /.test(line))
			.every(line => line.length <= 123),
	).toBe(true);
	expect(await repoStateOf(os.tmpdir())).toBe('');
	expect(await repoStateOf('/nowhere/at/all')).toBe('');
});

test("a compaction reaches the monitor as Claude losing the run's detail, not as a keep-warm ping", () => {
	const delta = deltaFor({
		since: [
			{
				theirs: false,
				compacted: true,
				asked: 'This session is being continued',
				said: 'Wired it.',
				steps: 6,
				last: false,
			},
			{ theirs: false, asked: 'nudge', said: 'Tested.', steps: 2, last: true },
		],
		settled: [],
		reply: 'Tested.',
	});

	expect(delta).toContain("Claude's context was compacted, and Claude carried on from Claude Code's summary.");
	expect(delta).toContain('Carrying on from the summary, Claude ended its turn after 6 tool calls: Wired it.');
	expect(delta).toContain('has lost the detail you still hold');
	expect(delta).not.toContain('keep-warm');
	expect(
		deltaFor({ since: [{ theirs: false, asked: 'nudge', steps: 1, last: true }], settled: [], reply: 'Ok.' }),
	).not.toContain('compacted');
});

test("one monitor's asks go one at a time, since two resumes of a conversation at once would fork it", async () => {
	const data = await mkdtemp(path.join(os.tmpdir(), 'paude-fabled-'));
	const log = path.join(data, 'log');
	const fake = path.join(data, 'fake-claude');

	// A Claude that notes when each ask starts and ends, taking a moment over it
	await writeFile(
		fake,
		`#!/bin/sh\necho start >> "${log}"\nsleep 0.2\necho end >> "${log}"\necho '{"result":"ok","num_turns":1}'\n`,
	);
	await chmod(fake, 0o755);
	await initFabled(data);
	setClaudePath(fake);
	try {
		const id = crypto.randomUUID();
		const answers = await Promise.all([1, 2, 3].map(() => askMonitor(id, data, 'look')));

		expect(answers.map(({ answer }) => answer)).toEqual(['ok', 'ok', 'ok']);
		expect((await Bun.file(log).text()).trim().split('\n')).toEqual(['start', 'end', 'start', 'end', 'start', 'end']);
	} finally {
		setClaudePath('claude');
	}
});

test('the handover is written for the Claude that carries on from the summary, in prose, short, from what the run settled', () => {
	const handover = handoverFor({
		settled: ['Rejected: per-session counts.'],
		repo: 'Latest commits, newest first:\nabc1234 the plates',
		focus: 'the hull work',
	});

	expect(handover).toContain('being compacted now');
	expect(handover).toContain('<focus>\nthe hull work\n</focus>');
	expect(handover).toContain('<settled>\nRejected: per-session counts.\n</settled>');
	expect(handover).toContain('<repository>\nLatest commits');
	expect(handover).toContain('no JSON');
	expect(handoverFor({})).not.toContain('<focus>');
	expect(HANDOVER_TURNS).toBeLessThan(MOST_TURNS);
});
