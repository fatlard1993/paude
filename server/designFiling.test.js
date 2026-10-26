import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { changedOnly, describedModule, designPrompt, fileDesign, holds, parseDesign, runTexts } from './designFiling';

const DOCUMENT = `# Tooltip
> ./Tooltip.js

## Position

- there are nine valid positions; anything else throws
  - new Subject({ position: "nowhere" }) -> \`Error\`
- one position class is active at a time
`;

let root;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), 'paude-design-'));
	await mkdir(path.join(root, 'Tooltip'));
	await writeFile(path.join(root, 'Tooltip', 'Tooltip.lld.md'), DOCUMENT);
	await writeFile(path.join(root, 'Tooltip', 'Tooltip.js'), 'export default class Tooltip {}\n');
	Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const outcome = (passed, failed = 0) => ({ passed, failed, pending: 0, indirect: 0, shallow: 0 });

test("a document's code is its > line: from its folder when ./ or ../, else from the top, never outside", () => {
	expect(describedModule('Tooltip/Tooltip.lld.md', DOCUMENT)).toBe('Tooltip/Tooltip.js');
	expect(describedModule('lld/component.lld.md', '# C\n\n> Component/Component.js\n')).toBe('Component/Component.js');
	expect(describedModule('a/b.lld.md', '> ../c.js')).toBe('c.js');
	expect(describedModule('a.lld.md', '> ../../etc/passwd')).toBeNull();
	expect(describedModule('a.lld.md', '# A\n')).toBeNull();
});

test('a draft is the whole document and a message; empty when it could not be checked', () => {
	expect(parseDesign('{"document": "# A\\n- x", "message": "a: x"}')).toEqual({
		document: '# A\n- x\n',
		message: 'a: x',
	});
	expect(parseDesign('{"document": "", "message": ""}')).toEqual({ document: '', message: '' });
	expect(parseDesign('no')).toBeNull();
});

test('a draft may add claims, and remove only the claim it overrules with its perspectives', () => {
	const added = DOCUMENT.replace('- one position', '- hides when its anchor scrolls away\n- one position');
	const changed = DOCUMENT.replace(
		'- there are nine valid positions; anything else throws\n  - new Subject({ position: "nowhere" }) -> `Error`',
		'- an unknown position falls back to top\n  - new Subject({ position: "nowhere" }).position === "top"',
	);
	const overrules = { claim: 'there are nine valid positions; anything else throws' };

	expect(changedOnly(DOCUMENT, added)).toBe(true);
	expect(changedOnly(DOCUMENT, DOCUMENT.replace('- one position class is active at a time\n', ''))).toBe(false);
	expect(changedOnly(DOCUMENT, changed, overrules)).toBe(true);
	expect(changedOnly(DOCUMENT, changed.replace('- one position class is active at a time\n', ''), overrules)).toBe(
		false,
	);
	expect(changedOnly(DOCUMENT, changed)).toBe(false);
});

test('a draft holds when a claim more passes or one fewer fails, and nothing gets worse', () => {
	expect(holds(outcome(2), outcome(3))).toBe(true);
	expect(holds(outcome(2, 1), outcome(2))).toBe(true);
	expect(holds(outcome(2), outcome(2, 1))).toBe(false);
	expect(holds(outcome(2), outcome(2))).toBe(false);
	expect(holds(outcome(2), { ...outcome(3), pending: 1 })).toBe(false);
});

test('the prompt asks to add a claim, or to change the one overruled, against the code', () => {
	const decision = { chose: 'Hides when its anchor scrolls away', rejected: 'Staying pinned' };

	expect(designPrompt({ file: 'Tooltip.lld.md', document: DOCUMENT, source: 'class', decision })).toContain(
		'design intent the document does not claim yet',
	);
	expect(
		designPrompt({
			file: 'Tooltip.lld.md',
			document: DOCUMENT,
			decision: { ...decision, overrules: { file: 'Tooltip.lld.md', claim: 'anything else throws' } },
		}),
	).toContain('overrules this claim in the document: "anything else throws"');
});

test('a claim that holds is filed into its document; one the code does not hold is refuted, and nothing written', async () => {
	const decision = { chose: 'Hides when its anchor scrolls away', belongs: 'Tooltip/Tooltip.lld.md' };
	const draft = DOCUMENT.replace('- one position', '- hides when its anchor scrolls away\n- one position');
	const ask = async prompt => {
		expect(prompt).toContain('export default class Tooltip');

		return JSON.stringify({ document: draft, message: 'Tooltip: hides when its anchor scrolls away' });
	};
	const filed = [];
	const file = async (...args) => filed.push(args);

	expect(await fileDesign(root, decision, { ask, run: async () => [outcome(2), outcome(3)], file })).toEqual({
		place: 'Tooltip/Tooltip.lld.md',
	});
	expect(filed).toEqual([[root, 'Tooltip/Tooltip.lld.md', draft, 'Tooltip: hides when its anchor scrolls away']]);

	filed.length = 0;
	expect(await fileDesign(root, decision, { ask, run: async () => [outcome(2), outcome(2, 1)], file })).toEqual({
		refuted: true,
	});
	expect(filed).toEqual([]);

	// Nothing to check it with, or nothing Claude could check
	expect(await fileDesign(root, decision, { ask, run: async () => null, file })).toBeNull();
	expect(
		await fileDesign(root, decision, { ask: async () => '{"document": "", "message": ""}', run: async () => [], file }),
	).toBeNull();
	expect(filed).toEqual([]);
});

test("a project lldtdd can't be imported in isn't run", async () => {
	expect(await runTexts(root, 'Tooltip/Tooltip.lld.md', [DOCUMENT])).toBeNull();
});
