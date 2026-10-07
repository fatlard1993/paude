export const DESKTOP_KEY = 'paude.desktopNotifications';

// Per-browser preferences; private windows can refuse storage, and then they last until reload
export const recall = key => {
	try {
		return localStorage.getItem(key) ?? '';
	} catch {
		return '';
	}
};

export const remember = (key, value) => {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Kept for this page only
	}
};

export const desktopNotificationsOn = () =>
	'Notification' in window && Notification.permission === 'granted' && recall(DESKTOP_KEY) === 'yes';
