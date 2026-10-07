import { expect, test } from 'bun:test';
import xterm from '@xterm/headless';

import promptDraft from './promptBox';

// Real Claude Code screens at 100x30: its prompt box empty (showing its placeholder), with a draft, and with two lines
const screen = async name => {
	const terminal = new xterm.Terminal({ cols: 100, rows: 30, allowProposedApi: true });
	const bytes = new Uint8Array(await Bun.file(`${import.meta.dir}/fixtures/prompt-${name}.bin`).arrayBuffer());

	await new Promise(done => terminal.write(bytes, done));

	return terminal.buffer.active;
};

test("reads what's typed in Claude's prompt box, its placeholder as nothing", async () => {
	expect(promptDraft(await screen('empty'))).toBe('');
	expect(promptDraft(await screen('draft'))).toBe('half typed draft');
	expect(promptDraft(await screen('multiline'))).toBe('line one\nline two');
});

test('no prompt box on the screen is null', async () => {
	const terminal = new xterm.Terminal({ cols: 40, rows: 6, allowProposedApi: true });

	await new Promise(done => terminal.write('Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n', done));
	expect(promptDraft(terminal.buffer.active)).toBeNull();
});
