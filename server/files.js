import { existsSync } from 'fs';
import { readdir, realpath } from 'fs/promises';
import { join, resolve, sep } from 'path';

import searchPattern from '../shared/searchPattern';
import { pathFilter } from '../shared/globs';
import gitEnvironment from './utils/gitEnvironment';

const MAX_FILES = 50_000;
const MAX_BYTES = 1024 * 1024;
const MAX_RAW_BYTES = 50 * 1024 * 1024;
const MAX_HITS = 300;
const LISTING_TTL_MS = 2000;
const SEARCH_TIMEOUT_MS = 10_000;
// Outside git there's no ignore file to go by, so the usual heavy folders and anything hidden are skipped by name
const SKIPPED_OUTSIDE_GIT = ['node_modules', '.git', 'build', 'dist'];
// Secrets a project may not have told git to ignore stay out of every listing, for guests above all
const SECRET =
	/(^|\/)(\.env(\.[^/]*)?|\.mcp\.json|\.npmrc|\.netrc|id_(rsa|ed25519|ecdsa)[^/]*|[^/]*\.(pem|key|p12|pfx)|\.claude\/settings\.local\.json)$/;

export const isSecret = path => SECRET.test(path);

const SKIPPED_DIRECTORIES = SKIPPED_OUTSIDE_GIT.map(name => `--exclude-dir=${name}`);

const listings = new Map();

const run = async (args, cwd) => {
	const child = Bun.spawn(args, {
		cwd,
		env: gitEnvironment(),
		stdout: 'pipe',
		stderr: 'ignore',
		timeout: SEARCH_TIMEOUT_MS,
	});
	const out = await new Response(child.stdout).text();

	await child.exited;

	return { code: child.exitCode, out };
};

// What git shows of a repo; a repo nested untracked inside it lists as its folder, so its files come from its own git
const gitFiles = async cwd => {
	const git = await run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd);

	if (git.code !== 0) return null;

	const files = [];

	for (const path of git.out.split('\0').filter(Boolean)) {
		if (!path.endsWith('/')) files.push(path);
		else for (const inner of (await gitFiles(join(cwd, path))) ?? []) files.push(path + inner);
	}

	return files;
};

// A folder that isn't a repo, often one holding several: each repo inside is listed by its own git, all at once,
// the rest walked in name order so a listing that reaches the limit always leaves out the same files
const walk = async cwd => {
	const found = [];
	let walked = 0;

	const visit = async folder => {
		const entries = (await readdir(join(cwd, folder), { withFileTypes: true }).catch(() => [])).sort((a, b) =>
			a.name.localeCompare(b.name),
		);

		for (const entry of entries) {
			if (walked >= MAX_FILES) return;
			if (entry.name.startsWith('.') || SKIPPED_OUTSIDE_GIT.includes(entry.name)) continue;

			const path = folder + entry.name;

			if (entry.isFile()) {
				found.push([path]);
				walked += 1;
			} else if (!entry.isDirectory()) continue;
			else if (existsSync(join(cwd, path, '.git')))
				found.push(gitFiles(join(cwd, path)).then(inner => (inner ?? []).map(file => `${path}/${file}`)));
			else await visit(`${path}/`);
		}
	};

	await visit('');

	return (await Promise.all(found)).flat();
};

// The files a project shows: what git tracks plus untracked files it doesn't ignore, so .env files, build output
// and dependencies stay out. Everything else here is checked against this list.
export const listFiles = async cwd => {
	const cached = listings.get(cwd);

	if (cached && Date.now() - cached.at < LISTING_TTL_MS) return cached.files;

	const files = ((await gitFiles(cwd)) ?? (await walk(cwd)))
		.filter(path => !SECRET.test(path))
		.slice(0, MAX_FILES)
		.sort();

	listings.set(cwd, { at: Date.now(), files });

	return files;
};

// A listed path can still be a symlink out of the project; only what resolves inside it is read
const insideProject = async (cwd, path) => {
	try {
		const [root, target] = await Promise.all([realpath(cwd), realpath(resolve(cwd, path))]);

		return target.startsWith(root + sep);
	} catch {
		return false;
	}
};

const projectFile = async (cwd, path) =>
	(await listFiles(cwd)).includes(path) && (await insideProject(cwd, path)) ? Bun.file(resolve(cwd, path)) : null;

export const rawProjectFile = async (cwd, path) => {
	const file = await projectFile(cwd, path);

	if (!file) return { status: 404 };
	if (file.size > MAX_RAW_BYTES) return { status: 413 };

	return { status: 200, file };
};

const hashOf = bytes => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

// The text and a hash of exactly what was read, which a save hands back
export const readProjectFile = async (cwd, path) => {
	const file = await projectFile(cwd, path);

	if (!file) return { status: 404 };

	if (file.size > MAX_BYTES) return { status: 413 };

	const bytes = new Uint8Array(await file.arrayBuffer());

	if (bytes.subarray(0, 8000).includes(0)) return { status: 415 };

	return { status: 200, text: new TextDecoder().decode(bytes), hash: hashOf(bytes) };
};

// A hand edit goes only to a text file already in the project, and only over the version that was opened: a newer
// change (Claude's, most likely) comes back as a 409 with the current text instead of being lost
export const writeProjectFile = async (cwd, path, text, hash) => {
	const current = await readProjectFile(cwd, path);

	if (current.status !== 200) return { status: current.status };

	const bytes = new TextEncoder().encode(typeof text === 'string' ? text : '');

	if (typeof text !== 'string' || bytes.length > MAX_BYTES) return { status: 413 };
	if (current.hash !== hash) return { status: 409, text: current.text, hash: current.hash };

	await Bun.write(resolve(cwd, path), bytes);

	return { status: 200, hash: hashOf(bytes) };
};

export class SearchError extends Error {}

// Literal and case-insensitive unless the options say otherwise
const READ_TOGETHER = 32;

// A regular expression is JavaScript's, as in the page and in Replace: each listed text file is read and tested line
// by line, stopping at the hits a page shows, or the time a search may take
const searchWithExpression = async (cwd, query, options) => {
	const pattern = searchPattern(query, options);

	if (!pattern) throw new SearchError('That regular expression is not valid.');

	const wanted = pathFilter(options);
	const files = (await listFiles(cwd)).filter(path => wanted(path) && !isSecret(path));
	const stopAt = Date.now() + SEARCH_TIMEOUT_MS;
	const hits = [];

	for (let start = 0; start < files.length && hits.length < MAX_HITS && Date.now() < stopAt; start += READ_TOGETHER) {
		const batch = files.slice(start, start + READ_TOGETHER);
		const texts = await Promise.all(
			batch.map(async path => {
				const file = Bun.file(resolve(cwd, path));

				if (file.size > MAX_BYTES) return null;

				const text = await file.text().catch(() => null);

				return text?.includes('\0') ? null : text;
			}),
		);

		batch.forEach((path, index) => {
			texts[index]?.split('\n').forEach((text, line) => {
				if (hits.length < MAX_HITS && pattern.test(text)) hits.push({ path, line: line + 1, text: text.slice(0, 300) });
			});
		});
	}

	return hits;
};

export const searchProject = async (cwd, query, { caseSensitive, wholeWord, regex, include, exclude } = {}) => {
	if (typeof query !== 'string' || query.length < 2) return [];
	if (regex) return searchWithExpression(cwd, query, { caseSensitive, wholeWord, regex, include, exclude });

	const flags = ['-n', '-I', ...(caseSensitive ? [] : ['-i']), ...(wholeWord ? ['-w'] : []), '-F'];
	const files = await listFiles(cwd);
	const git = await run(['git', 'grep', '--untracked', ...flags, '-e', query], cwd);
	// Outside git, grep walks the folder itself (a file list as arguments overflows on a big project); its hits
	// are filtered against the listing like git's
	const fallback =
		git.code <= 1 ? null : await run(['grep', '-r', ...flags, ...SKIPPED_DIRECTORIES, '-e', query, '.'], cwd);

	if (fallback && fallback.code > 1) throw new SearchError('Search failed.');

	const output = fallback ? fallback.out.replaceAll(/^\.\//gm, '') : git.out;
	const listed = new Set(files);
	const wanted = pathFilter({ include, exclude });
	const hits = [];

	for (const line of output.split('\n')) {
		const match = line.match(/^(.+?):(\d+):(.*)$/);

		if (!match || !listed.has(match[1]) || !wanted(match[1])) continue;

		hits.push({ path: match[1], line: Number(match[2]), text: match[3].slice(0, 300) });
		if (hits.length >= MAX_HITS) break;
	}

	return hits;
};

// Every listed file a search matches, however many: [path]
const matchingFiles = async (cwd, query, { caseSensitive, wholeWord, regex, include, exclude } = {}) => {
	const flags = ['-l', '-I', ...(caseSensitive ? [] : ['-i']), ...(wholeWord ? ['-w'] : []), regex ? '-E' : '-F'];
	const git = await run(['git', 'grep', '--untracked', ...flags, '-e', query], cwd);
	const found =
		git.code <= 1 ? git.out : (await run(['grep', '-r', ...flags, ...SKIPPED_DIRECTORIES, '-e', query, '.'], cwd)).out;
	const listed = new Set(await listFiles(cwd));

	const wanted = pathFilter({ include, exclude });

	return found
		.split('\n')
		.map(path => path.replace(/^\.\//, ''))
		.filter(path => listed.has(path) && !isSecret(path) && wanted(path));
};

// A search's every match, across the project, replaced: { files, replacements }. A literal search replaces
// literally; a regular expression's replacement can use its groups ($1).
export const replaceInProject = async (cwd, query, replacement, options = {}) => {
	if (typeof query !== 'string' || query.length < 2) throw new SearchError('Search for two characters or more.');
	if (typeof replacement !== 'string') throw new SearchError('Say what to replace it with.');

	const pattern = searchPattern(query, options, 'g');

	if (!pattern) throw new SearchError('That regular expression is not valid.');

	let files = 0;
	let replacements = 0;

	// grep speaks POSIX expressions, not JavaScript's: for an expression every file is checked with the very pattern
	// that replaces, so what matches is what changes
	const candidates = options.regex
		? (await listFiles(cwd)).filter(path => !isSecret(path) && pathFilter(options)(path))
		: await matchingFiles(cwd, query, options);

	for (const path of candidates) {
		const file = Bun.file(resolve(cwd, path));

		if (file.size > MAX_BYTES) continue;

		const text = await file.text();

		if (text.includes('\0')) continue;

		let count = 0;
		const replaced = text.replace(pattern, (...match) => {
			count += 1;

			// $1, $2 and $& from a regular expression's groups; anything else as typed
			return options.regex
				? replacement.replace(/\$(\d+|&)/g, (_, group) => (group === '&' ? match[0] : (match[Number(group)] ?? '')))
				: replacement;
		});

		if (!count) continue;
		await Bun.write(file, replaced);
		files += 1;
		replacements += count;
	}

	return { files, replacements };
};
