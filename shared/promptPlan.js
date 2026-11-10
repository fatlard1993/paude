import { makesGame } from './arcade';
import { MODELS } from './models';

// What sending a prompt does, from what was said where it was written: `project` (where it goes, none for paude to
// find), `remote` (the project is on another paude), `arcade` (a way of writing there, or none) and `model` (a tier,
// 'default', or 'suggest'):
// - 'game': a new arcade game, made at once
// - 'start': a new session in the project said, at once: nothing looked for, nothing asked
// - 'find': paude looks for where it goes, there being no project said
// and with 'start', `suggest`: whether the model is asked for first, the one wait a start can have (never on another
// paude, whose sessions this one can't weigh the prompt against)
export const promptPlan = ({ project, remote, arcade, model } = {}) => {
	if (makesGame({ arcade, project, remote })) return { does: 'game' };
	if (!project) return { does: 'find' };

	return { does: 'start', suggest: model === 'suggest' && !remote };
};

// What a new session is started with, from what was picked: `model` a tier or none for the default (a suggestion
// taking the place of 'suggest', when there is one), `mode` its lifetime or none for the ordinary
export const startWith = ({ model, lifetime, suggested } = {}) => {
	const runs = model === 'suggest' ? suggested : model;

	return {
		model: runs in MODELS && runs !== 'default' ? runs : undefined,
		mode: !lifetime || lifetime === 'ordinary' ? undefined : lifetime,
	};
};

// What the dialog that finds where a prompt goes starts its own pickers on: what was already picked, so it isn't
// asked again; nothing for what was left at its default or to a suggestion, which the dialog's own suggestion fills
export const carriedInto = ({ model, lifetime } = {}) => ({
	model: model in MODELS && model !== 'default' ? model : undefined,
	lifetime: lifetime && lifetime !== 'ordinary' ? lifetime : undefined,
});
