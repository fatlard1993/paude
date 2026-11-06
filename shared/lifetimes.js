// How long a session lasts, as its bar and its card show it
export const LIFETIMES = {
	ordinary: { label: 'Ordinary', icon: 'infinity', detail: 'stays until you delete it' },
	warm: {
		label: 'Kept warm',
		icon: 'mug-hot',
		mark: '☕',
		detail: 'pinged while you are away so it comes back cached, 12 hours from your last message',
	},
	going: {
		label: 'Keeps going',
		icon: 'forward',
		mark: '⏩',
		detail:
			'kept warm, and kept working toward your goal while anything useful is left that needs nothing from you, 12 hours from your last message',
	},
	fabled: {
		label: 'Fabled',
		icon: 'binoculars',
		mark: '🔭',
		detail:
			'kept going by a Fable monitor of its own that follows the whole run and reads the repository, with more room before it waits for you, 24 hours from your last message',
	},
	brief: {
		label: 'Short-lived',
		icon: 'hourglass-half',
		mark: '⏳',
		detail: "deleted once Claude's cache lets go of it with nobody here",
	},
};

// Those kept warm while you're away
export const WARM_LIFETIMES = ['warm', 'going', 'fabled'];

export const clockTime = at => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
