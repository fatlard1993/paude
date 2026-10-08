import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import { trimUrl } from '../shared/terminalLinks';
import writeJsonFile from '../shared/writeJsonFile';
import { describeLinks, describingOf, descriptionOf } from './linkDescriptions';
import { getNotes } from './notes';
import { projectOf } from './projects';
import { promptText } from './sessions/history';
import { titleOf } from './sessions/record';
import { allRunning, runningSession } from './sessions/running';
import { storedSessions } from './sessions/stored';
import { transcriptFile } from './sessions/transcript';

// The links that came up in a session, gathered for its Links panel: from the conversation (what you wrote, what
// Claude wrote, pages it fetched or searched, what its commands printed; not the files it read, which are noise), the
// chat and comments. Each sorted into a kind, with where it first came up. (What the session shares has its own panel.)
const URL = /https?:\/\/[^\s<>"'`\\|]+/g;
const CONTEXT = 160;
// What's said around a mention, for Haiku to describe the link from
const PASSAGE = 300;
const PASSAGES = 3;
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

// Whose words say best what a link is: a person's, then Claude's, then why Claude fetched it. What a command printed
// is never quoted (a log line, a wrapped terminal row, a search tool's JSON), though it can still name the link.
const SAYS_BEST = { Claude: 1, fetched: 2, output: 3 };

export const saysBetter = (by, than) => (SAYS_BEST[by] ?? 0) < (SAYS_BEST[than] ?? 0);

// A link as it reads best: its host and path, without the scheme or a trailing slash
const shortened = url => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

const hostOf = url => {
	try {
		return new globalThis.URL(url).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
};

// Cut to about `length` characters at a word, marked where it was cut
export const clip = (text, length = CONTEXT) => {
	if (text.length <= length) return text;

	const cut = text.slice(0, length);

	return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), length / 2)).replace(/[\s,;:]+$/, '')}…`;
};

const MARKDOWN_LINK = /\[([^\]\n]*)\]\(([^)\s]*)\)/g;
const HERE = '\u0000';

// What the text calls the link: a markdown link's words, or a search result's title. Not just its host again.
const titleBefore = (text, at, url) => {
	const before = text.slice(Math.max(0, at - 300), at);
	const title = (/\[([^\]\n]{2,200})\]\($/.exec(before) ?? /"title":"((?:[^"\\]|\\.){2,200})","url":"$/.exec(before))?.[1]
		?.replace(/\\(.)/g, '$1')
		.trim();
	const host = hostOf(url);

	return title && title.replace(/^www\./, '') !== host && !/^https?:\/\//.test(title) ? title : '';
};

const squashed = text => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// The sentence the link is in, as read: no markdown, the link as its words or shortened. Nothing when the link stands
// alone or sits in a code block (a command, a config: what Claude wrote out, not what it said).
const sentenceAround = (text, at, url, title) => {
	const lineStart = text.lastIndexOf('\n', at) + 1;
	const lineEnd = text.indexOf('\n', at + url.length);

	if ((text.slice(0, lineStart).match(/^\s*```/gm)?.length ?? 0) % 2) return '';

	const markdown = new RegExp(`\\[[^\\]\\n]*\\]\\(${RegExp.escape(url)}\\)`).exec(text.slice(lineStart, at + url.length + 1));
	const from = markdown ? lineStart + markdown.index : at;
	const to = markdown ? from + markdown[0].length : at + url.length;
	// The link marked, the rest of the line's links as their words, so neither is split as a sentence
	const line = `${text.slice(lineStart, from)}${HERE}${text.slice(to, lineEnd < 0 ? text.length : lineEnd)}`.replace(
		MARKDOWN_LINK,
		'$1',
	);
	const where = line.indexOf(HERE);
	const starts = [...line.slice(0, where).matchAll(/[.!?]\s+(?=\S)/g)].map(found => found.index + found[0].length);
	const ends = /[.!?](\s|$)/.exec(line.slice(where));
	const sentence = line
		.slice(starts.at(-1) ?? 0, ends ? where + ends.index + 1 : line.length)
		.replace(URL, other => shortened(other))
		.replace(HERE, title || shortened(url))
		.replace(/^\s*(#+|[-*>]|\d+\.)\s+/, '')
		.replace(/\*\*|__|`/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	// Words besides the link's own name: "Cursor guide (DeployHQ)" says nothing its title doesn't
	const besides = squashed(sentence).replace(squashed(title || shortened(url)), '');

	return besides.length < 12 ? '' : clip(sentence);
};

// The text around a mention, on one line
const passageAround = (text, at, url) =>
	text
		.slice(Math.max(0, at - PASSAGE), at + url.length + PASSAGE)
		.replace(/\s+/g, ' ')
		.trim();

// The URLs in a piece of text, each with the sentence it's in, what the text calls it, and what's said around it
export const urlsIn = text => {
	const source = String(text);

	return [...source.matchAll(URL)]
		.map(found => ({ url: trimUrl(found[0]), at: found.index }))
		.filter(({ url }) => url.length > 'https://x.y'.length && !NOT_LINKS.some(pattern => pattern.test(url)))
		.map(({ url, at }) => {
			const title = titleBefore(source, at, url);

			return {
				url,
				title,
				context: sentenceAround(source, at, url, title),
				passage: passageAround(source, at, url),
			};
		});
};

const blockText = block => {
	if (typeof block === 'string') return block;
	if (block.type === 'text') return block.text;
	if (block.type === 'tool_result')
		return typeof block.content === 'string' ? block.content : (block.content ?? []).map(blockText).join('\n');

	return '';
};

// Every link a transcript line brings up, with who brought it up: [{ url, context, by }]
export const linksOfLine = (line, quietToolIds) => {
	// Skill text Claude Code puts in: nobody's words
	if (line.isMeta) return [];

	const prompt = promptText(line);

	// A compacted conversation's summary arrives as a prompt, though Claude wrote it
	if (prompt !== null) return urlsIn(prompt).map(found => ({ ...found, by: line.isCompactSummary ? 'Claude' : 'you' }));

	const content = line.message?.content;

	if (!Array.isArray(content)) return [];

	return content.flatMap(block => {
		if (line.type === 'assistant' && block.type === 'text')
			return urlsIn(block.text).map(found => ({ ...found, by: 'Claude' }));
		if (line.type === 'assistant' && block.type === 'tool_use') {
			if (QUIET_TOOLS.has(block.name)) quietToolIds.add(block.id);
			if (block.name === 'WebFetch' && block.input?.url && !NOT_LINKS.some(pattern => pattern.test(block.input.url)))
			{
				const why = (block.input.prompt ?? '').replace(/\s+/g, ' ').trim();

				return [{ url: block.input.url, title: '', context: clip(why), passage: why, by: 'fetched' }];
			}

			return [];
		}
		if (block.type === 'tool_result' && !quietToolIds.has(block.tool_use_id))
			return urlsIn(blockText(block)).map(found => ({ ...found, context: '', by: 'output' }));

		return [];
	});
};

// Per session: how far its transcript has been read, and what came up in it
const read = new Map();

// The first mention dates it; the clearest one says what it is. A few of what's said around it are kept, the
// clearest speakers' first.
const add = (links, { url, title, context, passage, by }, at, turn) => {
	const known = links.get(url);

	if (known) {
		if (passage && !known.passages.some(kept => kept.text === passage)) {
			known.passages = [...known.passages, { text: passage, by }]
				.sort((a, b) => (SAYS_BEST[a.by] ?? 0) - (SAYS_BEST[b.by] ?? 0))
				.slice(0, PASSAGES);
		}
		known.count += 1;
		known.lastAt = at ?? known.lastAt;
		if (!known.by.includes(by)) known.by.push(by);
		if (title && (!known.title || saysBetter(by, known.titleBy))) Object.assign(known, { title, titleBy: by });
		if (context && (!known.context || saysBetter(by, known.contextBy))) Object.assign(known, { context, contextBy: by });

		return;
	}

	if (links.size >= MAX_LINKS) return;
	links.set(url, {
		url,
		kind: kindOf(url),
		title,
		titleBy: title ? by : null,
		context,
		contextBy: context ? by : null,
		passages: passage ? [{ text: passage, by }] : [],
		by: [by],
		count: 1,
		firstAt: at,
		lastAt: at,
		turn,
	});
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

const dayOf = at => (at ? new Date(at).toLocaleDateString('en-CA') : '');

// The pinned first; then by the day each last came up, the latest first; within a day, the most mentioned first
export const byPinnedThenRecent = (a, b) =>
	b.pinned - a.pinned ||
	dayOf(b.lastAt).localeCompare(dayOf(a.lastAt)) ||
	b.count - a.count ||
	String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? ''));

// Everything that came up, the pinned first then the latest and most mentioned; hidden ones only when asked for
export const sessionLinks = async (id, cwd, { withHidden = false } = {}) => {
	// Copies: the chat's mentions are counted onto them for this answer, not onto what the transcript gathered
	const links = new Map(
		[...(await transcriptLinks(id, cwd))].map(([url, link]) => [url, { ...link, by: [...link.by] }]),
	);
	const notes = await getNotes(id);

	for (const message of notes.chat)
		for (const found of urlsIn(message.text))
			add(links, { ...found, by: message.author }, new Date(message.at).toISOString());
	for (const comment of notes.comments)
		for (const item of [comment, ...comment.replies])
			for (const found of urlsIn(item.text)) add(links, { ...found, by: item.author }, new Date(item.at).toISOString());

	const { pinned = [], hidden = [] } = marks[id] ?? {};

	describeLinks(
		[...links.values()]
			.filter(link => !hidden.includes(link.url))
			.map(({ url, title, turn, passages, by, lastAt }) => ({
				url,
				title,
				turn,
				passages: passages.map(({ text }) => text),
				mentioned: by.some(speaker => speaker !== 'output'),
				lastAt,
			})),
	);

	return [...links.values()]
		.map(({ passages, ...link }) => ({
			...link,
			description: descriptionOf(link.url),
			describing: describingOf(link.url),
			pinned: pinned.includes(link.url),
			hidden: hidden.includes(link.url),
		}))
		.filter(link => withHidden || !link.hidden)
		.sort(byPinnedThenRecent);
};

const PROJECT_SESSIONS = 50;

// The project's sessions to gather from, the latest first, the running ones whether saved yet or not
const projectSessions = async project => {
	const stored = (await storedSessions()).filter(session => projectOf(session.cwd) === project);
	const listed = new Set(stored.map(({ sessionId }) => sessionId));
	const running = [...allRunning()]
		.filter(session => projectOf(session.cwd) === project && !listed.has(session.id))
		.map(session => ({ sessionId: session.id, cwd: session.cwd, lastModified: session.startedAt }));

	return [...running, ...stored]
		.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0))
		.slice(0, PROJECT_SESSIONS);
};

// Every link the project's latest sessions brought up, as one list: counted across them, with the sessions each
// came up in. What a session hid stays hidden; pinning and hiding here are the project's own.
export const projectLinks = async (project, { withHidden = false } = {}) => {
	const merged = new Map();

	for (const session of await projectSessions(project)) {
		const title = titleOf(session.sessionId, runningSession(session.sessionId), session);

		for (const link of await sessionLinks(session.sessionId, session.cwd)) {
			const known = merged.get(link.url);
			const from = { id: session.sessionId, title };

			if (!known) {
				merged.set(link.url, { ...link, by: [...link.by], sessions: [from] });
				continue;
			}

			known.count += link.count;
			known.by = [...new Set([...known.by, ...link.by])];
			if (link.firstAt && (!known.firstAt || link.firstAt < known.firstAt)) known.firstAt = link.firstAt;
			if (link.title && (!known.title || saysBetter(link.titleBy, known.titleBy)))
				Object.assign(known, { title: link.title, titleBy: link.titleBy });
			if (link.context && (!known.context || saysBetter(link.contextBy, known.contextBy)))
				Object.assign(known, { context: link.context, contextBy: link.contextBy });
			if (link.lastAt && (!known.lastAt || link.lastAt > known.lastAt)) known.lastAt = link.lastAt;
			known.describing ||= link.describing;
			known.sessions.push(from);
		}
	}

	const { pinned = [], hidden = [] } = marks[`project:${project}`] ?? {};

	return [...merged.values()]
		.map(link => ({ ...link, pinned: pinned.includes(link.url), hidden: hidden.includes(link.url) }))
		.filter(link => withHidden || !link.hidden)
		.sort(byPinnedThenRecent);
};

export const markProjectLink = (project, url, change) => markLink(`project:${project}`, url, change);
