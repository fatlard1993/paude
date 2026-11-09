import { describe, expect, test } from 'bun:test';

import { displayTokens, emojiName, spokenText, withoutCues, wordsOf } from './spoken';

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
				{ text: 'Nice!', emoji: false, spoken: 'Nice!' },
				{ text: '🚀', emoji: true, spoken: 'rocket' },
				{ text: 'The', emoji: false, spoken: 'The' },
				{ text: 'rocket', emoji: false, spoken: 'rocket' },
				{ text: 'flies.', emoji: false, spoken: 'flies.' },
			],
			[
				{ text: 'Tap', emoji: false, spoken: 'Tap' },
				{ text: '⭐', emoji: true, spoken: 'star' },
				{ text: 'to', emoji: false, spoken: 'to' },
				{ text: 'go', emoji: false, spoken: 'go' },
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

describe('performance cues', () => {
	test('a cue is one token, shown as what it says and sent to the voice whole, and a link is no cue', () => {
		expect(displayTokens('[laughs] Oh WOW... [whispers softly] nobody saw. Open [the hub](http://x)')).toEqual([
			[
				{ text: 'laughs', emoji: false, cue: true, spoken: '[laughs]' },
				{ text: 'Oh', emoji: false, spoken: 'Oh' },
				{ text: 'WOW...', emoji: false, spoken: 'WOW...' },
				{ text: 'whispers softly', emoji: false, cue: true, spoken: '[whispers softly]' },
				{ text: 'nobody', emoji: false, spoken: 'nobody' },
				{ text: 'saw.', emoji: false, spoken: 'saw.' },
				{ text: 'Open', emoji: false, spoken: 'Open' },
				{ text: 'the', emoji: false, spoken: 'the' },
				{ text: 'hub', emoji: false, spoken: 'hub' },
			],
		]);
	});

	test('a voice that would read cues out gets them blanked, every word still where it was', () => {
		const text = '[laughs] You did it! [explosion]';

		expect(withoutCues(text).trim()).toBe('You did it!');
		expect(withoutCues(text)).toHaveLength(text.length);
		expect(withoutCues(text).indexOf('You')).toBe(text.indexOf('You'));
	});
});

describe('emojiName', () => {
	test('names an emoji as a voice should say it, dressed or joined or not', () => {
		expect(emojiName('🚀')).toBe('rocket');
		expect(emojiName('⭐')).toBe('star');
		expect(emojiName('❤️')).toBe('heart');
		expect(emojiName('👍🏽')).toBe('thumbs up');
		expect(emojiName('👩‍🚀')).toBe('astronaut');
		expect(emojiName('👩‍🎤')).toMatch(/woman/);
		expect(emojiName('🧀')).toBe('cheese wedge');
		expect(emojiName('x')).toBe('');
	});
});
