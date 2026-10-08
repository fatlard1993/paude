import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test } from 'bun:test';

import {
	describeLinks,
	describePrompt,
	describingOf,
	descriptionOf,
	initLinkDescriptions,
	parseDescriptions,
} from './linkDescriptions';
import { setClaudePath } from './sessions/running';

test('asks for each link by number, with what was said around it', () => {
	const prompt = describePrompt([
		{ url: 'https://bun.sh/docs/spawn', title: 'the spawn docs', turn: 'why does it hang', passages: ['read the spawn docs'] },
		{ url: 'https://acme.dev', title: '', turn: null, passages: ['see acme.dev'] },
	]);

	expect(prompt).toContain('1. https://bun.sh/docs/spawn\n   Called: the spawn docs\n   Asked at the time: why does it hang');
	expect(prompt).toContain('2. https://acme.dev\n   Said around it: see acme.dev');
});

test("reads Haiku's answer, fenced or not, and nothing from a reply that isn't one", () => {
	expect(parseDescriptions('```json\n{"1": "Bun spawn docs", "2": ""}\n```')).toEqual({ 1: 'Bun spawn docs' });
	expect(parseDescriptions('Sorry, I cannot.')).toEqual({});
});

test('describes links in the background, once each, and keeps what it wrote', async () => {
	const data = await mkdtemp(path.join(os.tmpdir(), 'paude-descriptions-'));
	const link = { url: 'https://bun.sh/docs/spawn', title: '', turn: null, passages: ['the spawn docs'] };

	await initLinkDescriptions(data);
	setClaudePath(path.join(import.meta.dir, 'sessions', 'fixtures', 'fake-haiku.js'));
	describeLinks([link, { ...link, url: 'https://quiet.dev', passages: [] }]);
	expect(describingOf(link.url)).toBe(true);
	expect(describingOf('https://quiet.dev')).toBe(false);

	while (describingOf(link.url)) await Bun.sleep(50);

	expect(descriptionOf(link.url)).toBe('about spawn');
	expect(await Bun.file(path.join(data, 'link-descriptions.json')).json()).toEqual({ [link.url]: 'about spawn' });
});

test('when Haiku answers nothing, the queue stops rather than failing batch after batch', async () => {
	const data = await mkdtemp(path.join(os.tmpdir(), 'paude-descriptions-'));
	const links = Array.from({ length: 45 }, (_, index) => ({
		url: `https://down.dev/${index}`,
		title: '',
		turn: null,
		passages: ['a page'],
	}));

	await initLinkDescriptions(data);
	setClaudePath('/bin/false');
	describeLinks(links);
	while (describingOf(links[0].url)) await Bun.sleep(20);

	expect(links.some(link => describingOf(link.url))).toBe(false);
	// Asked again within the hour: left alone
	describeLinks(links);
	expect(describingOf(links[0].url)).toBe(false);
});
