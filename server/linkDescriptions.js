import describer, { parseDescriptions } from './describer';

export { parseDescriptions };

// A link's description, written by Haiku from what was said around it, kept by its address
export const describePrompt = links =>
	[
		'Each link below came up in a conversation with a coding assistant. For each, write what it is and why it came up, in at most 12 words.',
		'Plain words: no URL, no domain name, no quotes, no trailing period. When nothing says why, say what the page itself is.',
		'Reply with only a JSON object from each number to its description, like {"1": "…", "2": "…"}.',
		links
			.map((link, index) =>
				[
					`${index + 1}. ${link.url}`,
					link.title && `   Called: ${link.title}`,
					link.turn && `   Asked at the time: ${link.turn}`,
					...link.passages.map(passage => `   Said around it: ${passage}`),
				]
					.filter(Boolean)
					.join('\n'),
			)
			.join('\n\n'),
	].join('\n\n');

const links = describer({
	fileName: 'link-descriptions.json',
	keyOf: link => link.url,
	promptFor: describePrompt,
	// What the panel shows first goes first: what someone mentioned, the latest; what only a command printed, last
	sooner: (a, b) => b.mentioned - a.mentioned || String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')),
	describable: link => link.passages?.length > 0,
});

export const initLinkDescriptions = links.init;
export const descriptionOf = links.descriptionOf;
export const describingOf = links.describingOf;
// { url, title, turn, passages, mentioned, lastAt }
export const describeLinks = links.describe;
