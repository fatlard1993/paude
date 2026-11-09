import { afterAll, expect, test } from 'bun:test';

import { MOST_IDLE as FABLED_IDLE, MOST_NUDGES as FABLED_NUDGES } from './fabled';
import {
	MOST_IDLE,
	MOST_MISSED,
	MOST_NUDGES,
	beginHandover,
	holdBefore,
	keepGoing,
	promptFor,
	resumeKeepingGoing,
	settledSoFar,
	takeHandover,
} from './keepGoing';
import {
	askingSessions,
	claudeActive,
	isNudge,
	keepWarm,
	monitorOf,
	noteAsking,
	noteMonitor,
	nudgeWith,
	warmUntil,
} from './keepWarm';

const NUDGE = nudgeWith('');

const ids = [
	'going',
	'only-warm',
	'typing',
	'held',
	'gone',
	'no',
	'hooks',
	'thoughts',
	'fabled',
	'lost',
	'room',
	'resumed',
	'resumed-fabled',
];

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
// A monitor's answer, as askMonitor reports one
const verdict = (answer, outcome = {}) => ({
	answer,
	delivered: true,
	resumable: true,
	usage: { turns: 1, cacheRead: 0, cacheWrite: 0, input: 0, output: 0, cost: 0, ms: 0 },
	why: '',
	...outcome,
});

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

test("a nudge Haiku answers while the turn's other Stop hooks still run waits for Claude to finish its turn", async () => {
	const session = fakeSession();
	let pauses = 0;

	await keepWarm('hooks', 12, Date.now(), { going: true });
	session.busy = true;
	expect(
		await keepGoing('hooks', 'Done.', {
			...going(session),
			ask: says('{"go": true, "next": "Check it."}'),
			pause: async () => {
				pauses += 1;
				session.busy = pauses < 3;
			},
		}),
	).toBe(true);
	expect(session.typed[0]).toContain('Check it.');

	// Its title goes idle before its prompt box is drawn back
	const redrawing = fakeSession();

	redrawing.draft = null;
	expect(
		await keepGoing('hooks', 'Done.', {
			...going(redrawing),
			ask: says('{"go": true, "next": "Check it."}'),
			pause: async () => {
				redrawing.draft = '';
			},
		}),
	).toBe(true);
	expect(redrawing.typed[0]).toContain('Check it.');

	const stuck = fakeSession();

	stuck.busy = true;
	expect(await keepGoing('hooks', 'Done.', { ...going(stuck), ask: says('{"go": true}'), pause: async () => {} })).toBe(
		false,
	);
	expect(stuck.typed).toEqual([]);
});

test('a nudge waiting on a busy Claude gives way to the turn end after it', async () => {
	const session = fakeSession();
	let later;

	await keepWarm('hooks', 12, Date.now(), { going: true });
	session.busy = true;

	const waiting = keepGoing('hooks', 'Done.', {
		...going(session),
		ask: says('{"go": true, "next": "Stale."}'),
		pause: async () => {
			if (!later) {
				session.busy = false;
				later = keepGoing('hooks', 'Filed it.', { ...going(session), ask: says('{"go": true, "next": "Fresh."}') });
				await later;
			}
		},
	});

	expect(await waiting).toBe(false);
	expect(await later).toBe(true);
	expect(session.typed).toHaveLength(1);
	expect(session.typed[0]).toContain('Fresh.');
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

test('thoughts the person drops in while Claude works are asks Haiku is shown, in order, and count as them speaking', async () => {
	const nudged = { ...turn(NUDGE), added: ['the fuel tank would look better inside', 'cards should show staleness'] };
	const turns = [turn('fix the hull'), turn(NUDGE, false), turn(NUDGE, false), nudged];
	let prompt = '';

	// Two idle nudges in a row would hold it, but the person spoke since
	expect(holdBefore(turns)).toBeNull();
	await keepWarm('thoughts', 12, Date.now(), { going: true });
	await keepGoing('thoughts', 'Did the hull.', {
		...going(fakeSession(), turns),
		ask: async text => {
			prompt = text;

			return '{"go": false}';
		},
	});
	expect(prompt).toContain(
		'<asked>\nfix the hull\n</asked>\n<asked>\n(added while Claude worked) the fuel tank would look better inside\n</asked>\n<asked>\n(added while Claude worked) cards should show staleness\n</asked>',
	);
	expect(prompt).not.toContain(`<asked>\n${NUDGE}`);
});

test('a fabled session asks its monitor: briefed on the run at its first look, told only what happened since after', async () => {
	const session = fakeSession();
	const asked = [];
	const askMonitor = async (monitor, cwd, prompt, { first }) => {
		asked.push({ monitor, cwd, prompt, first });

		return verdict('{"go": true, "next": "Check the diff."}');
	};
	const turns = [{ ...turn('fix the build'), id: 't1' }];

	await keepWarm('fabled', 24, Date.now(), { fabled: true });
	expect(await keepGoing('fabled', 'Fixed it.', { ...going(session, turns), askMonitor, ask: says('') })).toBe(true);
	expect(asked[0]).toMatchObject({ first: true, cwd: '/work', monitor: monitorOf('fabled').monitor });
	expect(asked[0].prompt).toContain('<asked>\nfix the build\n</asked>');
	expect(asked[0].prompt).toContain('Fixed it.');
	expect(session.typed[0]).toContain(
		'a monitor that has followed this run and read the repository; weigh it against what you know before following it: Check the diff.',
	);
	expect(monitorOf('fabled').seen).toBe('t1');

	const later = [
		...turns,
		{ ...turn(NUDGE, true, 'Checked the diff.'), id: 't2', added: ['also the README'] },
		{ ...turn(NUDGE), id: 't3' },
	];

	expect(await keepGoing('fabled', 'Did the README.', { ...going(session, later), askMonitor, ask: says('') })).toBe(
		true,
	);
	expect(asked[1].first).toBe(false);
	expect(asked[1].monitor).toBe(asked[0].monitor);
	expect(asked[1].prompt).toContain('Since you last looked:');
	expect(asked[1].prompt).toContain('The person added while Claude worked: also the README');
	expect(asked[1].prompt).toContain('Nudged, Claude ended its turn after 3 tool calls: Checked the diff.');
	expect(asked[1].prompt).not.toContain('fix the build');
	expect(asked[1].prompt).toContain('Did the README.');
	expect(monitorOf('fabled').seen).toBe('t3');
});

test("a monitor whose conversation can't be carried on is forgotten and a fresh one briefed at the next turn end; one that only failed to answer is kept", async () => {
	const session = fakeSession();
	const asked = [];
	let outcome = verdict('', { delivered: false, resumable: false });
	const askMonitor = async (monitor, cwd, prompt, { first }) => {
		asked.push({ monitor, first });

		return outcome;
	};
	const turns = [
		{ ...turn('fix the build'), id: 't1' },
		{ ...turn(NUDGE), id: 't2' },
	];

	await keepWarm('lost', 24, Date.now(), { fabled: true });

	const { monitor } = monitorOf('lost');

	await noteMonitor('lost', { monitor, seen: 't1' });
	// Gone: forgotten, Claude carries on with the plain nudge meanwhile
	expect(await keepGoing('lost', 'Done.', { ...going(session, turns), askMonitor })).toBe(true);
	expect(asked[0]).toEqual({ monitor, first: false });
	expect(session.typed[0]).toContain('carry on toward what the person asked for');
	expect(session.typed[0]).not.toContain('A suggestion');
	expect(monitorOf('lost')).toBeNull();

	// A fresh one, briefed; its brief ran out of rounds, so it has still seen up to this turn and is carried on next time,
	// and that counts as an ask without a verdict
	outcome = verdict('', { delivered: true, resumable: true });
	expect(await keepGoing('lost', 'Done.', { ...going(session, turns), askMonitor })).toBe(true);
	expect(asked[1].first).toBe(true);
	expect(asked[1].monitor).not.toBe(monitor);
	expect(monitorOf('lost')).toEqual({ monitor: asked[1].monitor, seen: 't2', missed: 1 });

	// A verdict starts the count over
	const later = [...turns, { ...turn(NUDGE), id: 't3' }];

	outcome = verdict('{"go": true}', { delivered: true, resumable: true });
	expect(await keepGoing('lost', 'Done.', { ...going(session, later), askMonitor })).toBe(true);
	expect(monitorOf('lost')).toEqual({ monitor: asked[1].monitor, seen: 't3', missed: 0 });

	// A hiccup that never reached it (out of usage, too slow): kept as it was, the delta told again next time; but one
	// gone in words the ask doesn't know would be tried forever, so a few asks in a row without a verdict give it up
	outcome = verdict('', { delivered: false, resumable: true });
	for (let miss = 1; miss < MOST_MISSED; miss++) {
		expect(await keepGoing('lost', 'Done.', { ...going(session, later), askMonitor })).toBe(true);
		expect(asked.at(-1)).toEqual({ monitor: asked[1].monitor, first: false });
		expect(monitorOf('lost')).toEqual({ monitor: asked[1].monitor, seen: 't3', missed: miss });
	}
	expect(await keepGoing('lost', 'Done.', { ...going(session, later), askMonitor })).toBe(true);
	expect(monitorOf('lost')).toBeNull();

	// So does one that answers every ask with no verdict (out of rounds each time): it would otherwise drive Claude on
	// plain nudges to the cap
	await keepWarm('lost', 24, Date.now(), { fabled: true });

	const fresh = monitorOf('lost').monitor;

	outcome = verdict('', { delivered: true, resumable: true });
	for (let miss = 1; miss <= MOST_MISSED; miss++) {
		expect(await keepGoing('lost', 'Done.', { ...going(session, later), askMonitor })).toBe(true);
		expect(session.typed.at(-1)).toContain('carry on toward what the person asked for');
		expect(session.typed.at(-1)).not.toContain('A suggestion');
		if (miss < MOST_MISSED) expect(monitorOf('lost')).toEqual({ monitor: fresh, seen: 't3', missed: miss });
	}
	expect(monitorOf('lost')).toBeNull();
	await keepWarm('lost', 24, Date.now(), { fabled: true });

	// A first look that fails outright made nothing worth keeping: a new id next time, and the folders Claude Code may
	// have made for the one the record never held are removed too
	await noteMonitor('lost', { monitor: null });
	outcome = verdict('', { delivered: false, resumable: false });

	const forgotten = [];

	expect(
		await keepGoing('lost', 'Done.', {
			...going(session, later),
			askMonitor,
			forget: async id => {
				forgotten.push(id);
			},
		}),
	).toBe(true);
	expect(asked.at(-1).first).toBe(true);
	expect(forgotten).toEqual([asked.at(-1).monitor]);
	expect(monitorOf('lost')).toBeNull();
});

test("a fabled session has more room than Haiku's caps before it waits for the person", async () => {
	const session = fakeSession();
	let asked = 0;
	const askMonitor = async () => {
		asked += 1;

		return verdict('{"go": true}');
	};
	const capped = [turn('fix the build'), ...Array.from({ length: MOST_NUDGES }, () => turn(NUDGE))];
	const idle = [turn('fix the build'), ...Array.from({ length: MOST_IDLE }, () => turn(NUDGE, false))];

	await keepWarm('room', 24, Date.now(), { fabled: true });
	expect(await keepGoing('room', 'Next I would…', { ...going(session, capped), askMonitor })).toBe(true);
	expect(await keepGoing('room', 'Next I would…', { ...going(session, idle), askMonitor })).toBe(true);
	expect(asked).toBe(2);

	const room = { most: FABLED_NUDGES, idle: FABLED_IDLE };

	expect(FABLED_NUDGES).toBeGreaterThan(MOST_NUDGES);
	expect(FABLED_IDLE).toBeGreaterThan(MOST_IDLE);
	expect(holdBefore([turn('fix'), ...Array.from({ length: FABLED_NUDGES }, () => turn(NUDGE))], room)).toContain(
		'in a row',
	);
	expect(holdBefore([turn('fix'), ...Array.from({ length: FABLED_IDLE }, () => turn(NUDGE, false))], room)).toContain(
		'next to nothing',
	);
});

test("a turn end being answered is noted until it's answered, and a server that starts with one noted answers it from the transcript", async () => {
	const session = fakeSession();
	let release;
	const held = new Promise(resolve => {
		release = resolve;
	});
	const turns = [{ ...turn('fix the build', true, 'Fixed the build.'), id: 't1' }];

	await keepWarm('resumed', 12, Date.now(), { going: true });
	expect(askingSessions()).not.toContain('resumed');

	const answering = keepGoing('resumed', 'Fixed the build.', { ...going(session, turns), ask: () => held });

	await Bun.sleep(1);
	expect(askingSessions()).toContain('resumed');
	release('{"go": true, "next": "Run the tests."}');
	expect(await answering).toBe(true);
	expect(askingSessions()).not.toContain('resumed');

	// As a restart leaves it: noted, never answered
	await noteAsking('resumed', 't1');

	const answered = [];
	const resumed = await resumeKeepingGoing({
		sessionOf: () => session,
		turnsOf: async () => turns,
		answer: async (id, reply) => {
			answered.push({ id, reply });

			return true;
		},
	});

	expect(resumed).toEqual(['resumed']);
	expect(answered).toEqual([{ id: 'resumed', reply: 'Fixed the build.' }]);

	// One with nothing to answer from (no reply in its transcript), or no longer running, is let be
	await noteAsking('resumed', 't1');
	expect(
		await resumeKeepingGoing({ sessionOf: () => session, turnsOf: async () => [], answer: async () => true }),
	).toEqual([]);
	expect(askingSessions()).not.toContain('resumed');
	await noteAsking('resumed', 't1');
	expect(await resumeKeepingGoing({ sessionOf: () => undefined, answer: async () => true })).toEqual([]);
	expect(askingSessions()).not.toContain('resumed');
});

test('a monitor asked again about a turn it already saw is told its verdict was lost, not that a turn ended', async () => {
	const session = fakeSession();
	const prompts = [];
	const askMonitor = async (monitor, cwd, prompt) => {
		prompts.push(prompt);

		return verdict('{"go": true, "next": "Run the tests."}');
	};
	const turns = [
		{ ...turn('fix the build'), id: 't1' },
		{ ...turn(NUDGE, true, 'Ran them.'), id: 't2' },
	];

	await keepWarm('resumed-fabled', 24, Date.now(), { fabled: true });
	await noteMonitor('resumed-fabled', { monitor: monitorOf('resumed-fabled').monitor, seen: 't2' });
	expect(await keepGoing('resumed-fabled', 'Ran them.', { ...going(session, turns), askMonitor })).toBe(true);
	expect(prompts[0]).toContain('your last verdict never reached Claude');
	expect(prompts[0]).not.toContain('A nudged turn ended');
});

test('keep-warm pings between nudges reach the monitor as a count of pings, not as nudges that did nothing', async () => {
	const session = fakeSession();
	const prompts = [];
	const askMonitor = async (monitor, cwd, prompt) => {
		prompts.push(prompt);

		return verdict('{"go": true, "next": "Carry on."}');
	};
	const ping = () => ({
		...turn('keep-warm ping from paude: reply with only "·" and no tool calls', false, '·'),
		id: 'p',
	});
	const turns = [
		{ ...turn('fix the build'), id: 't1' },
		{ ...turn(NUDGE, true, 'Fixed it.'), id: 't2' },
		{ ...ping(), id: 'p1' },
		{ ...ping(), id: 'p2' },
		{ ...ping(), id: 'p3' },
		{ ...turn(NUDGE), id: 't3' },
	];

	await keepWarm('pinged', 24, Date.now(), { fabled: true });
	await noteMonitor('pinged', { monitor: monitorOf('pinged').monitor, seen: 't1' });
	expect(await keepGoing('pinged', 'Tested it.', { ...going(session, turns), askMonitor })).toBe(true);
	expect(prompts[0]).toContain('Nudged, Claude ended its turn after 3 tool calls: Fixed it.');
	expect(prompts[0]).toContain('3 keep-warm pings went by');
	expect(prompts[0]).not.toContain('after 0 tool calls: ·');
	await keepWarm('pinged', 0);
});

test('a monitor whose last seen turn is gone from the transcript (compacted away) is told only the latest turn, not the whole run again', async () => {
	const session = fakeSession();
	const prompts = [];
	const askMonitor = async (monitor, cwd, prompt) => {
		prompts.push(prompt);

		return verdict('{"go": true}');
	};
	const turns = [
		{ ...turn('fix the build', true, 'Fixed the build.'), id: 't1' },
		{ ...turn(NUDGE, true, 'Ran the tests.'), id: 't2' },
		{ ...turn(NUDGE), id: 't3' },
	];

	await keepWarm('compacted', 24, Date.now(), { fabled: true });
	await noteMonitor('compacted', { monitor: monitorOf('compacted').monitor, seen: 'gone-with-the-compaction' });
	expect(await keepGoing('compacted', 'Wrote the README.', { ...going(session, turns), askMonitor })).toBe(true);
	expect(prompts[0]).toContain('Since you last looked:');
	expect(prompts[0]).toContain('Wrote the README.');
	expect(prompts[0]).not.toContain('Fixed the build.');
	expect(prompts[0]).not.toContain('Ran the tests.');
	expect(monitorOf('compacted').seen).toBe('t3');
	await keepWarm('compacted', 0);
});

test("a compaction's summary reaches the monitor as a compaction, with what Claude did carrying on from it", async () => {
	const session = fakeSession();
	const prompts = [];
	const askMonitor = async (monitor, cwd, prompt) => {
		prompts.push(prompt);

		return verdict('{"go": true, "next": "Carry on."}');
	};
	const turns = [
		{ ...turn('fix the build'), id: 't1' },
		{
			...turn('This session is being continued from a previous conversation', true, 'Wired the hook.'),
			summary: true,
			id: 's1',
		},
		{ ...turn(NUDGE), id: 't2' },
	];

	await keepWarm('summarized', 24, Date.now(), { fabled: true });
	await noteMonitor('summarized', { monitor: monitorOf('summarized').monitor, seen: 't1' });
	expect(await keepGoing('summarized', 'Tested it.', { ...going(session, turns), askMonitor })).toBe(true);
	expect(prompts[0]).toContain("Claude's context was compacted");
	expect(prompts[0]).toContain(
		'Carrying on from the summary, Claude ended its turn after 3 tool calls: Wired the hook.',
	);
	expect(prompts[0]).not.toContain('keep-warm');
	await keepWarm('summarized', 0);
});

test('as Claude compacts, a fabled monitor that has looked writes a handover, taken once, and its record left as it was', async () => {
	const session = fakeSession();
	const asks = [];
	const askMonitor = async (monitor, cwd, prompt, options) => {
		asks.push({ monitor, prompt, options });

		return verdict('Still waiting on: the README. Rejected: per-session counts.');
	};
	const deps = { ...going(session), askMonitor, repoOf: async () => '' };

	await keepWarm('handover', 24, Date.now(), { fabled: true });
	// A monitor that hasn't looked yet has nothing to hand over
	expect(await beginHandover('handover', {}, deps)).toBe(false);
	await noteMonitor('handover', { monitor: monitorOf('handover').monitor, seen: 't1', missed: 1 });
	expect(await beginHandover('handover', { custom_instructions: ' the README ' }, deps)).toBe(true);
	expect(await takeHandover('handover', 1000)).toBe('Still waiting on: the README. Rejected: per-session counts.');
	expect(await takeHandover('handover', 1000)).toBe('');
	expect(asks).toHaveLength(1);
	expect(asks[0].monitor).toBe(monitorOf('handover').monitor);
	expect(asks[0].prompt).toContain('<focus>\nthe README\n</focus>');
	expect(asks[0].options.turns).toBeLessThan(5);
	expect(monitorOf('handover')).toMatchObject({ seen: 't1', missed: 1 });

	// One too slow to write is let go, and Claude carries on without it
	const slow = async () => new Promise(resolve => setTimeout(() => resolve(verdict('late')), 200));

	expect(await beginHandover('handover', {}, { ...deps, askMonitor: slow })).toBe(true);
	expect(await takeHandover('handover', 10)).toBe('');

	// Only fabled sessions hand over
	await keepWarm('handover', 24, Date.now(), { going: true });
	expect(await beginHandover('handover', {}, deps)).toBe(false);
	await keepWarm('handover', 0);
});
