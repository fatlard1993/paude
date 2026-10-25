import { describe, expect, test } from 'bun:test';

import { createBrowser, openFile } from './fileBrowser';
import { overlayBox, overlayKey } from './overlay';
import { createPanel, itemsOf, panelKey, panelKeys, panelView, statusLine } from './panels';
import { visibleLength } from './screen';

const DOWN = '\x1b[B';
const loaded = (kind, data, extra) => Object.assign(createPanel(kind, extra), { data });

describe('links', () => {
	const links = [
		{ url: 'https://docs.acme.dev/api', kind: 'docs', by: ['Claude'], count: 2, context: 'the API docs' },
		{ url: 'https://github.com/acme/shop/issues/12', kind: 'ticket', by: ['you'], pinned: true },
		{ url: 'https://registry.acme.dev/x', kind: 'reference', by: ['output'] },
	];

	test('leaves out what only a command printed until asked, and tabs by kind', () => {
		const panel = loaded('links', links);

		expect(itemsOf(panel).map(link => link.kind)).toEqual(['docs', 'ticket']);
		panelKey(panel, 'i');
		expect(itemsOf(panel)).toHaveLength(3);
		panelKey(panel, '\t');
		expect(itemsOf(panel).map(link => link.kind)).toEqual(['docs']);
	});

	test('opens, copies, pins and hides the one under the cursor', () => {
		const panel = loaded('links', links);

		panelKey(panel, DOWN);
		expect(panelKey(panel, '\r')).toEqual({ type: 'openUrl', url: links[1].url });
		expect(panelKey(panel, 'y')).toEqual({ type: 'copy', text: links[1].url, what: 'the link' });
		expect(panelKey(panel, 'p')).toEqual({ type: 'markLink', url: links[1].url, change: { pinned: false } });
		expect(panelKey(panel, 'x')).toEqual({ type: 'markLink', url: links[1].url, change: { hidden: true } });
		expect(panelKey(panel, '\x1b')).toEqual({ type: 'leave' });
	});

	test('says what the one under the cursor is', () => {
		const lines = panelView(loaded('links', links), 80, 20).join('\n');

		expect(lines).toContain('the API docs');
		expect(lines).toContain('1 more only a command printed');
	});
});

test('an artifact reads in the box, unless it is something to save and open', () => {
	const panel = loaded('artifacts', [
		{ path: '/tmp/s/chart.py', name: 'chart.py', kind: 'script' },
		{ path: '/tmp/s/out.zip', name: 'out.zip', kind: 'archive' },
	]);

	expect(panelKey(panel, '\r')).toEqual({ type: 'readArtifact', path: '/tmp/s/chart.py' });
	expect(panelKey(panel, 'o')).toEqual({ type: 'saveArtifact', path: '/tmp/s/chart.py', name: 'chart.py' });
	panelKey(panel, DOWN);
	expect(panelKey(panel, '\r')).toEqual({ type: 'saveArtifact', path: '/tmp/s/out.zip', name: 'out.zip' });
});

test("activity opens a turn's steps, newest turn first, and steps back out to where it was", () => {
	const turns = [
		{ id: 't1', prompt: 'first', at: 1, steps: [] },
		{ id: 't2', prompt: 'second', at: 2, steps: [{ tool: 'Edit', file: 'app.js', summary: 'app.js' }] },
	];
	const panel = loaded('activity', { turns });

	expect(itemsOf(panel)[0].id).toBe('t2');
	expect(panelKey(panel, '\r')).toEqual({ type: 'redraw' });
	expect(panelKey(panel, '\r')).toEqual({ type: 'readFile', path: 'app.js' });
	expect(panelKey(panel, 'c')).toEqual({ type: 'readDiffSet', source: { source: 'turn', turn: 't2' } });
	panelKey(panel, '\x1b');
	expect(panel.turn).toBeNull();
	expect(panelKey(panel, '\x1b')).toEqual({ type: 'leave' });
});

describe('git', () => {
	const status = {
		branch: 'main',
		ahead: 1,
		behind: 0,
		staged: [{ path: 'a.js', status: 'modified' }],
		unstaged: [],
		untracked: [{ path: 'new.js', status: 'untracked' }],
		conflicted: [],
	};

	test('a changed file opens its diff, a new one the file', () => {
		const panel = loaded('git', { status });

		expect(panelKey(panel, '\r')).toEqual({ type: 'readDiffSet', source: { source: 'changes', path: 'a.js' } });
		panelKey(panel, DOWN);
		expect(panelKey(panel, '\r')).toEqual({ type: 'readFile', path: 'new.js' });
	});

	test("in a session in a subfolder, files open by the folder's name for them, one outside it as a diff", () => {
		const panel = loaded('git', {
			status: {
				...status,
				staged: [{ path: 'app/a.js', here: 'a.js', status: 'modified' }],
				untracked: [
					{ path: 'app/new.js', here: 'new.js', status: 'untracked' },
					{ path: 'lib/other.js', here: '../lib/other.js', status: 'untracked' },
				],
			},
		});

		expect(panelKey(panel, '\r')).toEqual({ type: 'readDiffSet', source: { source: 'changes', path: 'a.js' } });
		panelKey(panel, DOWN);
		expect(panelKey(panel, '\r')).toEqual({ type: 'readFile', path: 'new.js' });
		panelKey(panel, DOWN);
		expect(panelKey(panel, '\r')).toEqual({
			type: 'readDiffSet',
			source: { source: 'changes', path: '../lib/other.js' },
		});
	});

	test('a tab not read yet is read as it opens; a commit opens its diff', () => {
		const panel = loaded('git', { status });

		expect(panelKey(panel, '\t')).toEqual({ type: 'loadGit', what: 'log' });
		panel.data.log = [{ hash: 'abc123', short: 'abc', subject: 'fix', author: 'me', date: '2026-10-01' }];
		expect(panelKey(panel, '\r')).toEqual({ type: 'readDiffSet', source: { source: 'commit', ref: 'abc123' } });
	});

	test('no pull request says so', () => {
		const panel = loaded('git', { status, pr: { none: true } }, { tab: 3 });

		expect(panelView(panel, 80, 20).join('\n')).toContain('No pull request for this branch.');
	});
});

test('the tour asks first, then steps through its stops', () => {
	const panel = createPanel('tour', { stage: 'confirm', stop: 0 });

	expect(panelView(panel, 70, 20).join('\n')).toContain('Catch up on this session?');
	expect(panelKey(panel, '\r')).toEqual({ type: 'takeTour' });
	panel.stage = 'touring';
	panel.data = { overview: 'Two things happened.', stops: [{ prompt: 'fix it', at: 1, text: 'Fixed it.' }] };
	panelKey(panel, '\x1b[C');
	expect(panelView(panel, 70, 20).join('\n')).toContain('Fixed it.');
	expect(panelKey(panel, '\x1b[C')).toEqual({ type: 'ignore' });
	expect(panelKey(panel, '\x1b')).toEqual({ type: 'leave' });
});

test('lifetime offers to put back the last switch while it still can', () => {
	const panel = loaded('lifetime', { lifetime: 'brief', switched: { was: 'warm', until: Date.now() + 60_000 } });

	expect(itemsOf(panel)[0].label).toContain('Put back: Kept warm');
	expect(panelKey(panel, '\r')).toEqual({ type: 'setLifetime', lifetime: 'warm' });
});

test("the box's line names the lifetime, the watch and the cache", () => {
	const line = statusLine({ lifetime: 'warm', watching: true, meter: { warmUntil: Date.now() + 5 * 60_000 } });

	expect(line).toContain('Kept warm');
	expect(line).toContain('watching');
	expect(line).toContain('cached 5m');
	expect(statusLine({ lifetime: 'ordinary', watching: false, meter: { warmUntil: 0 } })).toContain('not cached');
});

describe('in the box', () => {
	const fresh = (extra = {}) => ({
		id: 's1',
		role: 'owner',
		draft: null,
		thread: null,
		presence: { clients: [], title: 'A session' },
		notes: { chat: [], comments: [] },
		...extra,
	});

	test('each panel is a key away, and esc comes back out of it', () => {
		const state = fresh();

		expect(overlayKey(state, 'l')).toEqual({ type: 'panel', kind: 'links' });
		expect(overlayKey(state, 'a')).toEqual({ type: 'panel', kind: 'artifacts' });
		expect(overlayKey(state, 'g')).toEqual({ type: 'panel', kind: 'git' });
		expect(overlayKey(state, 'w')).toEqual({ type: 'toggleWatch' });
		expect(overlayKey(state, 'L')).toEqual({ type: 'panel', kind: 'lifetime' });
		state.panel = loaded('services', { shares: [] });
		overlayKey(state, '\x1b');
		expect(state.panel).toBeNull();
	});

	test("lifetime is the owner's alone, and a viewer has no files to browse", () => {
		expect(overlayKey(fresh({ role: 'comment' }), 'L')).toEqual({ type: 'ignore' });
		expect(overlayKey(fresh({ role: 'watch' }), 'l')).toEqual({ type: 'ignore' });
	});

	test('a file read from a panel closes back to the panel', () => {
		const state = fresh({ panel: loaded('services', { shares: [] }) });

		state.files = Object.assign(createBrowser([]), { fromPanel: true, open: openFile('a.js', 'x') });
		overlayKey(state, '\x1b');
		expect(state.files).toBeNull();
		expect(state.panel).not.toBeNull();
	});

	test('draws a panel inside the box, every line the box wide', () => {
		const state = fresh({
			panel: loaded('links', [{ url: 'https://docs.acme.dev', kind: 'docs', by: ['you'] }]),
		});
		const box = overlayBox(state, 120, 30);

		expect(box.lines.every(line => visibleLength(line) === box.width)).toBe(true);
		expect(box.lines.join('\n')).toContain('docs.acme.dev');
	});
});

test('a key that does nothing here is not offered', () => {
	const keys = panel => panelKeys(panel, key => `[${key}]`).join(' ');
	const pr = loaded('git', { pr: { unavailable: 'gh is not logged in' } }, { tab: 3 });

	expect(keys(pr)).not.toContain('[enter]');
	expect(keys(loaded('links', []))).not.toContain('[enter]');
});

describe('decisions', () => {
	const data = {
		reading: false,
		decisions: [
			{
				id: 't2:0',
				kind: 'direction',
				chose: 'Commit to main',
				asked: 'no issues',
				at: '2026-10-22T12:00:00Z',
				place: null,
			},
			{
				id: 't1:0',
				kind: 'decision',
				chose: 'Lock per user',
				rejected: 'Per session',
				because: 'A new session would reset it',
				asked: 'lock accounts',
				at: '2026-10-22T11:00:00Z',
				place: '382a290',
			},
		],
	};

	test('leads with what is unrecorded; Tab shows what is, and where', () => {
		const panel = loaded('decisions', data);

		expect(itemsOf(panel).map(item => item.id)).toEqual(['t2:0']);
		expect(panelView(panel, 80, 20).join('\n')).toContain('Unrecorded 1');
		panelKey(panel, '\t');
		expect(itemsOf(panel).map(item => item.id)).toEqual(['t1:0']);

		const lines = panelView(panel, 80, 20).join('\n');

		expect(lines).toContain('Rejected: Per session');
		expect(lines).toContain('recorded in 382a290');
	});

	test('asks Claude to record one that is unrecorded, or sets it aside', () => {
		const panel = loaded('decisions', data);

		expect(panelKey(panel, 'w')).toEqual({ type: 'writeDecision', id: 't2:0' });
		expect(panelKey(panel, 'x')).toEqual({ type: 'dismissDecision', id: 't2:0' });
		panelKey(panel, '\t');
		expect(panelKey(panel, 'w')).toEqual({ type: 'ignore' });
		expect(panelKeys(panel, key => key).join(' ')).not.toContain('record it');
	});

	test('what filing one asks is shown, and a answers it; one filed says which commit took it', () => {
		const panel = loaded('decisions', {
			reading: false,
			decisions: [
				{ ...data.decisions[0], question: 'Main, or a branch per change?' },
				{ ...data.decisions[1], filed: true },
			],
		});

		expect(panelView(panel, 80, 20).join('\n')).toContain('To file it, paude asks: Main, or a branch per change?');
		expect(panelKey(panel, 'a')).toEqual({
			type: 'answerDecision',
			id: 't2:0',
			question: 'Main, or a branch per change?',
		});
		panelKey(panel, '\t');
		expect(panelView(panel, 80, 20).join('\n')).toContain('filed into 382a290');
		expect(panelKey(panel, 'a')).toEqual({ type: 'ignore' });
	});

	test("a design document's claim one overrules is shown, and w asks Claude to change it", () => {
		const overrules = { file: 'auth/auth.lld.md', claim: 'Tracked per session.' };
		const panel = loaded('decisions', { reading: false, decisions: [{ ...data.decisions[0], overrules }] });

		expect(panelView(panel, 120, 20).join('\n')).toContain('Overrules auth/auth.lld.md: "Tracked per session."');
		expect(panelKeys(panel, key => key).join(' ')).toContain('change the claim');
		expect(panelKey(panel, 'w')).toEqual({ type: 'writeDecision', id: 't2:0' });
	});

	test('a design document one belongs in is named, and w asks Claude to add the claim', () => {
		const panel = loaded('decisions', {
			reading: false,
			decisions: [{ ...data.decisions[0], belongs: 'auth/auth.lld.md' }],
		});

		expect(panelView(panel, 120, 20).join('\n')).toContain('A claim for auth/auth.lld.md');
		expect(panelKeys(panel, key => key).join(' ')).toContain('add the claim');

		const checked = loaded('decisions', {
			reading: false,
			decisions: [{ ...data.decisions[0], belongs: 'auth/auth.lld.md', refuted: true }],
		});

		expect(panelView(checked, 120, 20).join('\n')).toContain("Checked: the code doesn't hold it now");
	});

	test('says while it is still reading, and what an empty tab means', () => {
		const lines = panelView(loaded('decisions', { reading: true, decisions: [] }), 80, 20).join('\n');

		expect(lines).toContain('Reading the conversation for what it settled');
		expect(lines).toContain('Nothing settled here waits to be recorded.');
	});
});

describe('git: not pushed', () => {
	const stack = {
		base: 'abc',
		concerns: [
			{ hash: 'b2'.padEnd(40, '0'), short: 'b2', subject: 'two', body: '', folds: [] },
			{
				hash: 'a1'.padEnd(40, '0'),
				short: 'a1',
				subject: 'one, widened',
				body: 'Chose one.',
				folds: [{ kind: 'amend' }],
			},
		],
	};

	test('lists the concerns, what each has to fold in, and settles them', () => {
		const panel = loaded('git', { stack }, { tab: 4 });

		expect(itemsOf(panel).map(concern => concern.subject)).toEqual(['two', 'one, widened']);
		expect(panelView(panel, 80, 20).join('\n')).toContain('+1 to fold in');
		expect(panelKey(panel, 's')).toEqual({ type: 'settle' });
		panelKey(panel, DOWN);
		expect(panelView(panel, 80, 20).join('\n')).toContain('Chose one.');
		expect(panelKey(panel, '\r')).toEqual({
			type: 'readDiffSet',
			source: { source: 'commit', ref: stack.concerns[1].hash },
		});
	});

	test('nothing to fold in: no settling', () => {
		const panel = loaded('git', { stack: { base: 'abc', concerns: [stack.concerns[0]] } }, { tab: 4 });

		expect(panelKey(panel, 's')).toEqual({ type: 'ignore' });
		expect(panelKeys(panel, key => key).join(' ')).not.toContain('settle');
	});
});
