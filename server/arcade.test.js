import { describe, expect, test } from 'bun:test';

import { READING, acceptTrust, arcadeInstructions, claudeSettings, folderName, openingPrompt } from './arcade';

describe('folderName', () => {
	test('is the title as a folder and package name', () => {
		expect(folderName("Ada's Moon Rocks!")).toBe('adas-moon-rocks');
		expect(folderName('   ')).toBe('game');
		expect(folderName('x'.repeat(80)).length).toBeLessThanOrEqual(40);
	});
});

describe('arcadeInstructions', () => {
	test('names who it is for and how they read', () => {
		const text = arcadeInstructions({ title: 'Moon Rocks', player: 'Ada', reading: 'listening' });

		expect(text).toContain('# Building Moon Rocks together');
		expect(text).toContain('with Ada,');
		expect(text).toContain('cannot read yet');
		expect(text).toContain('AskUserQuestion');
	});

	test('has a voice for every reading level', () => {
		for (const reading of Object.keys(READING))
			expect(arcadeInstructions({ title: 'X', player: '', reading })).toContain('## How to write');
	});
});

describe('openingPrompt', () => {
	test('asks Claude to open the conversation about the named game', () => {
		expect(openingPrompt({ title: 'Moon Rocks', player: 'Ada' })).toBe(
			'Say hello to Ada. The game is called "Moon Rocks". Ask what it should be about, offering a few ideas as choices.',
		);
		expect(openingPrompt({ title: 'Moon Rocks' })).toContain('the kid you are building with');
	});
});

const screenOf = lines => ({
	ended: false,
	typed: [],
	lines,
	mirror: {
		buffer: {
			active: {
				get length() {
					return lines.length;
				},
				getLine: y => ({ translateToString: () => lines[y] }),
			},
		},
	},
	typeIn(data) {
		this.typed.push(data);
	},
});

const TRUST = [
	'Quick safety check: Is this a project you created or one you trust?',
	'❯ No, exit',
	'  Yes, I trust this folder',
	'Enter to confirm · Esc to cancel',
];

describe('acceptTrust', () => {
	test('presses Down until the cursor is on Yes, then Enter', async () => {
		const session = screenOf([...TRUST]);

		// The dialog takes the press on the next look, as the real one does
		session.typeIn = data => {
			session.typed.push(data);
			if (data === '\x1b[B') session.lines.splice(1, 2, '  No, exit', '❯ Yes, I trust this folder');
		};
		expect(await acceptTrust(session, { waitMs: 1000, pollMs: 10 })).toBe(true);
		expect(session.typed).toEqual(['\x1b[B', '\r']);
	});

	test('never presses Enter while the cursor sits on No', async () => {
		const session = screenOf([...TRUST]);

		expect(await acceptTrust(session, { waitMs: 300, pollMs: 10 })).toBe(false);
		expect(session.typed).not.toContain('\r');
		expect(session.typed.length).toBeLessThanOrEqual(6);
	});

	test('types nothing into a session that never asks', async () => {
		const session = screenOf(['❯ ', '  ⏵⏵ accept edits on']);

		expect(await acceptTrust(session, { waitMs: 50, pollMs: 10 })).toBe(false);
		expect(session.typed).toEqual([]);
	});
});

describe('claudeSettings', () => {
	test('lets Claude edit the game and run its checks without asking, and nothing wider', () => {
		expect(claudeSettings.permissions.defaultMode).toBe('acceptEdits');
		expect(claudeSettings.permissions.allow).not.toContainEqual(expect.stringMatching(/^Bash\(\*|Bash\(rm|push/));
	});
});
