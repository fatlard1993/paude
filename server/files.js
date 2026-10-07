import { realpath } from 'fs/promises';
import { resolve, sep } from 'path';

import searchPattern from '../shared/searchPattern';
import { pathFilter } from '../shared/globs';
import gitEnvironment from './utils/gitEnvironment';

const MAX_FILES = 20_000;
const MAX_BYTES = 1024 * 1024;
const MAX_RAW_BYTES = 50 * 1024 * 1024;
const MAX_HITS = 300;
const LISTING_TTL_MS = 2000;
const SEARCH_TIMEOUT_MS = 10_000;
// Outside git there's no ignore file to go by, so the usual heavy and private folders are skipped by name
const SKIPPED_OUTSIDE_GIT = /(^|\/)(node_modules|\.git|build|dist|\.env[^/]*)(\/|$)/;
// Secrets a project may not have told git to ignore stay out of every listing, for guests above all
const SECRET =
	/(^|\/)(\.env(\.[^/]*)?|\.mcp\.json|\.npmrc|\.netrc|id_(rsa|ed25519|ecdsa)[^/]*|[^/]*\.(pem|key|p12|pfx)|\.claude\/settings\.local\.json)$/;

export const isSecret = path => SECRET.test(path);

const SKIPPED_DIRECTORIES = ['node_modules', '.git', 'build', 'dist'].map(name => `--exclude-dir=${name}`);

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

const walk = async cwd => {
	const files = [];

	for await (const path of new Bun.Glob('**/*').scan({ cwd, onlyFiles: true, dot: false })) {
		if (SKIPPED_OUTSIDE_GIT.test(path)) continue;

		files.push(path);
		if (files.length >= MAX_FILES) break;
	}

	return files;
};

// The files a project shows: what git tracks plus untracked files it doesn't ignore, so .env files, build output
// and dependencies stay out. Everything else here is checked against this list.
export const listFiles = async cwd => {
	const cached = listings.get(cwd);

	if (cached && Date.now() - cached.at < LISTING_TTL_MS) return cached.files;

	const git = await run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd);
	const files = (git.code === 0 ? git.out.split('\0').filter(Boolean) : await walk(cwd))
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
export const searchProject = async (cwd, query, { caseSensitive, wholeWord, regex, include, exclude } = {}) => {
	if (typeof query !== 'string' || query.length < 2) return [];

	const flags = ['-n', '-I', ...(caseSensitive ? [] : ['-i']), ...(wholeWord ? ['-w'] : []), regex ? '-E' : '-F'];
	const files = await listFiles(cwd);
	const git = await run(['git', 'grep', '--untracked', ...flags, '-e', query], cwd);
	// Outside git, grep walks the folder itself (a file list as arguments overflows on a big project); its hits
	// are filtered against the listing like git's
	const fallback =
		git.code <= 1 ? null : await run(['grep', '-r', ...flags, ...SKIPPED_DIRECTORIES, '-e', query, '.'], cwd);

	if (fallback && fallback.code > 1)
		throw new SearchError(regex ? 'That regular expression is not valid.' : 'Search failed.');

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
