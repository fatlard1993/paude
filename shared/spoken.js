import EMOJI_NAMES from './emojiNames';

// A text as it's said and as the arcade shows it, cut the same way on both sides: the server times each word from the
// voice's alignment, the page lights the word with that index.
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
// What's taken off an emoji before it's looked up: variation selectors, skin tones, and the rest of a joined sequence
const DRESSING = /\u{FE0E}|\u{FE0F}|[\u{1F3FB}-\u{1F3FF}]/gu;
const EMOJI_RUN = /\p{Extended_Pictographic}\u{FE0F}?(?:\u{200D}\p{Extended_Pictographic}\u{FE0F}?)*/gu;
const MARKS = /[*_`#>~]+/g;

// A text as it should be heard: no markdown's marks, no emoji (a voice names them), links as their words
export const spokenText = text =>
	String(text ?? '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/```[\s\S]*?```/g, ' code ')
		.replace(MARKS, '')
		.replace(EMOJI, '')
		.replace(/\s+/g, ' ')
		.trim();

// What a voice says for an emoji (a voice given the emoji itself says nothing): its name, short, or '' for one with
// none. A joined sequence (a family, a woman astronaut) goes by its first part.
export const emojiName = emoji => {
	const whole = String(emoji).replace(DRESSING, '');
	const base = whole.split('\u200D')[0];

	return EMOJI_NAMES[whole] ?? EMOJI_NAMES[base] ?? EMOJI_NAMES[[...base][0]] ?? '';
};

// The words of a text, each with where it starts in the text
export const wordsOf = text => {
	const words = [];

	for (const match of text.matchAll(/\S+/g)) words.push({ word: match[0], at: match.index });

	return words;
};

// A text as the arcade shows it: paragraphs of tokens, each a word or one emoji (its own token, however it was
// written), with what the voice says for each (`spoken`: the word, or the emoji's name in a word or a few, or '' for
// an emoji with none), so the tokens spoken, in order, are the voice's words
export const displayTokens = text =>
	String(text ?? '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/```[\s\S]*?```/g, ' code ')
		.replace(MARKS, '')
		.split(/\n\s*\n/)
		.map(paragraph =>
			paragraph
				.replace(EMOJI_RUN, ' $& ')
				.split(/\s+/)
				.filter(Boolean)
				.map(token => {
					const emoji = token.replace(EMOJI, '') === '';

					return { text: token, emoji, spoken: emoji ? emojiName(token) : token };
				}),
		)
		.filter(paragraph => paragraph.length);
