import { describe, expect, test } from 'bun:test';

import answerInWords from './answerInWords';

// A screen that changes as the keys land, as Claude Code's dialog does: the cursor moves onto the option, the pasted
// words show in it
const sessionWith = (lines, { late = 0 } = {}) => {
	const session = {
		typed: [],
		lines,
		mirror: {
			buffer: {
				active: {
					get length() {
						return session.lines.length;
					},
					getLine: y => ({ translateToString: () => session.lines[y] }),
				},
			},
		},
		typeIn(data) {
			session.typed.push(data);
			setTimeout(() => {
				if (data === '5')
					session.lines = session.lines.map(line => line.replace('  5. Type something.', '❯ 5. Type something.'));
				else if (data.startsWith('\x1b[200~'))
					session.lines = session.lines.map(line => line.replace('Type something.', data.slice(6, -6)));
			}, late);
		},
	};

	return session;
};
const DIALOG = ['What should it be about?', '  1. 🐸 Frogs', '  5. Type something.', 'Enter to select · Esc to cancel'];

describe('answerInWords', () => {
	test('presses the option, pastes once it has opened, and enters once the words show', async () => {
		const session = sessionWith([...DIALOG], { late: 30 });

		expect(await answerInWords(session, '5', 'a purple octopus', { pollMs: 5, waitMs: 500 })).toBe(true);
		expect(session.typed).toEqual(['5', '\x1b[200~a purple octopus\x1b[201~', '\r']);
	});

	test('never pastes into a dialog that did not open its option', async () => {
		const session = sessionWith([...DIALOG]);

		session.typeIn = data => session.typed.push(data);
		expect(await answerInWords(session, '5', 'a purple octopus', { pollMs: 5, waitMs: 60 })).toBe(false);
		expect(session.typed).toEqual(['5']);
	});
});
