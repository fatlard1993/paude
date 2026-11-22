import { expect, test } from 'bun:test';

import { programsOf, signalsOf } from './sessionSignals';

const assistant = (
	id,
	content,
	usage = { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 },
) => ({
	type: 'assistant',
	timestamp: '2026-11-21T10:01:00Z',
	message: { id, model: 'claude-opus-5-5', usage, content },
});
const tool = (name, input) => ({ type: 'tool_use', name, input });

test('the programs a command runs, past the cd and variables in front of them', () => {
	expect(programsOf('cd ~/x && S=/tmp/a; grep -n foo bar | head -3')).toEqual(['grep', 'head']);
	expect(programsOf('~/.dotfiles/bin/ctx-where thing || true')).toEqual(['ctx-where', 'true']);
	expect(programsOf('for f in *; do wc -l $f; done')).toEqual(['wc']);
	expect(programsOf("python3 - <<'EOF' | sort\nconst a = 1; import os\nEOF\necho done")).toEqual([
		'python3',
		'sort',
		'echo',
	]);
});

test("a session's signals: what it reached for, where hooks pushed back, what it weighed, never what was said", () => {
	const lines = [
		{
			type: 'attachment',
			timestamp: '2026-11-21T10:00:00Z',
			attachment: { type: 'hook_success', hookEvent: 'SessionStart', content: 'x'.repeat(40) },
		},
		{ type: 'ai-title', aiTitle: 'Fix the picker' },
		{ type: 'user', message: { content: 'fix the picker, secretly' } },
		{ type: 'user', isMeta: true, message: { content: 'a reminder' } },
		{ type: 'user', message: { content: '<command-name>/lectern</command-name>' } },
		assistant('m1', [tool('Bash', { command: 'cd x && ctx-where Picker' }), tool('Skill', { skill: 'commit-stack' })]),
		// The same reply streamed as a second line: its usage isn't counted twice
		assistant('m1', [tool('Agent', { subagent_type: 'Explore' }), tool('Agent', {})]),
		{ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
		{ type: 'attachment', attachment: { type: 'hook_blocking_error', hookName: 'Stop' } },
		{ type: 'attachment', attachment: { type: 'hook_permission_decision', decision: 'deny' } },
		{ type: 'system', subtype: 'compact_boundary' },
		{ type: 'user', isCompactSummary: true, message: { content: 'This session is being continued' } },
		assistant('m2', [tool('Read', {})]),
		{ ...assistant('s1', [tool('Bash', { command: 'ls' })]), isSidechain: true },
	];

	const signals = signalsOf(lines, { id: 's', cwd: '/p', at: 'now', host: 'box' });

	expect(signals).toEqual({
		id: 's',
		at: 'now',
		host: 'box',
		cwd: '/p',
		title: 'Fix the picker',
		started: '2026-11-21T10:00:00Z',
		ended: '2026-11-21T10:01:00Z',
		prompts: 1,
		models: { 'claude-opus-5-5': 2 },
		tools: { Bash: 1, Skill: 1, Agent: 2, Read: 1 },
		programs: { 'ctx-where': 1 },
		skills: { 'commit-stack': 1 },
		agents: { Explore: 1, 'general-purpose': 1 },
		commands: { lectern: 1 },
		hookBlocks: { Stop: 1 },
		permissionDenials: 1,
		compactions: 1,
		startContextChars: 40,
		tokens: { input: 4, cacheWrite: 20, cacheRead: 200, output: 10 },
	});
	expect(JSON.stringify(signals)).not.toContain('secretly');
});
