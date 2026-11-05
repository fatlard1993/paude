// The model a new session runs on, as Claude Code's --model takes it: its alias for the latest of each tier, or none
// for the account's default. Ordered from the lightest to the most capable.
export const MODELS = {
	default: { label: 'Default model', detail: "whatever Claude Code's settings pick" },
	haiku: { label: 'Haiku', detail: 'quick and light: a question, a lookup, a small mechanical change' },
	sonnet: { label: 'Sonnet', detail: 'everyday coding: a feature, a fix, a refactor' },
	opus: { label: 'Opus', detail: 'hard work: a tricky bug, a design, a long change across the codebase' },
	fable: { label: 'Fable', detail: 'the most capable: the hardest problems, where getting it right matters most' },
};

// A tier Claude Code is given by name; the default is none
export const MODEL_NAMES = Object.keys(MODELS).filter(name => name !== 'default');
