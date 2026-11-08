import { lastLines } from '../timeline';
import { transcriptFile } from './transcript';

// What Claude asked, as Claude wrote it. A question read off the screen carries the terminal's leftovers around
// double-width emoji ("Eeverything", "thingsy"), and the screen wraps long lines; the AskUserQuestion call in the
// transcript has every label and description exactly, so a question for the player takes its words from there. The
// screen's own question text stays as the key an answer is checked against.
const TAIL_BYTES = 512 * 1024;

// The last AskUserQuestion Claude made that has no answer yet, from a transcript's parsed lines: its input, or null
export const pendingQuestion = lines => {
	let pending = null;

	for (const line of lines) {
		if (line.type === 'assistant')
			for (const block of line.message?.content ?? [])
				if (block.type === 'tool_use' && block.name === 'AskUserQuestion')
					pending = { id: block.id, input: block.input };
		if (line.type === 'user' && Array.isArray(line.message?.content))
			for (const block of line.message.content)
				if (block.type === 'tool_result' && block.tool_use_id === pending?.id) pending = null;
	}

	return pending?.input ?? null;
};

// The screen's asking with the words of the call's question that matches it (by its header, or the only one), when
// the options line up: `questionText` as written, each option's label and detail as written
export const cleanedAsking = (asking, input) => {
	const questions = Array.isArray(input?.questions) ? input.questions : [];
	const header = String(asking.title ?? '')
		.replace(/^[☐☑]\s*/, '')
		.trim();
	const question = questions.find(each => each.header === header) ?? (questions.length === 1 ? questions[0] : null);

	if (!question || !Array.isArray(question.options) || question.options.length !== asking.options.length) return asking;

	return {
		...asking,
		questionText: question.question || asking.question,
		options: asking.options.map((option, index) => ({
			...option,
			label: question.options[index]?.label || option.label,
			detail: question.options[index]?.description || option.detail,
		})),
	};
};

// A question for the player (its header a checkbox), with its words from the transcript when they're there
export const askingAsWritten = async (asking, id, cwd) => {
	if (!asking || !/^[☐☑]/.test(asking.title)) return asking;

	const file = await transcriptFile(id, cwd).catch(() => null);

	if (!file) return asking;

	return cleanedAsking(asking, pendingQuestion(await lastLines(file, TAIL_BYTES)));
};
