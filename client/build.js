import { watch } from 'fs';

const build = async () => {
	console.log('Building...');

	const buildResults = await Bun.build({
		entrypoints: ['client/index.html'],
		outdir: 'client/build',
		minify: true,
		define: {
			'process.env.AUTOPREFIXER_GRID': 'undefined',
			'process.cwd': 'String',
		},
		...(process.env.NODE_ENV === 'production' && { drop: ['console'] }),
	});

	console.log(buildResults.success ? 'build.success' : buildResults.logs);

	return buildResults;
};

const enableWatcher = process.argv[2] === '--watch';
const watcherIgnore = /^client\/build|^\./;

if (enableWatcher) {
	console.log(`Initializing watcher`);

	let buildTimeout;

	const watcher = watch(`${import.meta.dir}/..`, { recursive: true }, (event, filename) => {
		if (watcherIgnore.test(filename)) return;

		console.log(`Detected ${event} in ${filename}`);

		clearTimeout(buildTimeout);
		buildTimeout = setTimeout(build, 100);
	});

	process.on('SIGINT', () => {
		watcher.close();
		process.exit(0);
	});
}

await build();
