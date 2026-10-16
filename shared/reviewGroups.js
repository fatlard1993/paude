import { parseDiff, sideBySide } from './diff';

// Groupings of a change worked out from the diff and the files' outlines alone, the same every time: a rename swept
// across files told once, and the change read function by function, a changed signature before where it's used.

const TOKEN = /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|\S/g;
const WORD = /^[A-Za-z_$][\w$]*$/;

const tokens = text => text.match(TOKEN) ?? [];

// A changed line as a rename: the words that differ, each replaced everywhere it was in the line ({ [from]: to }),
// or null when the line changed in some other way
export const renamesIn = (before, after) => {
	const [a, b] = [tokens(before), tokens(after)];

	if (a.length !== b.length) return null;

	const renames = {};

	for (const [index, word] of a.entries()) {
		if (word === b[index]) continue;
		if (!WORD.test(word) || !WORD.test(b[index]) || (renames[word] && renames[word] !== b[index])) return null;
		renames[word] = b[index];
	}

	// A word renamed in one place and kept in another isn't a rename of it
	if (a.some((word, index) => renames[word] && b[index] === word)) return null;

	return Object.keys(renames).length ? renames : null;
};

// A file's change as renames: { renames, only, lines }, where only says every line it changes is one of them, and
// lines how many it renames in; null when none of its lines is
export const fileRenames = diff => {
	const renames = {};
	let only = true;
	let count = 0;

	for (const { lines } of parseDiff(diff ?? '').hunks) {
		for (const { left, right } of sideBySide(lines)) {
			if (left?.line.kind !== 'removed' && right?.line.kind !== 'added') continue;

			const found = left && right && left.line.kind === 'removed' && renamesIn(left.line.text, right.line.text);

			if (!found || Object.entries(found).some(([from, to]) => renames[from] && renames[from] !== to)) {
				only = false;
				continue;
			}
			Object.assign(renames, found);
			count += 1;
		}
	}

	return Object.keys(renames).length ? { renames, only, lines: count } : null;
};

export const sayRenames = renames =>
	Object.entries(renames)
		.map(([from, to]) => `${from} → ${to}`)
		.join(', ');

// Renames swept across files: the files whose whole change is the same renames, two or more of them, as
// [{ renames, paths }]
export const renameSweeps = files => {
	const sweeps = new Map();

	for (const file of files) {
		const found = fileRenames(file.diff);

		if (!found?.only) continue;

		const key = sayRenames(Object.fromEntries(Object.entries(found.renames).sort()));

		if (!sweeps.has(key)) sweeps.set(key, { renames: found.renames, paths: [] });
		sweeps.get(key).paths.push(file.path);
	}

	return [...sweeps.values()].filter(sweep => sweep.paths.length > 1);
};

const countOf = (lines, side) => lines.filter(line => line[side] !== undefined && line.kind !== 'note').length;

// Hunks back as diff text, with headers that keep their lines' numbers
export const hunksText = hunks =>
	hunks
		.map(({ oldStart, newStart, heading, lines }) =>
			[
				`@@ -${oldStart},${countOf(lines, 'old')} +${newStart},${countOf(lines, 'new')} @@${heading ? ` ${heading}` : ''}`,
				...lines.map(line =>
					line.kind === 'note'
						? `\\ ${line.text}`
						: `${{ added: '+', removed: '-', context: ' ' }[line.kind]}${line.text}`,
				),
			].join('\n'),
		)
		.join('\n');

const words = lines => new Set(lines.flatMap(line => line.text.match(/[A-Za-z_$][\w$]*/g) ?? []));

// Each hunk with the function, class or type it's in (the nearest declaration above its first change, in the file as
// it is now), whether it changes that declaration's own line (its signature) or adds it (it's new), and the words its
// changed lines use
const hunksOf = (file, outline) => {
	const declarations = [...(outline ?? [])].sort((a, b) => a.line - b.line);

	return parseDiff(file.diff ?? '').hunks.map(hunk => {
		const changed = hunk.lines.filter(line => line.kind === 'added' || line.kind === 'removed');
		const added = new Set(changed.filter(line => line.kind === 'added').map(line => line.new));
		const declared = declarations.find(declaration => added.has(declaration.line));
		const first = changed.find(line => line.new !== undefined)?.new ?? hunk.newStart;
		// A declaration line added where a removed line named it changed its signature; with no such line, it's new
		const removedWords = words(changed.filter(line => line.kind === 'removed'));

		return {
			file,
			hunk,
			owner: declared ?? declarations.findLast(declaration => declaration.line <= first) ?? null,
			signature: Boolean(declared) && removedWords.has(declared.name),
			added: Boolean(declared) && !removedWords.has(declared.name),
			words: words(changed),
		};
	});
};

const SCRIPT = /\.(m?[jt]sx?|c[jt]s|py)$/;

// Whether a hunk in another file can be using a declaration: where imports are read (JavaScript, TypeScript, Python),
// only from a file that imports the declaring one; elsewhere, by its name alone
const reaches = (user, owner, imports) =>
	user.file === owner.file || !SCRIPT.test(user.file.path) || (imports[user.file.path] ?? []).includes(owner.file.path);

// What comes first: a changed signature (its callers may have to change), then what's new, then what changed inside
const RANK = { signature: 0, added: 1, changed: 2 };

// The change read function by function: each changed function, class or type, its own hunks, then the hunks
// elsewhere that use it; then what falls in none. `outlines` maps a path to its declarations ([{ name, kind, line }]);
// `imports`, a path to the changed paths it imports. Resolves to entries like files, a file's hunks split among them,
// each with the `group` it's read in and its `part` there ('signature changed', 'new', 'changed', 'uses name'); null
// when no declaration is known, to read file by file instead.
export const byFunction = (files, outlines = {}, imports = {}) => {
	const hunks = files.flatMap(file => hunksOf(file, outlines[file.path]));

	if (!hunks.some(each => each.owner)) return null;

	const keyOf = each => each.owner && `${each.file.path}#${each.owner.name}#${each.owner.line}`;
	const kindOf = key => {
		const own = hunks.filter(each => keyOf(each) === key);

		if (own.some(each => each.signature)) return 'signature';

		return own.some(each => each.added) ? 'added' : 'changed';
	};
	const owners = [];

	for (const each of hunks) if (each.owner && !owners.some(owner => keyOf(owner) === keyOf(each))) owners.push(each);
	owners.sort((a, b) => RANK[kindOf(keyOf(a))] - RANK[kindOf(keyOf(b))]);

	const placed = new Set();
	const entries = [];
	const add = (list, group, part) => {
		for (const file of files) {
			const own = list.filter(each => each.file === file);

			if (!own.length) continue;
			own.forEach(each => placed.add(each));
			entries.push({ ...file, diff: hunksText(own.map(each => each.hunk)), group, part });
		}
	};

	for (const owner of owners) {
		const key = keyOf(owner);
		const { name } = owner.owner;
		const own = hunks.filter(each => keyOf(each) === key && !placed.has(each));

		if (!own.length) continue;

		const kind = kindOf(key);
		const group = {
			signature: `${name} in ${owner.file.path}: its signature changed`,
			added: `${name} in ${owner.file.path}: new`,
			changed: `${name} in ${owner.file.path}`,
		}[kind];

		add(own, group, { signature: 'signature changed', added: 'new', changed: 'changed' }[kind]);
		add(
			hunks.filter(
				each => !placed.has(each) && keyOf(each) !== key && each.words.has(name) && reaches(each, owner, imports),
			),
			group,
			`uses ${name}`,
		);
	}

	add(
		hunks.filter(each => !placed.has(each)),
		'Outside any function',
		'',
	);

	return entries;
};
