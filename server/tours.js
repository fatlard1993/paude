import { parseDiff } from '../shared/diff';
import { orderFiles } from '../shared/reviewOrder';
import askHaiku, { jsonIn } from './haiku';

// A guided tour of something: an overview, then stops to step through, each on a place (a turn of the session, or
// lines of a file or a diff), and what it leaves out. Haiku tells it, on the owner's login, only when asked; a tour of
// the same thing is told once.
const MAX_LINES = 1500;
const MAX_CHARACTERS = 90_000;
const MAX_STOPS = 14;
// The most of the commit messages a diff's tour is told, besides the diff
const MAX_WHY = 12_000;
// A stretch no stop covers is worth saying from this long
const GAP_LINES = 8;
const NAMED_GAPS = 3;
const TOLD_KEPT = 50;
const told = new Map();

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// The same prompt is told once, the latest few kept; a reply with nothing in it, or a failure, is asked again next
// time. `ask` is Haiku but in tests.
export const tellOnce = (prompt, parse, ask = askHaiku) => {
	const kept = told.get(prompt);

	if (kept) {
		// Used again, so kept longest
		told.delete(prompt);
		told.set(prompt, kept);

		return kept;
	}

	const tour = Promise.resolve()
		.then(() => ask(prompt))
		.then(parse);
	const forget = () => told.get(prompt) === tour && told.delete(prompt);

	told.set(prompt, tour);
	tour.then(found => !found && forget(), forget);
	while (told.size > TOLD_KEPT) told.delete(told.keys().next().value);

	return tour;
};

const STYLE = [
	'Plain words, no markdown, no filler, no praise. Explain what it does, why it matters and how the parts fit together; never narrate it line by line.',
	'An overview of 2 or 3 sentences, then 3 to 12 stops in the order that best explains it (following the flow of data or control, not necessarily top to bottom). Each stop is 1 to 3 sentences on a range of lines.',
];

const numbered = (lines, first) => lines.map((line, index) => `${first + index} | ${line}`).join('\n');

// Lines of one file, or a part of it, or one function or class in it (`focus`: { name, line })
export const codePrompt = ({ path, lines, from, focus }) =>
	[
		focus
			? `Walk someone through ${focus.name} in ${path}, which starts at line ${focus.line}, as a guided tour. Stay within it; where it ends is for you to find.`
			: `Walk someone through ${path}${from > 1 || lines.length < MAX_LINES ? `, lines ${from}-${from + lines.length - 1}` : ''}, as a guided tour.`,
		...STYLE,
		'Reply with only a JSON object: {"overview": "…", "stops": [{"from": 12, "to": 30, "text": "…"}]}, with line numbers as shown.',
		numbered(lines, from),
	].join('\n\n');

// A diff's lines, each marked and numbered on its side: added and unchanged lines by the file after the change,
// removed ones by the file before it
const shownDiff = files =>
	files
		.map(({ path, status, diff }) => {
			const rows = parseDiff(diff ?? '').hunks.flatMap(({ lines }) =>
				lines
					.filter(line => line.kind !== 'note')
					.map(line =>
						line.kind === 'removed'
							? `- ${line.old} | ${line.text}`
							: `${line.kind === 'added' ? '+' : ' '} ${line.new} | ${line.text}`,
					),
			);

			return `File ${path} (${status})\n${rows.join('\n') || '(no text changes shown)'}`;
		})
		.join('\n\n');

export const diffPrompt = (title, files, why) =>
	[
		`Walk someone through this change (${title}) as a guided tour: what it does and why, in the order that makes it make sense.`,
		...STYLE,
		why &&
			`Its commit messages say why, and what was chosen over what; take the why from them where the lines don't show it, and never invent one they don't state:\n${why}`,
		'Lines marked + were added, - removed, the rest unchanged; each is numbered as it is on its side: + and unchanged lines by the file after the change, - lines by the file before it.',
		'Reply with only a JSON object: {"overview": "…", "stops": [{"file": "path", "side": "new", "from": 12, "to": 30, "text": "…"}]}, where side is "old" for removed lines and "new" otherwise.',
		shownDiff(files),
	]
		.filter(Boolean)
		.join('\n\n');

const lineNumber = value => (Number.isInteger(value) ? value : Number.parseInt(value, 10));

// Each stop kept on lines that are there: a range inside `valid(path, side)` (a set of line numbers), turned the
// right way round; the rest dropped, and counted
export const parseStops = (reply, { valid, path: only }) => {
	const json = jsonIn(reply);

	if (typeof json?.overview !== 'string' || !Array.isArray(json.stops)) return null;

	const stops = [];
	let dropped = 0;

	for (const stop of json.stops.slice(0, MAX_STOPS)) {
		const path = only ?? String(stop?.file ?? '');
		const side = stop?.side === 'old' ? 'old' : 'new';
		const [from, to] = [lineNumber(stop?.from), lineNumber(stop?.to ?? stop?.from)].sort((a, b) => a - b);
		const lines = valid(path, side);
		const text = String(stop?.text ?? '').trim();

		if (!text || !lines || !lines.has(from) || !lines.has(to)) dropped += 1;
		else stops.push({ path, side, from, to, text });
	}

	return { overview: json.overview.trim(), stops, dropped };
};

// Runs of numbers no stop covers, as [from, to], longest first
const gapsIn = (numbers, covered) => {
	const gaps = [];
	let run = null;
	const close = () => run && run[1] - run[0] + 1 >= GAP_LINES && gaps.push(run);

	for (const line of numbers) {
		if (!covered(line) && run && line === run[1] + 1) run[1] = line;
		else {
			close();
			run = covered(line) ? null : [line, line];
		}
	}
	close();

	return gaps.sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
};

const named = (gaps, place) =>
	[
		...gaps.slice(0, NAMED_GAPS).map(place),
		...(gaps.length > NAMED_GAPS ? [`${plural(gaps.length - NAMED_GAPS, 'more stretch')}`] : []),
	].join(', ');

// What a code tour leaves out: lines it was too long to show, stops that pointed nowhere, stretches no stop is on
export const codeLeftOut = ({ shown, total, stops, dropped, focus }) => {
	const covered = line => stops.some(stop => stop.from <= line && line <= stop.to);
	const gaps = focus ? [] : gapsIn(shown, covered);

	return [
		total > shown.length && `It read only lines ${shown[0]}-${shown.at(-1)} of ${total}.`,
		dropped &&
			`${plural(dropped, 'stop')} pointing at lines that aren't there ${dropped === 1 ? 'was' : 'were'} left out.`,
		gaps.length && `No stop is on ${named(gaps, ([from, to]) => `lines ${from}-${to}`)}.`,
	].filter(Boolean);
};

// What a diff tour leaves out: files it couldn't show, stops that pointed nowhere, and changes no stop is on (a run
// of added or removed lines with no stop on any of it)
export const diffLeftOut = ({ files, skipped, stops, dropped }) => {
	const unexplained = files.flatMap(({ path, diff }) =>
		parseDiff(diff ?? '').hunks.flatMap(({ lines }) => {
			const changed = lines.filter(line => line.kind === 'added' || line.kind === 'removed');
			const onIt = changed.some(line =>
				stops.some(stop => {
					const number = line.kind === 'removed' ? line.old : line.new;

					return (
						stop.path === path &&
						stop.side === (line.kind === 'removed' ? 'old' : 'new') &&
						stop.from <= number &&
						number <= stop.to
					);
				}),
			);
			const first = changed[0];

			return changed.length && !onIt ? [`${path} line ${first.new ?? first.old}`] : [];
		}),
	);

	return [
		skipped && `${plural(skipped, 'file')} too big to read ${skipped === 1 ? 'is' : 'are'} left out.`,
		dropped &&
			`${plural(dropped, 'stop')} pointing at lines that aren't there ${dropped === 1 ? 'was' : 'were'} left out.`,
		unexplained.length &&
			`No stop is on the change at ${[
				...unexplained.slice(0, NAMED_GAPS),
				...(unexplained.length > NAMED_GAPS ? [`${unexplained.length - NAMED_GAPS} more`] : []),
			].join(', ')}.`,
	].filter(Boolean);
};

// A tour of a file's lines: the whole file (as much as fits), the lines from..to, or one function or class (focus)
export const codeTour = async ({ path, text, from = 1, to, focus }) => {
	const all = text.replace(/\n$/, '').split('\n');
	const start = Math.max(1, Math.min(from, all.length));
	let lines = all.slice(start - 1, Math.max(start, to ?? all.length));

	if (lines.length > MAX_LINES) lines = lines.slice(0, MAX_LINES);
	while (lines.join('\n').length > MAX_CHARACTERS && lines.length > 1)
		lines = lines.slice(0, Math.floor(lines.length * 0.8));

	const shown = lines.map((_, index) => start + index);
	const valid = new Set(shown);
	const tour = await tellOnce(codePrompt({ path, lines, from: start, focus }), reply =>
		parseStops(reply, { valid: () => valid, path }),
	);

	if (!tour) return null;

	const total = to ? Math.min(to, all.length) - start + 1 : all.length - start + 1;

	return {
		overview: tour.overview,
		stops: tour.stops,
		leftOut: codeLeftOut({ shown, total, stops: tour.stops, dropped: tour.dropped, focus }),
	};
};

// The files of a diff set a tour can read, in reading order, so what's left out is what matters least: each that
// still fits once those before it are in, a file too big passed over rather than ending it
export const fittingFiles = ({ files, imports, outlines }, most = MAX_CHARACTERS) => {
	const fitting = [];
	let size = 0;

	for (const file of orderFiles(files, 'reading', { imports, outlines })) {
		const length = (file.diff ?? '').length;

		if (size + length > most) continue;
		size += length;
		fitting.push(file);
	}

	return fitting;
};

// Why a diff set's changes were made, as its commits tell it: a commit's message and those recording later what
// explains it, or a branch's commits, oldest first, as many as fit
export const whyOf = ({ message, explainedBy = [], commits = [] }) => {
	const told = [
		message,
		...explainedBy.map(explanation => explanation.body),
		...commits.toReversed().map(commit => commit.body && `${commit.subject}\n${commit.body}`),
	].filter(Boolean);
	const fitting = [];
	let size = 0;

	for (const text of told) {
		size += text.length;
		// One too long on its own is cut short rather than lost
		if (size > MAX_WHY) {
			if (!fitting.length) fitting.push(text.slice(0, MAX_WHY));
			break;
		}
		fitting.push(text);
	}

	return fitting.join('\n\n');
};

// A tour of a diff set, any kind paude shows ({ title, files, imports, and what says why }), as much of it as fits
export const diffTour = async ({ title, files, imports, outlines, ...set }) => {
	const fitting = fittingFiles({ files, imports, outlines });

	const valid = new Map();

	for (const { path, diff } of fitting) {
		const sides = { old: new Set(), new: new Set() };

		for (const { lines } of parseDiff(diff ?? '').hunks)
			for (const line of lines) {
				if (line.old !== undefined && line.kind === 'removed') sides.old.add(line.old);
				if (line.new !== undefined) sides.new.add(line.new);
			}
		valid.set(path, sides);
	}

	const tour = await tellOnce(diffPrompt(title, fitting, whyOf(set)), reply =>
		parseStops(reply, { valid: (path, side) => valid.get(path)?.[side] }),
	);

	if (!tour) return null;

	return {
		overview: tour.overview,
		stops: tour.stops,
		leftOut: diffLeftOut({
			files: fitting,
			skipped: files.length - fitting.length,
			stops: tour.stops,
			dropped: tour.dropped,
		}),
	};
};
