import { expect, test } from 'bun:test';

import { carriedInto, promptPlan, startWith } from './promptPlan';

test('a prompt with its project said starts a session at once; with none, paude finds where it goes; for the arcade with none, a game', () => {
	expect(promptPlan({ project: 'paude', model: 'default' })).toEqual({ does: 'start', suggest: false });
	expect(promptPlan({ project: 'paude', model: 'opus' })).toEqual({ does: 'start', suggest: false });
	// A suggested model is the one thing asked for first
	expect(promptPlan({ project: 'paude', model: 'suggest' })).toEqual({ does: 'start', suggest: true });
	// On another paude it starts there, and nothing here can suggest for it
	expect(promptPlan({ project: 'paude', remote: { url: 'https://other' }, model: 'suggest' })).toEqual({
		does: 'start',
		suggest: false,
	});
	// In a project, for the arcade: still a session there, in the arcade
	expect(promptPlan({ project: 'paude', arcade: 'reading' }).does).toBe('start');
	expect(promptPlan({ model: 'opus' })).toEqual({ does: 'find' });
	expect(promptPlan()).toEqual({ does: 'find' });
	expect(promptPlan({ arcade: 'reading' })).toEqual({ does: 'game' });
});

test('a session is started with what was picked: the default as no model, ordinary as no lifetime, a suggestion in place of the asking', () => {
	expect(startWith({ model: 'default', lifetime: 'ordinary' })).toEqual({ model: undefined, mode: undefined });
	expect(startWith({ model: 'opus', lifetime: 'warm' })).toEqual({ model: 'opus', mode: 'warm' });
	expect(startWith({ model: 'suggest', suggested: 'haiku' })).toEqual({ model: 'haiku', mode: undefined });
	// Nothing suggested (the asking failed), or the default suggested, or something that's no model: the default
	expect(startWith({ model: 'suggest' }).model).toBeUndefined();
	expect(startWith({ model: 'suggest', suggested: 'default' }).model).toBeUndefined();
	expect(startWith({ model: 'gpt' }).model).toBeUndefined();
});

test("what was picked is carried into the finding dialog's pickers, and what was left alone isn't", () => {
	expect(carriedInto({ model: 'opus', lifetime: 'going' })).toEqual({ model: 'opus', lifetime: 'going' });
	expect(carriedInto({ model: 'default', lifetime: 'ordinary' })).toEqual({ model: undefined, lifetime: undefined });
	expect(carriedInto({ model: 'suggest' })).toEqual({ model: undefined, lifetime: undefined });
});
