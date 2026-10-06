import gitEnvironment from './utils/gitEnvironment';
import { isSecret } from './files';

// git's empty tree, to compare against in a repo with no commit yet
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_DIFF_BYTES = 1024 * 1024;
const STATUS = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'added', T: 'modified' };

const git = async (args, cwd) => {
	const child = Bun.spawn(['git', ...args], { cwd, env: gitEnvironment(), stdout: 'pipe', stderr: 'ignore' });
	const out = await new Response(child.stdout).text();

	return { code: await child.exited, out };
};

const base = async cwd => ((await git(['rev-parse', '--verify', '-q', 'HEAD'], cwd)).code === 0 ? 'HEAD' : EMPTY_TREE);

// What changed in a session's checkout since its last commit, staged or not, plus files git doesn't track yet:
// [{ path, status, from }] with paths relative to the session's folder; null outside git
export const listChanges = async cwd => {
	if ((await git(['rev-parse', '--is-inside-work-tree'], cwd)).code !== 0) return null;

	const tracked = await git(['diff', await base(cwd), '--name-status', '-z', '--relative', '--find-renames'], cwd);
	const fields = tracked.out.split('\0').filter(Boolean);
	const changes = [];

	for (let index = 0; index < fields.length;) {
		const code = fields[index][0];

		if (code === 'R' || code === 'C') {
			changes.push({ path: fields[index + 2], status: STATUS[code], from: fields[index + 1] });
			index += 3;
		} else {
			changes.push({ path: fields[index + 1], status: STATUS[code] ?? 'modified' });
			index += 2;
		}
	}

	const untracked = await git(['ls-files', '--others', '--exclude-standard', '-z'], cwd);

	for (const path of untracked.out.split('\0').filter(Boolean)) changes.push({ path, status: 'untracked' });

	return changes.filter(({ path }) => !isSecret(path)).sort((a, b) => a.path.localeCompare(b.path));
};

// One changed file's unified diff, or null when the path isn't among the changes
export const diffOf = async (cwd, path) => {
	const change = (await listChanges(cwd))?.find(found => found.path === path);

	if (!change) return null;

	const { out } =
		change.status === 'untracked'
			? await git(['diff', '--no-color', '--no-index', '--', '/dev/null', path], cwd)
			: await git(
					[
						'diff',
						await base(cwd),
						'--no-color',
						'--relative',
						'--find-renames',
						'--',
						...(change.from ? [change.from] : []),
						path,
					],
					cwd,
				);

	return out.length > MAX_DIFF_BYTES
		? `${out.slice(0, MAX_DIFF_BYTES)}\n\\ Diff cut short: too big to show here\n`
		: out;
};
