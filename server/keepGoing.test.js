import { afterAll, expect, test } from 'bun:test';

import { MOST_IDLE, MOST_NUDGES, holdBefore, keepGoing, promptFor, settledSoFar } from './keepGoing';
import { claudeActive, isNudge, keepWarm, nudgeWith, warmUntil } from './keepWarm';

const NUDGE = nudgeWith('');

const ids = ['going', 'only-warm', 'typing', 'held', 'gone', 'no'];

afterAll(() => Promise.all(ids.map(id => keepWarm(id, 0))));

const fakeSession = () => {
	const session = { busy: false, draft: '', typed: [], cwd: '/work' };

	session.promptDraft = () => session.draft;
	session.typeIn = data => session.typed.push(data);

	return session;
};

const turn = (prompt, acted = true, said = '') => ({
	prompt,
	asked: prompt,
	said,
	steps: acted ? [{ summary: 'Read a file' }, { summary: 'Ran the tests' }, { summary: 'Edited a file' }] : [],
});
const going = (session, turns = [turn('fix the build')], decisions = []) => ({
	sessionOf: () => session,
	turnsOf: async () => turns,
	decisionsOf: async () => ({ decisions }),
});
const says = answer => async () => answer;

test('a session that keeps going is told what Haiku says to do next', async () => {
	const session = fakeSession();

	await keepWarm('going', 12, Date.now(), { going: true });

	expect(
		await keepGoing('going', 'Not done: items 6 and 9.', {
			...going(session),
			ask: says('{"go": true, "next": "Do item 6, then item 9."}'),
		}),
	).toBe(true);
	expect(session.typed[0]).toContain('check it against what you know before following it: Do item 6, then item 9.');
});

test('without an answer from Haiku it still carries on toward the goal', async () => {
	const session = fakeSession();

	await keepWarm('going', 12, Date.now(), { going: true });
	expect(await keepGoing('going', 'Done.', { ...going(session), ask: says('') })).toBe(true);
	expect(session.typed[0]).toContain('carry on toward what the person asked for');
	expect(session.typed[0]).not.toContain('A suggestion');
});

test('it waits only when Haiku finds nothing left that needs nothing from the person, and not when only kept warm', async () => {
	const session = fakeSession();

	await keepWarm('no', 12, Date.now(), { going: true });
	expect(
		await keepGoing('no', 'Push it?', { ...going(session), ask: says('{"go": false, "why": "only a push is left"}') }),
	).toBe(false);

	await keepWarm('only-warm', 12);
	expect(await keepGoing('only-warm', 'Next I would…', { ...going(session), ask: says('{"go": true}') })).toBe(false);
	expect(session.typed).toEqual([]);
});

test('someone typing, or the session switched off while Haiku thinks, keeps the nudge out', async () => {
	const session = fakeSession();

	await keepWarm('typing', 12, Date.now(), { going: true });
	session.draft = 'actually, wa';
	expect(await keepGoing('typing', 'Next I would…', { ...going(session), ask: says('{"go": true}') })).toBe(false);

	session.draft = '';
	const switchedOff = async () => {
		await keepWarm('typing', 0);

		return '{"go": true}';
	};

	expect(await keepGoing('typing', 'Next I would…', { ...going(session), ask: switchedOff })).toBe(false);
	expect(session.typed).toEqual([]);
});

test('a run of nudges stops at its cap, or once nudged turns stop changing anything, without asking Haiku', async () => {
	const session = fakeSession();
	let asked = 0;
	const ask = async () => {
		asked += 1;

		return '{"go": true}';
	};

	await keepWarm('held', 12, Date.now(), { going: true });
	const capped = [turn('fix the build'), ...Array.from({ length: MOST_NUDGES }, () => turn(NUDGE))];
	// A turn that only read or tested still did something; one that used no tool at all only talked
	const idle = [turn('fix the build'), turn(NUDGE), ...Array.from({ length: MOST_IDLE }, () => turn(NUDGE, false))];

	expect(await keepGoing('held', 'Next I would…', { ...going(session, capped), ask })).toBe(false);
	expect(await keepGoing('held', 'Next I would…', { ...going(session, idle), ask })).toBe(false);
	expect(asked).toBe(0);
});

test("the run counts from the person's last prompt, past keep-warm pings", () => {
	const nudges = Array.from({ length: MOST_NUDGES - 1 }, () => turn(NUDGE));

	expect(holdBefore([...nudges, turn('keep-warm ping from paude'), turn('do the rest'), turn(NUDGE)])).toBeNull();
	expect(holdBefore([turn('fix it'), ...nudges, turn('keep-warm ping from paude'), turn(NUDGE)])).toContain('in a row');
	expect(holdBefore([turn('fix it'), turn(NUDGE, false), turn('look again'), turn(NUDGE, false)])).toBeNull();
});

test("a session no longer running isn't nudged", async () => {
	await keepWarm('gone', 12, Date.now(), { going: true });
	expect(await keepGoing('gone', 'Next I would…', { sessionOf: () => undefined, ask: says('{"go": true}') })).toBe(
		false,
	);
});

test("a nudge is paude's: known as one, and it doesn't move the hours a session is kept warm", async () => {
	const now = Date.now();

	expect(isNudge(NUDGE)).toBe(true);
	expect(isNudge('keep going')).toBe(false);
	await keepWarm('going', 1, now, { going: true });
	claudeActive('going', { hook_event_name: 'UserPromptSubmit', prompt: NUDGE }, now + 30 * 60 * 1000);
	expect(warmUntil('going', now)).toBe(now + 60 * 60 * 1000);
});

test("Haiku is shown what the person asked and the reply's end", () => {
	const prompt = promptFor(`${'x'.repeat(10_000)}I'd take those next.`, ['make the ship smaller', 'keep going']);

	expect(prompt).toContain('<asked>\nmake the ship smaller\n</asked>\n<asked>\nkeep going\n</asked>');
	expect(prompt).toContain("I'd take those next.");
	expect(prompt.length).toBeLessThan(8000);
});

test('a nudge is known as one inside the tags Claude Code keeps a long paste in', () => {
	expect(isNudge(`<pasted_content id="acaa">\n${NUDGE}\n</pasted_content>`)).toBe(true);
});

test("Haiku is shown how the run's earlier turns ended, and a turn that did next to nothing counts as idle", async () => {
	const session = fakeSession();
	let prompt = '';

	await keepWarm('going', 12, Date.now(), { going: true });
	await keepGoing('going', 'The islands are done.', {
		...going(session, [turn('cans and islands', true, 'The cans are done and tested.'), turn(NUDGE)]),
		ask: async text => {
			prompt = text;

			return '{"go": false}';
		},
	});
	expect(prompt).toContain('<earlier>\nAfter the person asked: The cans are done and tested.\n</earlier>');

	const slight = { prompt: NUDGE, asked: NUDGE, steps: [{ summary: 'Read a file' }] };

	expect(holdBefore([turn('fix it'), slight, slight])).toContain('next to nothing');
});

test('Haiku is shown what the session settled: work put off and questions for the person first, set-aside ones not at all', async () => {
	const decisions = [
		{ kind: 'decision', chose: 'The bridge toggles any engine.', rejected: 'Only projects.' },
		{ kind: 'finding', chose: 'The terminal scales to fit.', dismissed: true },
		{ kind: 'deferred', chose: 'Resizing the side panel, for later.' },
		{ kind: 'decision', chose: 'Credit waits for running commands.', question: 'Hold credit until they end?' },
	];

	expect(settledSoFar(decisions)).toEqual([
		'Decided: The bridge toggles any engine. Rejected: Only projects.',
		'Put off: Resizing the side panel, for later.',
		'Waiting on the person: Hold credit until they end? (about: Credit waits for running commands.)',
	]);

	const many = Array.from({ length: 20 }, (_, index) => ({ kind: 'decision', chose: `Decision ${index}.` }));

	expect(settledSoFar([...many, decisions[2]])).toContain('Put off: Resizing the side panel, for later.');
	expect(settledSoFar([...many, decisions[2]])).toHaveLength(12);

	const session = fakeSession();
	let prompt = '';

	await keepWarm('going', 12, Date.now(), { going: true });
	await keepGoing('going', 'The bridge is done.', {
		...going(session, [turn('build the bridge')], decisions),
		ask: async text => {
			prompt = text;

			return '{"go": false}';
		},
	});
	expect(prompt).toContain('<settled>\nPut off: Resizing the side panel, for later.\n</settled>');
	expect(prompt).not.toContain('The terminal scales to fit.');
});

test('a turn end a Stop hook turned back is answered only by the turn end after it', async () => {
	const session = fakeSession();
	let answer;
	const first = new Promise(resolve => {
		answer = resolve;
	});

	await keepWarm('going', 12, Date.now(), { going: true });

	const blocked = keepGoing('going', 'Done.', { ...going(session), ask: () => first });

	expect(
		await keepGoing('going', 'Filed it.', { ...going(session), ask: says('{"go": true, "next": "Check it."}') }),
	).toBe(true);
	answer('{"go": true, "next": "File the README."}');
	expect(await blocked).toBe(false);
	expect(session.typed).toHaveLength(1);
	expect(session.typed[0]).toContain('Check it.');
});

test("work put off before the person's last few prompts isn't shown, since nothing marks it done once it is; a question for them always is", async () => {
	const turns = [
		{ ...turn('prune the client', true, 'Pruned it all.'), id: 'old' },
		...['a', 'b', 'c', 'd'].map(id => ({ ...turn(`ask ${id}`, true, `Did ${id}.`), id })),
	];
	const decisions = [
		{ turnId: 'old', kind: 'deferred', chose: 'The pruning pass, for later.' },
		{ turnId: 'old', kind: 'decision', chose: 'Hold credit?', question: 'Hold credit until commands end?' },
		{ turnId: 'c', kind: 'deferred', chose: 'Splitting ship.js, for later.' },
	];
	let prompt = '';

	await keepWarm('going', 12, Date.now(), { going: true });
	await keepGoing('going', 'Did d.', {
		...going(fakeSession(), turns, decisions),
		ask: async text => {
			prompt = text;

			return '{"go": false}';
		},
	});
	expect(prompt).toContain('Put off: Splitting ship.js, for later.');
	expect(prompt).toContain('Waiting on the person: Hold credit until commands end?');
	expect(prompt).not.toContain('The pruning pass');
	// Earlier turns are shown past the person's last prompt, and a long one by its start and end
	expect(prompt).toContain('After the person asked: Did b.');
	expect(prompt).not.toContain('Pruned it all.');
});

test('the latest reply is shown by its start and its end, where a list of what it did often sits', () => {
	const prompt = promptFor(`Done: the cans and the plates. ${'x'.repeat(10_000)} Left: the walk cycle.`, ['all of it']);

	expect(prompt).toContain('Done: the cans and the plates.');
	expect(prompt).toContain('[...]');
	expect(prompt).toContain('Left: the walk cycle.');
});
