import { describe, expect, test } from 'bun:test';

import { displayTokens, spokenText, wordsOf } from './spoken';

describe('spokenText', () => {
	test('drops what a voice would stumble on', () => {
		expect(spokenText('**Nice!** 🚀 The rocket *flies* now. See `Play.js`')).toBe(
			'Nice! The rocket flies now. See Play.js',
		);
		expect(spokenText('Open [the hub](http://x/#/hub) and tap ⭐')).toBe('Open the hub and tap');
	});
});

describe('wordsOf', () => {
	test('gives each word with where it starts', () => {
		expect(wordsOf('Tap the star')).toEqual([
			{ word: 'Tap', at: 0 },
			{ word: 'the', at: 4 },
			{ word: 'star', at: 8 },
		]);
	});
});

describe('displayTokens', () => {
	test('keeps emoji as tokens of their own and the words as spoken', () => {
		const paragraphs = displayTokens('**Nice!**🚀 The rocket flies.\n\nTap ⭐ to go');

		expect(paragraphs).toEqual([
			[
				{ text: 'Nice!', emoji: false },
				{ text: '🚀', emoji: true },
				{ text: 'The', emoji: false },
				{ text: 'rocket', emoji: false },
				{ text: 'flies.', emoji: false },
			],
			[
				{ text: 'Tap', emoji: false },
				{ text: '⭐', emoji: true },
				{ text: 'to', emoji: false },
				{ text: 'go', emoji: false },
			],
		]);
		expect(
			paragraphs
				.flat()
				.filter(token => !token.emoji)
				.map(token => token.text)
				.join(' '),
		).toBe(spokenText('**Nice!**🚀 The rocket flies.\n\nTap ⭐ to go'));
	});
});
