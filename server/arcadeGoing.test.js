import { expect, test } from 'bun:test';

import {
	HOUSEKEEPING,
	HOUSEKEEPING_EVERY,
	PICKED_MARK,
	answerFor,
	keepArcadeGoing,
	noteArcadeAnswer,
} from './arcadeGoing';
import { keepWarm, stopKeepingWarm } from './keepWarm';

const asked = {
	question: 'What should happen next?',
	options: [
		{ label: '🚀 Boost pads', description: 'Pads that fling you forward.' },
		{ label: '🏁 More tracks', description: 'Two new tracks.' },
	],
};
const input = { questions: [{ question: asked.question, options: asked.options }] };
const saying = verdict => async () => JSON.stringify(verdict);

test("Haiku's pick is answered, marked as paude's, with keeping house asked for alongside", async () => {
	const answer = await answerFor(asked, 0, saying({ pick: 2, why: 'more to race on' }));

	expect(answer.words).toStartWith(`${PICKED_MARK}: 🏁 More tracks. Two new tracks.`);
	expect(answer.words).toContain('README.md and IDEA.md');
});

test('every few answers in a row is a housekeeping pass; nothing picked when Haiku says none should be', async () => {
	expect((await answerFor(asked, HOUSEKEEPING_EVERY, saying({ pick: 1 }))).words).toBe(HOUSEKEEPING);
	expect(await answerFor(asked, 1, saying({ pick: 0, why: 'it asks for a name' }))).toBeNull();
	// Haiku silent: the first choice, which goes on with the game
	expect((await answerFor(asked, 1, async () => '')).words).toContain('🚀 Boost pads');
});

test('a question left unanswered while the session keeps going is answered for them; one someone answers is left', async () => {
	const answered = [];
	let question = asked.question;
	const session = {
		asking: () => (question ? { question, typing: '3', options: [] } : null),
		answer: (...args) => answered.push(args) > 0,
	};
	const options = { sessionOf: () => session, ask: saying({ pick: 1 }), pause: async () => {}, waitMs: 4000 };

	expect(await keepArcadeGoing('away', input, options)).toBe(false);
	await keepWarm('away', 12, Date.now(), { going: true });
	expect(await keepArcadeGoing('away', input, options)).toBe(true);
	expect(answered[0].slice(0, 2)).toEqual([asked.question, '3']);
	noteArcadeAnswer('away', { answers: { [asked.question]: answered[0][2] } });

	question = null;
	expect(await keepArcadeGoing('away', input, options)).toBe(false);
	await stopKeepingWarm('away');
});
