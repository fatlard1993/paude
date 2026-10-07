import { expect, test } from 'bun:test';

import { answerTo } from './claudeInbox';

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
