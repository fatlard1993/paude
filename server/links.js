import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import { trimUrl } from '../shared/terminalLinks';
import writeJsonFile from '../shared/writeJsonFile';
import { getNotes } from './notes';
import { promptText } from './sessions/history';
import { transcriptFile } from './sessions/transcript';

// The links that came up in a session, gathered for its Links panel: from the conversation (what you wrote, what
// Claude wrote, pages it fetched or searched, what its commands printed; not the files it read, which are noise), the
// chat and comments. Each sorted into a kind, with where it first came up. (What the session shares has its own panel.)
const URL = /https?:\/\/[^\s<>"'`\\|]+/g;
const CONTEXT = 90;
const MAX_LINKS = 1000;
// Read but never mined: a file's contents, and the like
const QUIET_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'TodoWrite']);
// Not links anyone would go back to: paude's own hook address (in the settings every session starts with), a stack
// frame's file:line:column, a placeholder ($host, {{IP}}), and the addresses kept for examples
const NOT_LINKS = [
	/\/api\/hooks\//,
	/:\d+:\d+$/,
	/[$<{}]/,
	/^https?:\/\/(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/,
	/^https?:\/\/([\w-]+\.)*example\.(com|org|net)([/:]|$)/,
];

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|0\.0\.0\.0|[\w-]+\.local$)/;
const TICKET = [
	/github\.com\/[^/]+\/[^/]+\/(issues|pull|discussions)\/\d+/,
	/gitlab\.[^/]+\/.+\/-\/(issues|merge_requests)\/\d+/,
	/atlassian\.net\/(browse|jira)\//,
	/linear\.app\/[^/]+\/issue\//,
	/sentry\.io\/.*issues\//,
];
const DOCS = [
	/^(docs|developer|developers|learn|api|devdocs|reference)\./,
	/readthedocs\.(io|org)$/,
	/developer\.mozilla\.org$/,
	/^(www\.)?npmjs\.com$/,
	/^pypi\.org$/,
	/^pkg\.go\.dev$/,
	/^docs\.rs$/,
	/^crates\.io$/,
];

// What kind of link it is: 'server', 'ticket', 'repo', 'docs' or 'reference'
export const kindOf = address => {
	let url;

	try {
		url = new globalThis.URL(address);
	} catch {
		return 'reference';
	}

	if (PRIVATE_HOST.test(url.hostname) || url.port || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return 'server';
	if (TICKET.some(pattern => pattern.test(address))) return 'ticket';
	if (
		/^(www\.)?(github|gitlab|codeberg)\.(com|org)$/.test(url.hostname) &&
		url.pathname.split('/').filter(Boolean).length >= 2
	)
		return 'repo';
	if (DOCS.some(pattern => pattern.test(url.hostname)) || /\/docs?\//.test(url.pathname)) return 'docs';

	return 'reference';
};

// The URLs in a piece of text, each with a little of what surrounds it
export const urlsIn = text =>
	[...String(text).matchAll(URL)]
		.map(found => ({ url: trimUrl(found[0]), at: found.index }))
		.filter(({ url }) => url.length > 'https://x.y'.length && !NOT_LINKS.some(pattern => pattern.test(url)))
		.map(({ url, at }) => ({
			url,
			context: String(text)
				.slice(Math.max(0, at - CONTEXT), at + url.length + CONTEXT)
				.replace(/\s+/g, ' ')
				.trim(),
		}));

const blockText = block => {
	if (typeof block === 'string') return block;
	if (block.type === 'text') return block.text;
	if (block.type === 'tool_result')
		return typeof block.content === 'string' ? block.content : (block.content ?? []).map(blockText).join('\n');

	return '';
};

// Every link a transcript line brings up, with who brought it up: [{ url, context, by }]
export const linksOfLine = (line, quietToolIds) => {
	const prompt = promptText(line);

	if (prompt !== null) return urlsIn(prompt).map(found => ({ ...found, by: 'you' }));

	const content = line.message?.content;

	if (!Array.isArray(content)) return [];

	return content.flatMap(block => {
		if (line.type === 'assistant' && block.type === 'text')
			return urlsIn(block.text).map(found => ({ ...found, by: 'Claude' }));
		if (line.type === 'assistant' && block.type === 'tool_use') {
			if (QUIET_TOOLS.has(block.name)) quietToolIds.add(block.id);
			if (block.name === 'WebFetch' && block.input?.url && !NOT_LINKS.some(pattern => pattern.test(block.input.url)))
				return [{ url: block.input.url, context: block.input.prompt?.slice(0, CONTEXT * 2) ?? '', by: 'fetched' }];

			return [];
		}
		if (block.type === 'tool_result' && !quietToolIds.has(block.tool_use_id))
			return urlsIn(blockText(block)).map(found => ({ ...found, by: 'output' }));

		return [];
	});
};

// Per session: how far its transcript has been read, and what came up in it
const read = new Map();

const add = (links, { url, context, by }, at, turn) => {
	const known = links.get(url);

	if (known) {
		known.count += 1;
		known.lastAt = at ?? known.lastAt;
		if (!known.by.includes(by)) known.by.push(by);

		return;
	}

	if (links.size >= MAX_LINKS) return;
	links.set(url, { url, kind: kindOf(url), context, by: [by], count: 1, firstAt: at, lastAt: at, turn });
};

// New lines since the last look: a transcript only grows, so only its end is read each time
const transcriptLinks = async (id, cwd) => {
	const file = await transcriptFile(id, cwd);

	if (!file) return new Map();

	let state = read.get(id);

	if (!state || state.name !== file.name || file.size < state.offset)
		state = { name: file.name, offset: 0, rest: '', links: new Map(), quiet: new Set(), turn: null };

	if (file.size > state.offset) {
		const text = state.rest + (await file.slice(state.offset, file.size).text());
		const lines = text.split('\n');

		state.rest = lines.pop();
		state.offset = file.size;
		// The last line may be whole without its newline yet, or cut short mid-write: only a whole one is taken now
		try {
			JSON.parse(state.rest);
			lines.push(state.rest);
			state.rest = '';
		} catch {
			// Not finished; read with what follows it
		}
		for (const raw of lines) {
			let line;

			try {
				line = JSON.parse(raw);
			} catch {
				continue;
			}

			const prompt = promptText(line);

			if (prompt !== null)
				state.turn = prompt
					.replace(/<\/?pasted_content[^>]*>/g, '')
					.trim()
					.slice(0, 120);
			for (const found of linksOfLine(line, state.quiet)) add(state.links, found, line.timestamp, state.turn);
		}
	}

	read.set(id, state);

	return state.links;
};

let marksFile;
// What people made of them, per session: { [sessionId]: { pinned: [url], hidden: [url] } }
let marks = {};

export const initLinks = async dataDir => {
	marksFile = path.join(dataDir, 'links.json');
	marks = await readJsonFile(marksFile, {});
};

export const markLink = async (sessionId, url, { pinned, hidden }) => {
	const now = marks[sessionId] ?? { pinned: [], hidden: [] };
	const toggle = (list, on) => (on ? [...new Set([...list, url])] : list.filter(other => other !== url));

	marks = {
		...marks,
		[sessionId]: {
			pinned: pinned === undefined ? now.pinned : toggle(now.pinned, pinned),
			hidden: hidden === undefined ? now.hidden : toggle(now.hidden, hidden),
		},
	};
	await writeJsonFile(marksFile, () => marks);
};

// Everything that came up, the pinned first then the latest; hidden ones only when asked for
export const sessionLinks = async (id, cwd, { withHidden = false } = {}) => {
	const links = new Map(await transcriptLinks(id, cwd));
	const notes = await getNotes(id);

	for (const message of notes.chat)
		for (const found of urlsIn(message.text))
			add(links, { ...found, by: message.author }, new Date(message.at).toISOString());
	for (const comment of notes.comments)
		for (const item of [comment, ...comment.replies])
			for (const found of urlsIn(item.text)) add(links, { ...found, by: item.author }, new Date(item.at).toISOString());

	const { pinned = [], hidden = [] } = marks[id] ?? {};

	return [...links.values()]
		.map(link => ({ ...link, pinned: pinned.includes(link.url), hidden: hidden.includes(link.url) }))
		.filter(link => withHidden || !link.hidden)
		.sort((a, b) => b.pinned - a.pinned || String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')));
};
