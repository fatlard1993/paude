import { desktopNotificationsOn } from './storage';

let registration = null;

// Served from client/ under a fixed name, so the path holds across builds
const ICON = '/icon-192.png';

export const registerNotificationWorker = async () => {
	try {
		// Missing in Android's WebView, where the optional chain leaves notifications to the plain constructor
		// eslint-disable-next-line compat/compat
		registration = await navigator.serviceWorker?.register('/sw.js');
	} catch {
		registration = null;
	}
};

export const showNotification = async ({ title, body, tag, url }) => {
	if (!desktopNotificationsOn()) return false;

	try {
		if (registration) {
			await registration.showNotification(title, { body, tag, icon: ICON, data: { url } });
		} else {
			const notification = new Notification(title, { body, tag, icon: ICON });

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
