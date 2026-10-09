import { expect, test } from 'bun:test';

import readDialog from './dialog';

const COLS = 100;
const RULE = '─'.repeat(COLS);
const DASHES = '╌'.repeat(COLS);

const screen = lines => ({
	length: lines.length,
	getLine: y => (y < lines.length ? { translateToString: () => lines[y] } : undefined),
});

test('a permission prompt: its title, what it would run, the question and each answer', () => {
	const dialog = readDialog(
		screen([
			'❯ Run the bash command: date +%s > stamp.txt',
			'● Writing current Unix timestamp to stamp.txt',
			RULE,
			' Bash command',
			' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
			' Write current Unix timestamp to stamp.txt',
			DASHES,
			' date +%s > stamp.txt',
			DASHES,
			' Do you want to proceed?',
			' ❯ 1. Yes',
			'   2. Yes, and always allow access to /tmp/claude-1000/-home-chase-Projects-dotfiles/f9ac9122-7c3c-4',
			'      84e-9cae-13db3fad2053/scratchpad/sel/work from this project',
			'   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
			'   4. No',
			' Esc to cancel · Tab to amend',
		]),
		COLS,
	);

	expect(dialog).toEqual({
		title: 'Bash command',
		details: ['Write current Unix timestamp to stamp.txt', 'date +%s > stamp.txt'],
		question: 'Do you want to proceed?',
		options: [
			{ key: '1', label: 'Yes', detail: '' },
			{
				key: '2',
				label:
					'Yes, and always allow access to /tmp/claude-1000/-home-chase-Projects-dotfiles/f9ac9122-7c3c-484e-9cae-13db3fad2053/scratchpad/sel/work from this project',
				detail: '',
			},
			{ key: '3', label: 'Yes, and switch to auto mode · auto mode handles these prompts for you', detail: '' },
			{ key: '4', label: 'No', detail: '' },
		],
	});
});

test('a question Claude asks: each option with what it says, and none that has to be typed', () => {
	const dialog = readDialog(
		screen([
			'❯ Use the AskUserQuestion tool to ask me one question',
			RULE,
			' ☐ Color',
			'Which color do you prefer, red or blue?',
			'❯ 1. Red',
			'     Choose red.',
			'  2. Blue',
			'     Choose blue.',
			'  3. Type something.',
			RULE,
			'  4. Chat about this',
			'Enter to select · ↑/↓ to navigate · Esc to cancel',
		]),
		COLS,
	);

	expect(dialog).toEqual({
		title: '☐ Color',
		details: [],
		question: 'Which color do you prefer, red or blue?',
		options: [
			{ key: '1', label: 'Red', detail: 'Choose red.' },
			{ key: '2', label: 'Blue', detail: 'Choose blue.' },
		],
	});
});

test('the prompt box, with no dialog, is nothing', () => {
	expect(readDialog(screen(['● done', RULE, '❯ ', RULE, '  ⏵⏵ auto mode on']), COLS)).toBeNull();
});
