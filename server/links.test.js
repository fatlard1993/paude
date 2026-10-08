import { expect, test } from 'bun:test';

import { byPinnedThenRecent, kindOf, linksOfLine, saysBetter, urlsIn } from './links';

test('sorts a link into its kind', () => {
	expect(kindOf('https://github.com/acme/shop/issues/12')).toBe('ticket');
	expect(kindOf('https://acme.atlassian.net/browse/SHOP-4')).toBe('ticket');
	expect(kindOf('https://github.com/acme/shop')).toBe('repo');
	expect(kindOf('https://docs.python.org/3/library/re.html')).toBe('docs');
	expect(kindOf('https://bun.sh/docs/api/spawn')).toBe('docs');
	expect(kindOf('http://localhost:5173/')).toBe('server');
	expect(kindOf('https://40.160.139.189')).toBe('server');
	expect(kindOf('https://dellbook.local')).toBe('server');
	expect(kindOf('https://news.ycombinator.com/item?id=1')).toBe('reference');
});

test('finds links in prose, without the sentence around them or what only looks like one', () => {
	const found = urlsIn(
		'The spawn API is at https://bun.sh/docs. Also (https://github.com/acme/shop), not https://$host.local, nor https://example.com/x, nor http://127.0.0.1:41307/chunk.js:2958:7657',
	);

	expect(found.map(({ url }) => url)).toEqual(['https://bun.sh/docs', 'https://github.com/acme/shop']);
	expect(found[0].context).toBe('The spawn API is at bun.sh/docs.');
});

test('names a link by its markdown words or its search title, and says nothing a title already says', () => {
	const [docs] = urlsIn('**Next:** read [the spawn docs](https://bun.sh/docs/api/spawn) before changing it.');
	const [alone] = urlsIn('- [Cursor guide (DeployHQ)](https://deployhq.com/guides/cursor)');
	const [result] = urlsIn('Links: [{"title":"A deep dive into Herdr","url":"https://flaviocopes.com/herdr/"}]');
	const [host] = urlsIn('[{"title":"github.com","url":"https://github.com/brac/herdr"}]');

	expect(docs).toMatchObject({ title: 'the spawn docs', context: 'Next: read the spawn docs before changing it.' });
	expect(urlsIn('Is https://acme.dev/a still behind https://acme.dev/b today?')[0].context).toBe(
		'Is acme.dev/a still behind acme.dev/b today?',
	);
	expect(alone).toMatchObject({ title: 'Cursor guide (DeployHQ)', context: '' });
	expect(result.title).toBe('A deep dive into Herdr');
	expect(host.title).toBe('');
});

test('quotes the sentence a link is in, but not a code block, and clips a long one at a word', () => {
	const text = `Start here. Run it like so:\n\`\`\`sh\ncurl -fsSL https://get.acme.dev/install.sh | sh\n\`\`\`\nThen open https://acme.local and log in with ${'more and more words '.repeat(12)}`;
	const [inCode, after] = urlsIn(text);

	expect(inCode.context).toBe('');
	expect(after.context.startsWith('Then open acme.local and log in with more')).toBe(true);
	expect(after.context.endsWith('…')).toBe(true);
	expect(after.context.length).toBeLessThan(170);
});

test("a person's words say what a link is over Claude's, never a command's; a summary is Claude's", () => {
	const quiet = new Set();
	const said = lines => lines.flatMap(line => linksOfLine(line, quiet)).map(({ by, context }) => `${by}: ${context}`);

	expect(
		said([
			{
				type: 'user',
				message: { content: [{ type: 'tool_result', tool_use_id: 'b', content: 'Serving at https://acme.local now' }] },
			},
			{ type: 'user', isCompactSummary: true, message: { content: 'Earlier we set up https://acme.local for you.' } },
			{ type: 'user', isMeta: true, message: { content: 'Skill docs: https://acme.dev/skills are here.' } },
		]),
	).toEqual(['output: ', 'Claude: Earlier we set up acme.local for you.']);
	expect(saysBetter('you', 'Claude')).toBe(true);
	expect(saysBetter('chase', 'fetched')).toBe(true);
	expect(saysBetter('output', 'fetched')).toBe(false);
});

test("takes links from prompts, Claude's words, fetches and command output, never from files read", () => {
	const quiet = new Set();
	const lines = [
		{ type: 'user', message: { content: 'look at https://github.com/acme/shop/pull/7' } },
		{ type: 'assistant', message: { content: [{ type: 'text', text: 'The docs: https://docs.acme.dev/api' }] } },
		{
			type: 'assistant',
			message: {
				content: [
					{
						type: 'tool_use',
						id: 'f',
						name: 'WebFetch',
						input: { url: 'https://blog.acme.dev/post', prompt: 'summarize' },
					},
					{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: '/x/package-lock.json' } },
				],
			},
		},
		{
			type: 'user',
			message: { content: [{ type: 'tool_result', tool_use_id: 'r', content: 'https://registry.npmjs.org/lots' }] },
		},
		{
			type: 'user',
			message: {
				content: [{ type: 'tool_result', tool_use_id: 'b', content: 'Opened https://github.com/acme/shop/pull/8' }],
			},
		},
	];

	expect(lines.flatMap(line => linksOfLine(line, quiet)).map(({ url, by }) => `${by} ${url}`)).toEqual([
		'you https://github.com/acme/shop/pull/7',
		'Claude https://docs.acme.dev/api',
		'fetched https://blog.acme.dev/post',
		'output https://github.com/acme/shop/pull/8',
	]);
});

test('lists the pinned first, then by the day each last came up, the most mentioned first within a day', () => {
	const link = (url, lastAt, count, pinned = false) => ({ url, lastAt, count, pinned });
	const sorted = [
		link('once-today-late', '2026-10-08T15:00:00', 1),
		link('thrice-today-early', '2026-10-08T09:00:00', 3),
		link('often-yesterday', '2026-10-07T12:00:00', 9),
		link('pinned-old', '2026-09-01T12:00:00', 1, true),
		link('once-today-early', '2026-10-08T08:00:00', 1),
	]
		.sort(byPinnedThenRecent)
		.map(({ url }) => url);

	expect(sorted).toEqual(['pinned-old', 'thrice-today-early', 'once-today-late', 'once-today-early', 'often-yesterday']);
});
