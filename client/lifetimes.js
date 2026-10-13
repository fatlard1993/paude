// How long a session lasts, as its bar and its card show it
export const LIFETIMES = {
	ordinary: { label: 'Ordinary', icon: 'infinity', detail: 'stays until you delete it' },
	warm: {
		label: 'Kept warm',
		icon: 'mug-hot',
		mark: '☕',
		detail: 'pinged while you are away so it comes back cached, 12 hours from your last message',
	},
	brief: {
		label: 'Short-lived',
		icon: 'hourglass-half',
		mark: '⏳',
		detail: "deleted once Claude's cache lets go of it with nobody here",
	},
};

export const clockTime = at => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
