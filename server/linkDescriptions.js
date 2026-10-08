import os from 'os';
import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { sessionEnvironment } from './sessions/PtySession';
import { claudeCommand } from './sessions/running';

// A link's description, written by Haiku from what was said around it: once per link, kept by its address. Asked in
// the background, a batch at a time, while the Links panel shows what it has.
const BATCH = 20;
const TIMEOUT_MS = 120_000;
// A batch Haiku couldn't answer waits this long before it's asked again
const RETRY_MS = 60 * 60 * 1000;

let file;
let descriptions = {};
const queue = new Map();
const failedAt = new Map();
let working = false;

export const initLinkDescriptions = async dataDir => {
	file = path.join(dataDir, 'link-descriptions.json');
	descriptions = await readJsonFile(file, {});
};

export const descriptionOf = url => descriptions[url];

export const describingOf = url => queue.has(url);

export const describePrompt = links =>
	[
		'Each link below came up in a conversation with a coding assistant. For each, write what it is and why it came up, in at most 12 words.',
		"Plain words: no URL, no domain name, no quotes, no trailing period. When nothing says why, say what the page itself is.",
		'Reply with only a JSON object from each number to its description, like {"1": "…", "2": "…"}.',
		links
			.map((link, index) =>
				[
					`${index + 1}. ${link.url}`,
					link.title && `   Called: ${link.title}`,
					link.turn && `   Asked at the time: ${link.turn}`,
					...link.passages.map(passage => `   Said around it: ${passage}`),
				]
					.filter(Boolean)
					.join('\n'),
			)
			.join('\n\n'),
	].join('\n\n');

// Haiku's reply as { [number]: description }: a JSON object, perhaps fenced or with words around it
export const parseDescriptions = reply => {
	const json = /\{[\s\S]*\}/.exec(reply)?.[0];

	try {
		return Object.fromEntries(
			Object.entries(JSON.parse(json)).filter(([, text]) => typeof text === 'string' && text.trim()),
		);
	} catch {
		return {};
	}
};

const askHaiku = async prompt => {
	const child = Bun.spawn(
		[
			claudeCommand(),
			'-p',
			'--model',
			'haiku',
			'--output-format',
			'text',
			'--no-session-persistence',
			'--setting-sources',
			'',
			'--tools',
			'',
		],
		{
			cwd: os.tmpdir(),
			env: sessionEnvironment(),
			stdin: new TextEncoder().encode(prompt),
			stdout: 'pipe',
			stderr: 'ignore',
			timeout: TIMEOUT_MS,
		},
	);
	const out = await new Response(child.stdout).text();

	return (await child.exited) === 0 ? out : '';
};

// What the panel shows first goes first: what someone mentioned, the latest; what only a command printed, last
const sooner = (a, b) => b.mentioned - a.mentioned || String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? ''));

const work = async () => {
	if (working) return;
	working = true;
	try {
		while (queue.size) {
			const batch = [...queue.values()].sort(sooner).slice(0, BATCH);
			const written = parseDescriptions(await askHaiku(describePrompt(batch)));

			// No answer at all (not logged in, out of usage): the rest wait their hour too, rather than each failing
			if (!Object.keys(written).length) {
				for (const url of queue.keys()) failedAt.set(url, Date.now());
				queue.clear();
				break;
			}

			batch.forEach((link, index) => {
				const text = written[String(index + 1)];

				if (text) descriptions[link.url] = text.trim().replace(/\.$/, '');
				else failedAt.set(link.url, Date.now());
				queue.delete(link.url);
			});
			await writeJsonFile(file, () => descriptions);
		}
	} finally {
		working = false;
	}
};

// Links not described yet, asked for in the background: { url, title, turn, passages, mentioned, lastAt }
export const describeLinks = links => {
	if (!file) return;
	for (const link of links) {
		if (descriptions[link.url] || queue.has(link.url) || !link.passages?.length) continue;
		if (Date.now() - (failedAt.get(link.url) ?? 0) < RETRY_MS) continue;
		queue.set(link.url, link);
	}
	if (queue.size) work();
};
