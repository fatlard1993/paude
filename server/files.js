import { realpath } from 'fs/promises';
import { resolve, sep } from 'path';

const MAX_FILES = 20_000;
const MAX_BYTES = 1024 * 1024;
const MAX_HITS = 300;
const LISTING_TTL_MS = 2000;
// Outside git there's no ignore file to go by, so the usual heavy and private folders are skipped by name
const SKIPPED_OUTSIDE_GIT = /(^|\/)(node_modules|\.git|build|dist|\.env[^/]*)(\/|$)/;

const SKIPPED_DIRECTORIES = ['node_modules', '.git', 'build', 'dist'].map(name => `--exclude-dir=${name}`);

const listings = new Map();

const run = async (args, cwd) => {
	const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'ignore' });
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
	const files = (git.code === 0 ? git.out.split('\0').filter(Boolean) : await walk(cwd)).slice(0, MAX_FILES).sort();

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

export const readProjectFile = async (cwd, path) => {
	if (!(await listFiles(cwd)).includes(path) || !(await insideProject(cwd, path))) return { status: 404 };

	const file = Bun.file(resolve(cwd, path));

	if (file.size > MAX_BYTES) return { status: 413 };

	const bytes = new Uint8Array(await file.arrayBuffer());

	if (bytes.subarray(0, 8000).includes(0)) return { status: 415 };

	return { status: 200, text: new TextDecoder().decode(bytes) };
};

// Case-insensitive literal search through the listed files
export const searchProject = async (cwd, query) => {
	if (typeof query !== 'string' || query.length < 2) return [];

	const files = await listFiles(cwd);
	const git = await run(['git', 'grep', '--untracked', '-n', '-I', '-i', '-F', '-e', query], cwd);
	// Outside git, grep walks the folder itself (a file list as arguments overflows on a big project); its hits
	// are filtered against the listing like git's
	const output =
		git.code <= 1
			? git.out
			: (
					await run(['grep', '-r', '-n', '-I', '-i', '-F', ...SKIPPED_DIRECTORIES, '-e', query, '.'], cwd)
				).out.replaceAll(/^\.\//gm, '');
	const listed = new Set(files);
	const hits = [];

	for (const line of output.split('\n')) {
		const match = line.match(/^(.+?):(\d+):(.*)$/);

		if (!match || !listed.has(match[1])) continue;

		hits.push({ path: match[1], line: Number(match[2]), text: match[3].slice(0, 300) });
		if (hits.length >= MAX_HITS) break;
	}

	return hits;
};
