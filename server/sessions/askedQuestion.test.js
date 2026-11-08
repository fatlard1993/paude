import { describe, expect, test } from 'bun:test';

import { cleanedAsking, pendingQuestion } from './askedQuestion';

const asked = {
	id: 'q1',
	name: 'AskUserQuestion',
	input: {
		questions: [
			{
				header: 'Next',
				question: 'What should happen next in the sand game?',
				options: [
					{ label: '💡 Hints on new things', description: 'A picture hint the first time something new shows up.' },
					{
						label: '🏆 Everything last level',
						description: 'Add mixing, sieves, dirt and water to the big last level.',
					},
				],
			},
		],
	},
};
const lines = [
	{ type: 'user', message: { content: 'make it fun' } },
	{
		type: 'assistant',
		message: {
			content: [
				{ type: 'text', text: 'Sure.' },
				{ type: 'tool_use', ...asked },
			],
		},
	},
];
const screen = {
	title: '☐ Next',
	details: [],
	question: 'What should happen next in the sand game?',
	options: [
		{ key: '1', label: '💡Hints on new thingsy', detail: 'A picture hint the first time something new shows up.' },
		{ key: '2', label: '🏆Eeverything last level', detail: 'Add mixing, sieves, dirt and water to the big last' },
	],
	typing: '5',
};

describe('pendingQuestion', () => {
	test('is the last question asked that has no answer yet', () => {
		expect(pendingQuestion(lines)).toEqual(asked.input);
		expect(
			pendingQuestion([
				...lines,
				{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'answered' }] } },
			]),
		).toBeNull();
	});
});

describe('cleanedAsking', () => {
	test("takes the labels and details as Claude wrote them, and keeps the screen's question as the key", () => {
		const cleaned = cleanedAsking(screen, asked.input);

		expect(cleaned.options.map(({ label }) => label)).toEqual(['💡 Hints on new things', '🏆 Everything last level']);
		expect(cleaned.options[1].detail).toBe('Add mixing, sieves, dirt and water to the big last level.');
		expect(cleaned.options[1].key).toBe('2');
		expect(cleaned.question).toBe(screen.question);
		expect(cleaned.typing).toBe('5');
	});

	test('leaves the screen alone when the options do not line up, or there is no question', () => {
		expect(cleanedAsking({ ...screen, options: screen.options.slice(0, 1) }, asked.input)).toEqual({
			...screen,
			options: screen.options.slice(0, 1),
		});
		expect(cleanedAsking(screen, null)).toEqual(screen);
	});
});
