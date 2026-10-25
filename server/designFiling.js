import { mkdtemp, rm, symlink } from 'fs/promises';
import os from 'os';
import path from 'path';

import { fileDocument } from './git';
import { jsonIn } from './haiku';
import gitEnvironment from './utils/gitEnvironment';

// What a session settled that is design intent, filed into the design document (.lld.md) it belongs in, or into the
// claim of one it overrules: the document is what the code is held to now, so a claim goes in only once the code is
// shown to hold it. Claude drafts the claim with a perspective that checks it; lldtdd runs the document as it is and as
// drafted, and the draft is filed only if it adds a passing claim (or turns a failing one) and breaks none. One that
// doesn't hold is what the code doesn't do: never built, or overruled since, and nothing is written.
const SOURCE_CHARACTERS = 16_000;
const RUN_TIMEOUT_MS = 180_000;

// The code a document describes, as lldtdd finds it from its `> module` line: from the document's folder when it starts
// ./ or ../, else from the top of the repository; null when there's none, or it leads out of the repository
export const describedModule = (file, text) => {
	const named = /^>\s*(\S+)/m.exec(text)?.[1];

	if (!named) return null;

	const found = path.normalize(/^\.\.?\//.test(named) ? path.join(path.dirname(file), named) : named);

	return found.startsWith('..') || path.isAbsolute(found) ? null : found;
};

export const designPrompt = ({ file, document, source, decision, subjects = [] }) =>
	[
		`Below is a design document, ${file}, for lldtdd: each claim is a bullet saying what the code does, and an indented perspective under it checks it, as a call written out in full. Then the code it describes, and something settled in a conversation about that code.`,
		decision.overrules
			? `What was settled overrules this claim in the document: "${decision.overrules.claim}". Write the whole document anew with that claim (and its perspectives) changed to what was settled, and nothing else changed.`
			: 'What was settled is design intent the document does not claim yet. Write the whole document anew with it added as a claim, under the section it belongs to (or a new one), and nothing else changed.',
		"The claim says what was settled as what the code does, and what was rejected where a naive implementer would choose that; its perspective checks it the way this document's other perspectives are written, against the code below. Write it as settled even where the code seems to do otherwise: running it decides, and a claim bent to fit the code would hide that. Only when it can't be checked against this code at all, reply with an empty document.",
		`Also a commit message for the document's change: a subject in the form of these recent ones, and a body saying why the design is this way, in plain sentences, only from what was settled; never "the user".\n${subjects.map(subject => `- ${subject}`).join('\n')}`,
		'Reply with only a JSON object: {"document": the whole new document, or "", "message": the commit message}.',
		`The document:\n${document}`,
		source && `The code it describes:\n${source}`,
		[
			`Settled: ${decision.chose}`,
			decision.rejected && `Rejected: ${decision.rejected}`,
			decision.because && `Because: ${decision.because}`,
		]
			.filter(Boolean)
			.join('\n'),
	]
		.filter(Boolean)
		.join('\n\n');

// Claude's reply as { document, message }; null for no reply, an empty document when it can't be checked
export const parseDesign = reply => {
	const json = jsonIn(reply);

	if (!json || typeof json.document !== 'string') return null;

	return {
		document: json.document.trim() ? `${json.document.trim()}\n` : '',
		message: String(json.message ?? '').trim(),
	};
};

// A claim's lines: the one saying it, and those indented under it
const claimBlock = (lines, claim) => {
	const start = lines.findIndex(line => /^\s*-\s/.test(line) && line.includes(claim.slice(0, 60)));

	if (start === -1) return new Set();

	const depth = lines[start].search(/\S/);
	let end = start + 1;

	while (end < lines.length && lines[end].trim() && lines[end].search(/\S/) > depth) end += 1;

	return new Set(lines.slice(start, end));
};

// Whether a draft changed only what it was asked to: added lines, and removed only the overruled claim's
export const changedOnly = (before, after, overrules) => {
	const kept = new Set(after.split('\n'));
	const removed = before.split('\n').filter(line => line.trim() && !kept.has(line));
	const allowed = overrules ? claimBlock(before.split('\n'), overrules.claim) : new Set();

	return removed.every(line => allowed.has(line));
};

// Whether the draft holds against the code: a claim more passes, or one fewer fails, and nothing else got worse
export const holds = (before, after) =>
	after.failed <= before.failed &&
	after.pending <= before.pending &&
	after.shallow <= before.shallow &&
	(after.passed + after.indirect > before.passed + before.indirect || after.failed < before.failed);

// The document run by lldtdd as each text, in a checkout of HEAD of its own beside the person's, with the project's
// installed packages: [outcome per text]. Null when the project hasn't lldtdd installed.
export const runTexts = async (root, file, texts) => {
	if (!(await Bun.file(path.join(root, 'node_modules', 'lldtdd', 'package.json')).exists())) return null;

	const folder = await mkdtemp(path.join(os.tmpdir(), 'paude-design-'));
	const checkout = path.join(folder, 'checkout');
	const git = args => Bun.spawnSync(['git', ...args], { cwd: root, env: gitEnvironment() });

	git(['worktree', 'add', '--detach', '-q', checkout, 'HEAD']);
	try {
		await symlink(path.join(root, 'node_modules'), path.join(checkout, 'node_modules'));

		const outcomes = [];

		for (const text of texts) {
			await Bun.write(path.join(checkout, file), text);

			const child = Bun.spawn(
				[
					process.execPath,
					'-e',
					`import { runAndCheck } from 'lldtdd'; console.log(JSON.stringify(await runAndCheck(${JSON.stringify(file)}, process.cwd(), { silent: true, mutate: false })))`,
				],
				{ cwd: checkout, stdout: 'pipe', stderr: 'pipe', timeout: RUN_TIMEOUT_MS },
			);
			const out = await new Response(child.stdout).text();

			if ((await child.exited) !== 0) throw new Error(`lldtdd couldn't run ${file}`);
			outcomes.push(JSON.parse(out.trim().split('\n').at(-1)));
		}

		return outcomes;
	} finally {
		git(['worktree', 'remove', '--force', checkout]);
		await rm(folder, { recursive: true, force: true });
	}
};

// One decision filed into its design document: { place } (the document, now claiming it), { refuted } (the code
// doesn't hold it, so nothing was written), or null when it can't be told (no lldtdd, nothing Claude could check)
export const fileDesign = async (root, decision, { ask, run = runTexts, file = fileDocument } = {}) => {
	const target = decision.overrules?.file ?? decision.belongs;
	const document = await Bun.file(path.join(root, target)).text();
	const module = describedModule(target, document);
	const source = module
		? (
				await Bun.file(path.join(root, module))
					.text()
					.catch(() => '')
			).slice(0, SOURCE_CHARACTERS)
		: '';
	const subjects = Bun.spawnSync(['git', 'log', '-8', '--format=%s'], { cwd: root, env: gitEnvironment() })
		.stdout.toString()
		.trim()
		.split('\n');
	const draft = parseDesign(await ask(designPrompt({ file: target, document, source, decision, subjects })));

	if (!draft) throw new Error('No answer from Claude');
	if (!draft.document || !draft.message || !changedOnly(document, draft.document, decision.overrules)) return null;

	const outcomes = await run(root, target, [document, draft.document]);

	if (!outcomes) return null;
	if (!holds(...outcomes)) return { refuted: true };
	await file(root, target, draft.document, draft.message);

	return { place: target };
};
