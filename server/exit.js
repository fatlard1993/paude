process.on('SIGINT', () => {
	console.warn('Clean Exit');

	process.exit(130);
});

// Every live session is a child of this process, so a stray error is logged rather than taking them all down
process.on('uncaughtException', error => console.error('Uncaught exception', error.stack));
process.on('unhandledRejection', error => console.error('Unhandled rejection', error?.stack ?? error));
