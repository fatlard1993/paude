import { desktopNotificationsOn } from './Terminal/NotesPanel';

let registration = null;

export const registerNotificationWorker = async () => {
	try {
		// Missing in Android's WebView, where the optional chain leaves notifications to the plain constructor
		// eslint-disable-next-line compat/compat
		registration = await navigator.serviceWorker?.register('/sw.js');
	} catch {
		registration = null;
	}
};

// A desktop (or phone) notification when they're switched on; false when it couldn't be shown, so the caller can
// fall back to something in the page
export const showNotification = async ({ title, body, tag, url }) => {
	if (!desktopNotificationsOn()) return false;

	try {
		if (registration) {
			await registration.showNotification(title, { body, tag, data: { url } });
		} else {
			const notification = new Notification(title, { body, tag });

			notification.onclick = () => {
				window.focus();
				if (url) window.location.href = url;
			};
		}

		return true;
	} catch {
		return false;
	}
};
