import { expect, test } from 'bun:test';

import { kindOf, linksOfLine, urlsIn } from './links';

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
		'See https://bun.sh/docs. Also (https://github.com/acme/shop), not https://$host.local, nor https://example.com/x, nor http://127.0.0.1:41307/chunk.js:2958:7657',
	);

	expect(found.map(({ url }) => url)).toEqual(['https://bun.sh/docs', 'https://github.com/acme/shop']);
	expect(found[0].context).toContain('See https://bun.sh/docs');
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
