// Only here so pages can show notifications on phones, where the Notification constructor isn't allowed. A click
// brings back an open paude tab (or opens one) at the notification's page.
self.addEventListener('notificationclick', event => {
	event.notification.close();

	const url = event.notification.data?.url ?? '/';

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
			const open = windows[0];

			if (!open) return self.clients.openWindow(url);

			return open.focus().then(focused => focused.navigate?.(url));
		}),
	);
});
