// A text as it's said and as the arcade shows it, cut the same way on both sides: the server times each word from the
// voice's alignment, the page lights the word with that index.
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
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

// The words of a text, each with where it starts in the text
export const wordsOf = text => {
	const words = [];

	for (const match of text.matchAll(/\S+/g)) words.push({ word: match[0], at: match.index });

	return words;
};

// A text as the arcade shows it: paragraphs of tokens, each a word or one emoji (its own token, however it was
// written), the words being exactly what the voice is given, in order
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
				.map(token => ({ text: token, emoji: token.replace(EMOJI, '') === '' })),
		)
		.filter(paragraph => paragraph.length);
