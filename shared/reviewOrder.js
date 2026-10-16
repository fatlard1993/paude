import { parseDiff } from './diff';
import { byFunction, fileRenames, renameSweeps, sayRenames } from './reviewGroups';

// Orders for reading a set of changed files, and what each file is to the change, worked out from names, imports and
// the diff alone: no model, the same every time. Alphabetical order (git's) puts tests far from what they test and a
// lock file beside the code; reading order puts what's used before what uses it, each file's tests right after it,
// then the rest by kind, with what nobody reads line by line (lock files, generated files) last.
export const ORDERS = {
	reading: { label: 'Reading order', detail: "what's used before what uses it, each file's tests after it" },
	size: { label: 'Largest change first', detail: 'where most changed, generated files last' },
	function: {
		label: 'By function',
		detail: "each changed function, those whose signature changed first, then where it's used",
	},
	alphabetical: { label: 'Alphabetical', detail: 'as git lists them' },
};

const GENERATED = [
	/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|uv\.lock|Gemfile\.lock|composer\.lock|flake\.lock|mix\.lock|pubspec\.lock|Podfile\.lock)$/,
	/\.min\.(js|css)$/,
	/\.map$/,
	/(^|\/)__snapshots__\//,
	/\.snap$/,
	/(^|\/)(dist|build|out|vendor|node_modules)\//,
	/\.(pb|generated|gen)\.\w+$/,
];
const TEST = [
	/(^|\/)(__tests__|__test__|tests?|spec|specs|e2e)\//,
	/\.(test|spec|e2e)\.\w+$/,
	/_test\.(go|py|rb|exs?)$/,
	/(^|\/)test_[^/]+\.py$/,
	/_spec\.rb$/,
	/Tests?\.(java|kt|cs|swift)$/,
];
const DOCS = [
	/\.(md|mdx|markdown|rst|adoc|txt)$/i,
	/(^|\/)(docs?|documentation)\//,
	/(^|\/)(LICENSE|CHANGELOG|NOTICE|AUTHORS)[^/]*$/i,
];
const CONFIG = [
	/(^|\/)\.[^/]+$/,
	/(^|\/)\.(github|gitlab|circleci|husky|githooks|vscode|devcontainer)\//,
	/\.(json|jsonc|ya?ml|toml|ini|cfg|conf|properties|plist|env)$/i,
	/(^|\/)[^/]*\.config\.[cm]?[jt]s$/,
	/(^|\/)(Dockerfile|Containerfile|Makefile|justfile|Procfile|Vagrantfile|Gemfile|Rakefile|Brewfile)[^/]*$/,
	/(^|\/)(package\.json|tsconfig[^/]*\.json|requirements[^/]*\.txt|pyproject\.toml|setup\.(py|cfg)|go\.mod|Cargo\.toml)$/,
];

// What a file is to a change: 'generated', 'test', 'docs', 'config' or 'source'
export const fileKind = path => {
	if (GENERATED.some(pattern => pattern.test(path))) return 'generated';
	if (TEST.some(pattern => pattern.test(path))) return 'test';
	if (DOCS.some(pattern => pattern.test(path))) return 'docs';
	if (CONFIG.some(pattern => pattern.test(path))) return 'config';

	return 'source';
};

const folderOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const nameOf = path => path.slice(path.lastIndexOf('/') + 1);
// A file's name without its extension and any test marking: foo.test.js, test_foo.py and foo_test.go are all foo
const stemOf = path =>
	nameOf(path)
		.replace(/\.[^.]+$/, '')
		.replace(/\.(test|spec|e2e)$/, '')
		.replace(/^test_/, '')
		.replace(/_(test|spec)$/, '')
		.replace(/Tests?$/, '');
const TEST_FOLDER = /(^|\/)(__tests__|__test__|tests?|spec|specs|e2e)$/;

// The file a test is about, among `paths`: the same name beside it, or in the folder its test folder sits in, or
// failing those, the one file anywhere with that name; null when there's no telling
export const testSubject = (test, paths) => {
	const stem = stemOf(test);
	const candidates = paths.filter(path => path !== test && fileKind(path) === 'source' && stemOf(path) === stem);
	const folder = folderOf(test);
	const near = [folder, folder.replace(TEST_FOLDER, '')];

	return (
		candidates.find(path => folderOf(path) === folder) ??
		candidates.find(path => near.includes(folderOf(path))) ??
		(candidates.length === 1 ? candidates[0] : null)
	);
};

// The modules a file names, as written: JavaScript and TypeScript imports, exports-from and requires; Python's
// imports. Other languages name none, so they keep their place.
export const importsIn = (path, text) => {
	if (/\.(m?[jt]sx?|c[jt]s)$/.test(path))
		return [
			...text.matchAll(
				/(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;(])import\s*\(?\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/gm,
			),
		].map(match => match[1] ?? match[2] ?? match[3]);
	if (/\.py$/.test(path))
		return [...text.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import\b|^\s*import\s+([\w.]+)/gm)].map(
			match => match[1] ?? match[2],
		);

	return [];
};

const SCRIPT_ENDINGS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json'];

const normal = path => {
	const parts = [];

	for (const part of path.split('/')) {
		if (part === '..') parts.pop();
		else if (part && part !== '.') parts.push(part);
	}

	return parts.join('/');
};

// Which of `paths` an import from `from` means, or null: a relative one resolved as a bundler would, a Python module
// by its dotted path
export const resolveImport = (from, name, paths) => {
	const inSet = new Set(paths);

	if (/\.py$/.test(from)) {
		const dots = /^\.*/.exec(name)[0].length;
		const module = name.slice(dots).replace(/\./g, '/');
		const base = dots ? normal(`${folderOf(from)}/${'../'.repeat(dots - 1)}${module}`) : module;
		const wanted = [`${base}.py`, `${base}/__init__.py`];

		return (
			wanted.find(path => inSet.has(path)) ??
			(dots ? null : paths.find(path => wanted.some(ending => path.endsWith(`/${ending}`)))) ??
			null
		);
	}

	if (!name.startsWith('.')) return null;

	const base = normal(`${folderOf(from)}/${name}`);

	return (
		[
			...SCRIPT_ENDINGS.map(ending => base + ending),
			...SCRIPT_ENDINGS.slice(1).map(ending => `${base}/index${ending}`),
		].find(path => inSet.has(path)) ?? null
	);
};

// How much a file's diff changes, in lines added and removed, and whether every change is to whitespace alone: each
// hunk saying the same once spaces and line breaks are taken out, so code only re-indented or re-wrapped counts
export const changeShape = diff => {
	const { hunks } = parseDiff(diff ?? '');
	const text = (lines, kind) =>
		lines
			.filter(line => line.kind === kind)
			.map(line => line.text)
			.join('')
			.replace(/\s+/g, '');
	const changed = hunks.flatMap(hunk => hunk.lines).filter(line => line.kind === 'removed' || line.kind === 'added');

	return {
		changed: changed.length,
		whitespace: changed.length > 0 && hunks.every(({ lines }) => text(lines, 'removed') === text(lines, 'added')),
	};
};

// What each file is to the change, for a label beside it: { kind, subject, moved, whitespace, changed }
export const describeFiles = files => {
	const paths = files.map(file => file.path);
	const sweeps = renameSweeps(files);

	return new Map(
		files.map(file => {
			const kind = fileKind(file.path);
			const shape = changeShape(file.diff);
			const renamed = !shape.whitespace && fileRenames(file.diff);
			const sweep = sweeps.find(found => found.paths.includes(file.path));

			return [
				file.path,
				{
					kind,
					subject: kind === 'test' ? testSubject(file.path, paths) : null,
					moved: file.status === 'renamed' && shape.changed === 0,
					whitespace: shape.whitespace,
					changed: shape.changed,
					// One word swapped on one line is an edit like any other; a rename is the same swap made throughout
					...(renamed &&
						(sweep || renamed.lines > 1) && {
							renames: sayRenames(renamed.renames),
							renamesOnly: renamed.only,
						}),
					...(sweep && { sweep: `Renamed ${sayRenames(sweep.renames)} in ${sweep.paths.length} files` }),
				},
			];
		}),
	);
};

// Whether a file in a set is folded until asked for: what's generated, and each file of a rename swept across files
export const folds = about => about.kind === 'generated' || Boolean(about.sweep);

// Rank of a file that isn't read with the code: tests without a subject here, config, docs, moves, whitespace and
// renames, then what's generated
const restRank = about => {
	if (about.kind === 'generated') return 5;
	if (about.moved || about.whitespace || about.renamesOnly) return 4;

	return { test: 1, config: 2, docs: 3 }[about.kind] ?? 0;
};

// What's used before what uses it, as far as imports tell (a cycle keeps git's order); `imports` maps a path to the
// paths in the set it imports
const usedFirst = (paths, imports) => {
	const placed = [];
	const seen = new Set();
	const visit = (path, trail) => {
		if (seen.has(path) || trail.has(path)) return;

		trail.add(path);
		for (const used of imports[path] ?? []) if (paths.includes(used)) visit(used, trail);
		trail.delete(path);
		seen.add(path);
		placed.push(path);
	};

	for (const path of paths) visit(path, new Set());

	return placed;
};

// The rest, by rank, a rename sweep's files together under its heading
const restOf = (files, about) =>
	files
		.sort(
			(a, b) =>
				restRank(about.get(a.path)) - restRank(about.get(b.path)) ||
				(about.get(a.path).sweep ?? '').localeCompare(about.get(b.path).sweep ?? ''),
		)
		.map(file => (about.get(file.path).sweep ? { ...file, group: about.get(file.path).sweep } : file));

// The files in the order asked for: 'reading', 'size', 'function' or 'alphabetical' (as they came). `imports` maps a
// path to the changed paths it imports; `outlines`, a path to its declarations, for reading function by function.
// A file can come back as several entries (a function's part of it), and an entry read under a heading has its
// `group`.
export const orderFiles = (files, order = 'reading', { imports = {}, outlines = {} } = {}) => {
	if (order === 'alphabetical' || (files.length < 2 && order !== 'function')) return files;

	const about = describeFiles(files);
	const byPath = new Map(files.map(file => [file.path, file]));
	const plain = path => restRank(about.get(path)) === 0;

	if (order === 'size') {
		return [...files].sort(
			(a, b) =>
				(about.get(a.path).kind === 'generated') - (about.get(b.path).kind === 'generated') ||
				about.get(b.path).changed - about.get(a.path).changed,
		);
	}

	if (order === 'function') {
		// Code and its tests are read by function (a test using a function reads after it); the rest as ever
		const code = file => {
			const { kind } = about.get(file.path);

			return (kind === 'source' || kind === 'test') && restRank({ ...about.get(file.path), kind: 'source' }) === 0;
		};
		const grouped = byFunction(files.filter(code), outlines, imports);

		if (grouped)
			return [
				...grouped,
				...restOf(
					files.filter(file => !code(file)),
					about,
				),
			];
	}

	const sources = usedFirst(
		files.map(file => file.path).filter(path => plain(path)),
		imports,
	);
	const testsOf = path => files.filter(file => about.get(file.path).subject === path);
	// A test follows its subject when that's read with the code; otherwise it goes with the rest
	const followsSubject = path => sources.includes(about.get(path).subject);

	return [
		...sources.flatMap(path => [byPath.get(path), ...testsOf(path)]),
		...restOf(
			files.filter(file => !plain(file.path) && !followsSubject(file.path)),
			about,
		),
	];
};

// A file's label in the order it's read in: "tests src/a.js", "config", "generated", and so on; '' for
// plain source
export const fileLabel = about => {
	if (about.kind === 'generated') return 'generated';
	if (about.moved) return 'moved, unchanged';
	if (about.whitespace) return 'whitespace only';
	if (about.renamesOnly) return `renames ${about.renames}`;
	if (about.kind === 'test') return about.subject ? `tests ${nameOf(about.subject)}` : 'test';
	if (about.renames) return `also renames ${about.renames}`;

	return about.kind === 'source' ? '' : about.kind;
};
