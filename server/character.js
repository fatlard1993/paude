// What a project's room takes its character from: the language most of its files are in, how many files it has, and
// how long and how much it's been worked on

const LANGUAGES = {
	js: ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'vue', 'svelte'],
	python: ['py', 'ipynb'],
	rust: ['rs'],
	go: ['go'],
	jvm: ['java', 'kt', 'kts', 'scala', 'groovy', 'gradle'],
	c: ['c', 'h', 'cc', 'cpp', 'hpp', 'cxx', 'm', 'mm', 'zig'],
	ruby: ['rb', 'erb'],
	php: ['php'],
	dotnet: ['cs', 'fs', 'vb'],
	swift: ['swift'],
	shell: ['sh', 'bash', 'zsh', 'fish', 'ps1'],
	web: ['html', 'css', 'scss', 'sass', 'less'],
	docs: ['md', 'mdx', 'txt', 'rst', 'org', 'tex', 'adoc'],
	data: ['json', 'yaml', 'yml', 'toml', 'csv', 'xml', 'sql'],
};
const LANGUAGE_OF = Object.fromEntries(
	Object.entries(LANGUAGES).flatMap(([language, extensions]) => extensions.map(extension => [extension, language])),
);
// Languages a project is written in outrank what it keeps alongside: its markup, prose and data count only when
// there's nothing else
const SUPPORTING = new Set(['web', 'docs', 'data']);

export const languageOf = files => {
	const counts = new Map();

	for (const file of files) {
		const extension = /\.([^./]+)$/.exec(file)?.[1]?.toLowerCase();
		const language = LANGUAGE_OF[extension];

		if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
	}

	const ranked = [...counts].sort((a, b) => b[1] - a[1]);

	return (ranked.find(([language]) => !SUPPORTING.has(language)) ?? ranked[0])?.[0] ?? null;
};

// The parts a project is built from: its top-level folders by how many files each holds, the language most of them
// are in, the biggest first, the rest of what's at the top (files outside any folder, folders past `most`, and its
// hidden folders, which hold its tooling rather than its parts) as one more part
export const foldersOf = (files, most = 6) => {
	const groups = new Map();

	for (const file of files) {
		const slash = file.indexOf('/');
		const name = slash > 0 && !file.startsWith('.') ? file.slice(0, slash) : '';

		if (!groups.has(name)) groups.set(name, []);
		groups.get(name).push(file);
	}

	const named = [...groups]
		.filter(([name]) => name)
		.map(([name, held]) => ({ name, files: held.length, language: languageOf(held) }))
		.sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
	const kept = named.slice(0, most);
	const rest = [...named.slice(most).flatMap(({ name }) => groups.get(name)), ...(groups.get('') ?? [])];

	return rest.length ? [...kept, { name: '', files: rest.length, language: languageOf(rest) }] : kept;
};

// One history for a project made of several repositories: since the first of them began, all their commits, the
// latest of anyone's, and how many came in the last day and week across them; null when none has any
export const combinedHistory = histories => {
	const known = histories.filter(Boolean);

	if (!known.length) return null;

	const lasts = known.map(({ last }) => last).filter(Boolean);

	return {
		since: Math.min(...known.map(({ since }) => since)),
		commits: known.reduce((sum, { commits }) => sum + commits, 0),
		last: lasts.length ? Math.max(...lasts) : null,
		week: known.reduce((sum, { week = 0 }) => sum + week, 0),
		day: known.reduce((sum, { day = 0 }) => sum + day, 0),
	};
};
