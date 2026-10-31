import { expect, test } from 'bun:test';
import xterm from '@xterm/headless';

import { SHADES } from '../../shared/glimpse';
import { glimpse } from './glimpse';

const screen = async (text, { cols = 20, rows = 6 } = {}) => {
	const terminal = new xterm.Terminal({ cols, rows, allowProposedApi: true });

	await new Promise(done => terminal.write(text, done));

	return glimpse(terminal.buffer.active, rows);
};

test('a screen as dots of its colors, blank where nothing is printed, down to its last printed row', async () => {
	const { lines } = await screen('\x1b[38;2;255;0;0mab\x1b[0m c\r\n\r\n\x1b[48;2;0;255;0m  \x1b[0m\r\n\r\n');
	const red = SHADES[0b110000];
	const plain = SHADES[0b101010];
	const green = SHADES[0b001100];

	expect(lines).toEqual([`${red}${red} ${plain}`, '', `${green}${green}`]);
});

test("only a screen's last rows are kept", async () => {
	const { lines } = await screen(Array.from({ length: 40 }, (_, row) => `row ${row}`).join('\r\n'), { rows: 40 });

	expect(lines).toHaveLength(24);
});
