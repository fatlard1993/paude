import describer from './describer';

// An artifact's description, written by Haiku from what was said as it was made and, for a text file, how it begins;
// kept by its path
const HEAD_BYTES = 600;
const HEAD_LINES = 12;
const TEXT_KINDS = new Set(['script', 'data', 'page']);
const TEXT_DOC = /\.(md|txt)$/i;

const headOf = async artifact => {
	if (!TEXT_KINDS.has(artifact.kind) && !TEXT_DOC.test(artifact.path)) return '';

	const text = await Bun.file(artifact.path)
		.slice(0, HEAD_BYTES)
		.text()
		.catch(() => '');

	return text.split('\n').slice(0, HEAD_LINES).join('\n').trim();
};

export const describeArtifactsPrompt = async artifacts =>
	[
		'Each file below was made or looked at during a conversation with a coding assistant. For each, write what it is and what it was for, in at most 12 words.',
		'Plain words: no path, no file name, no quotes, no trailing period.',
		'Reply with only a JSON object from each number to its description, like {"1": "…", "2": "…"}.',
		(
			await Promise.all(
				artifacts.map(async (artifact, index) => {
					const head = await headOf(artifact);

					return [
						`${index + 1}. ${artifact.shown ?? artifact.path} (${artifact.kind})`,
						artifact.turn && `   Asked at the time: ${artifact.turn}`,
						artifact.why && `   Said as it was made: ${artifact.why}`,
						head && `   It begins:\n${head.replace(/^/gm, '      ')}`,
					]
						.filter(Boolean)
						.join('\n');
				}),
			)
		).join('\n\n'),
	].join('\n\n');

const artifacts = describer({
	fileName: 'artifact-descriptions.json',
	keyOf: artifact => artifact.path,
	promptFor: describeArtifactsPrompt,
	// The newest first: what the panel shows at the top
	sooner: (a, b) => b.modifiedAt - a.modifiedAt,
});

export const initArtifactDescriptions = artifacts.init;
export const artifactDescriptionOf = artifacts.descriptionOf;
export const describingArtifact = artifacts.describingOf;
export const describeArtifacts = artifacts.describe;
