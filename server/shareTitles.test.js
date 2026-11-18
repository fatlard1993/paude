import { afterAll, expect, test } from 'bun:test';

import { namePrompt, titleIn, titleOf, toName } from './shareTitles';

const page = Bun.serve({
	port: 0,
	fetch: () =>
		new Response('<html><head><title> Product &amp; Pricing\n Admin </title></head></html>', {
			headers: { 'content-type': 'text/html' },
		}),
});

afterAll(() => page.stop(true));

const service = { kind: 'port', auto: true, sessionId: 'nobody', host: '127.0.0.1', port: page.port, pid: process.pid };

test("a page's title reads as plain words", () => {
	expect(titleIn('<TITLE lang="en">Docs &lt;v2&gt;</TITLE>')).toBe('Docs <v2>');
	expect(titleIn('<title></title>')).toBeNull();
	expect(titleIn('no page here')).toBeNull();
});

test("Haiku names a service from its command, with its page's title as a hint, not the name", async () => {
	const [read] = await toName([service]);

	expect(read).toMatchObject({ port: page.port, title: 'Product & Pricing Admin' });
	expect(read.args).toContain('bun');
	expect(titleOf(service)).toBeNull();

	const prompt = namePrompt([read]);

	expect(prompt).toContain(`1. port ${page.port} · ${read.project} · ${read.args}`);
	expect(prompt).toContain('page title: Product & Pricing Admin');
});

test('a share named by hand, or a file, is not named again', async () => {
	expect(
		await toName([
			{ ...service, named: true },
			{ kind: 'file', path: 'dist/app.zip' },
		]),
	).toEqual([]);
	expect(titleOf({ ...service, named: true })).toBeNull();
});
