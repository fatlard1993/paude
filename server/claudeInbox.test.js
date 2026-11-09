import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'bun:test';

import { answerTo, askClaude, initClaudeInbox } from './claudeInbox';

const prompt = text => ({ type: 'user', message: { role: 'user', content: text } });
const said = text => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const tool = () => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } });
const result = () => ({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } });

const ASKED = '[paude chat · ana] what does this do?';

test("Claude's last words after the message are its answer", () => {
	const lines = [
		prompt('earlier'),
		said('done'),
		prompt(ASKED),
		said('Let me look.'),
		tool(),
		result(),
		said('It parses.'),
	];

	expect(answerTo(lines, ASKED)).toBe('It parses.');
});

test('a multi-line message is found inside the tags Claude Code records a paste in', () => {
	const asked = '[paude comment · ana] On this output:\n> pong\n\nIs this right?';
	const recorded = `\n\n<pasted_content id="021f">\n${asked}\n</pasted_content id="021f">\n`;

	expect(answerTo([prompt(recorded), said('yes')], asked)).toBe('yes');
});

test('the answer stops at the next prompt', () => {
	expect(answerTo([prompt(ASKED), said('It parses.'), prompt('next'), said('other')], ASKED)).toBe('It parses.');
});

test('not answered yet: not in the transcript, or nothing after it', () => {
	expect(answerTo([prompt('earlier'), said('done')], ASKED)).toBeUndefined();
	expect(answerTo([prompt('earlier'), said('done'), prompt(ASKED)], ASKED)).toBeUndefined();
});

test('a turn of tools and no words answers empty', () => {
	expect(answerTo([prompt(ASKED), tool(), result()], ASKED)).toBe('');
});

const inboxFile = dir => Bun.file(path.join(dir, 'claude-inbox.json')).json();

test("a message sent while Claude asks a question that takes words answers it through that option; one that doesn't waits", async () => {
	const { initActivity, setStatus } = await import('./activity');
	const dir = mkdtempSync(path.join(os.tmpdir(), 'inbox-'));

	await initActivity(dir);
	const answers = [];
	const asking = { question: 'What next?', typing: '3' };
	const session = {
		promptDraft: () => null,
		typeIn: () => {},
		asking: () => asking,
		answer: (question, key, text) => {
			answers.push({ question, key, text });

			return true;
		},
	};

	await setStatus('asked', 'waiting');
	await initClaudeInbox(dir, id => (id === 'asked' ? session : undefined));
	await askClaude('asked', { prompt: 'make the frog blue' });
	expect(answers).toEqual([{ question: 'What next?', key: '3', text: 'make the frog blue' }]);
	expect((await inboxFile(dir)).asked.queue).toEqual([]);

	// A permission prompt takes no words: the message waits
	delete asking.typing;
	await askClaude('asked', { prompt: 'and bigger' });
	expect(answers).toHaveLength(1);
	expect((await inboxFile(dir)).asked.queue).toEqual([{ prompt: 'and bigger' }]);
	await initClaudeInbox(dir, () => undefined);
});

test("a message waiting for Claude's prompt box is handed on to the next server, which types it in and waits for its answer", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'inbox-'));
	const typed = [];
	// Claude's box isn't on the screen yet, so the message waits; then the server restarts
	const noBox = { promptDraft: () => null, typeIn: () => {} };
	const box = { promptDraft: () => '', typeIn: data => typed.push(data) };

	await initClaudeInbox(dir, id => (id === 'held' ? noBox : undefined));
	await askClaude('held', { prompt: 'carry on', to: { commentId: 'c1' } });
	expect(await inboxFile(dir)).toEqual({
		held: { queue: [{ prompt: 'carry on', to: { commentId: 'c1' } }], asked: [] },
	});

	await initClaudeInbox(dir, id => (id === 'held' ? box : undefined));
	expect(typed[0]).toContain('carry on');

	const { held } = await inboxFile(dir);

	expect(held.queue).toEqual([]);
	expect(held.asked.map(({ prompt, to }) => ({ prompt, to }))).toEqual([
		{ prompt: 'carry on', to: { commentId: 'c1' } },
	]);
	// One for a session the next server doesn't have is let go
	await initClaudeInbox(dir, () => undefined);
	expect(await inboxFile(dir)).toEqual({});
});
