process.on('SIGINT', () => {
	console.warn('Clean Exit');

	process.exit(130);
});

// Being asked to stop (paude stop, a service manager) is a clean exit; a service that restarts the server after a
// failure leaves it stopped
process.on('SIGTERM', () => process.exit(0));

// Every live session is a child of this process, so a stray error is logged rather than taking them all down
process.on('uncaughtException', error => console.error('Uncaught exception', error.stack));
process.on('unhandledRejection', error => console.error('Unhandled rejection', error?.stack ?? error));
