import { stat } from 'fs/promises';
import os from 'os';
import path from 'path';

import { artifactDescriptionOf, describeArtifacts, describingArtifact } from './artifactDescriptions';
import { projectSessions } from './links';
import { projectPath } from './projects';
import { promptText } from './sessions/history';
import { titleOf } from './sessions/record';
import { runningSession } from './sessions/running';
import { claudeHome, transcriptFile } from './sessions/transcript';

// The things a session made along the way: images, pages, scripts, data, written to a scratchpad, /tmp or an ignored
// folder and hard to find again. Gathered from its transcript: the files Claude wrote, and the files its commands
// named (a screenshot's path, a report's -o). A file counts while it's there, was written once the session had named it
// (a command that only read an older file names it too), and isn't one git tracks (those are the session's changes).
const KINDS = {
	image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'],
	page: ['html', 'htm'],
	doc: ['md', 'pdf', 'txt', 'docx', 'pptx', 'xlsx'],
	data: ['json', 'jsonl', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'log', 'sql', 'db', 'sqlite'],
	script: ['sh', 'bash', 'zsh', 'py', 'js', 'mjs', 'cjs', 'ts', 'rb', 'pl', 'lua'],
	media: ['mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg', 'm4a'],
	archive: ['zip', 'tgz', 'gz', 'tar', 'jar'],
};
const KIND_OF = new Map(Object.entries(KINDS).flatMap(([kind, extensions]) => extensions.map(ext => [ext, kind])));
const EXTENSIONS = [...KIND_OF.keys()].join('|');
// A path in a command or its output: absolute, from home, or relative, ending in one of the extensions
const PATH = new RegExp(
	`(?:~|\\.{1,2})?/?(?:[\\w@%+=.,-]+/)*[\\w@%+=,-][\\w@%+=.,-]*\\.(?:${EXTENSIONS})(?![\\w/])`,
	'gi',
);
const WRITING_TOOLS = new Set(['Write', 'NotebookEdit']);
// What Claude looked at that's worth finding again (a screenshot it checked), as opposed to the code it read
const VIEWED_KINDS = new Set(['image', 'page', 'doc']);
// A command that starts in another folder: cd somewhere && …
// Where a command goes: cd somewhere, at its start or after a newline, ; or &&
const CD = /(?:^|[\n;&|(]\s*)cd\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/g;
// Never things anyone made: dependencies, a build's output, and what lives in hidden folders (git's own, Claude Code's
// bookkeeping, an app's state like ~/.paude)
const NOT_ARTIFACTS = [
	/\/node_modules\//,
	/\/(build|dist|coverage|\.next)\//,
	/\/\.[^/]+\//,
	// The skills Claude Code unpacks for itself
	/^\/tmp\/claude-\d+\/bundled-skills\//,
];
// Written within a moment before it was named still counts: a command names its output as it writes it
const NAMED_SLACK_MS = 60 * 1000;
const WHY = 200;
const MAX_NAMED = 5000;
const MAX_ARTIFACTS = 300;

export const kindOfPath = file => KIND_OF.get(path.extname(file).slice(1).toLowerCase()) ?? null;

const clip = text => {
	const flat = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();

	return flat.length > WHY ? `${flat.slice(0, WHY - 1)}…` : flat;
};

// A path as written, made absolute: from home, or from the folder the command ran in
export const absolutePath = (written, cwd) => {
	if (written.startsWith('~/')) return path.join(os.homedir(), written.slice(2));
	if (path.isAbsolute(written)) return path.normalize(written);

	return cwd ? path.resolve(cwd, written) : null;
};

// folders: where a relative path may be from; each is tried, and what isn't there is left out when listed
export const pathsIn = (text, folders) => {
	const from = [folders].flat();

	return [
		...new Set(
			(String(text ?? '').match(PATH) ?? []).flatMap(written =>
				written.startsWith('/') || written.startsWith('~/')
					? [absolutePath(written)]
					: from.map(folder => absolutePath(written, folder)),
			),
		),
	].filter(file => file && !NOT_ARTIFACTS.some(pattern => pattern.test(file)));
};

// A shell variable set in the command: NAME=value at its start, or after a newline, ; or &&
const ASSIGNMENT = /(?:^|[\n;&|]\s*)([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|]+)/g;

// The command with the variables it sets filled in where it uses them ($D/out.png, ${D}/out.png), so a path built
// from one is seen whole
export const withVariables = command => {
	const text = String(command ?? '');
	const values = new Map(
		[...text.matchAll(ASSIGNMENT)].map(([, name, value]) => [name, value.replace(/^["']|["']$/g, '')]),
	);

	return [...values].reduce(
		(filled, [name, value]) => filled.replace(new RegExp(`\\$(?:\\{${name}\\}|${name}(?!\\w))`, 'g'), () => value),
		text,
	);
};

// The folders a command's relative paths may be from: where the session is, and wherever it cd's
export const commandFolders = (command, cwd) => [
	...new Set([
		cwd,
		...[...String(command ?? '').matchAll(CD)]
			.map(([, to]) => absolutePath(to.replace(/^["']|["']$/g, ''), cwd))
			.filter(Boolean),
	]),
];

const blockText = block =>
	typeof block.content === 'string'
		? block.content
		: (block.content ?? [])
				.filter(part => part.type === 'text')
				.map(part => part.text)
				.join('\n');

// The artifacts one transcript line names: [{ file, by, why }]. state carries the turn, Claude's latest words, and
// the folder each command ran in, from line to line.
export const artifactsOfLine = (line, state) => {
	const prompt = promptText(line);

	if (prompt !== null) {
		state.turn = clip(prompt.replace(/<\/?pasted_content[^>]*>/g, ''));
		state.said = '';

		return [];
	}
	if (line.cwd) state.cwd = line.cwd;

	const content = line.message?.content;

	if (!Array.isArray(content)) return [];

	return content.flatMap(block => {
		if (line.type === 'assistant' && block.type === 'text') {
			state.said = clip(block.text);

			return [];
		}
		if (line.type === 'assistant' && block.type === 'tool_use') {
			const input = block.input ?? {};

			if (WRITING_TOOLS.has(block.name) && (input.file_path || input.notebook_path)) {
				const file = absolutePath(input.file_path ?? input.notebook_path, state.cwd);

				return file && kindOfPath(file) ? [{ file, by: 'written', why: state.said }] : [];
			}
			if (block.name === 'Read' && input.file_path) {
				const file = absolutePath(input.file_path, state.cwd);

				return file && VIEWED_KINDS.has(kindOfPath(file)) ? [{ file, by: 'viewed', why: state.said }] : [];
			}
			if (block.name === 'Bash') {
				const command = withVariables(input.command);
				const folders = commandFolders(command, state.cwd);

				state.commands.set(block.id, { why: input.description ?? '', folders });

				return pathsIn(command, folders).map(file => ({
					file,
					by: 'command',
					why: clip(input.description) || state.said,
				}));
			}

			return [];
		}
		if (block.type === 'tool_result' && state.commands.has(block.tool_use_id)) {
			const { why, folders } = state.commands.get(block.tool_use_id);

			return pathsIn(blockText(block), folders).map(file => ({ file, by: 'output', why: clip(why) || state.said }));
		}

		return [];
	});
};

// Per session: how far its transcript has been read, and what it named
const read = new Map();

const fresh = name => ({
	name,
	offset: 0,
	rest: '',
	found: new Map(),
	turn: '',
	said: '',
	cwd: null,
	commands: new Map(),
});

// Which naming says most about a file: Claude writing it, Claude looking at it, a command naming it, its output
const BY_RANK = { written: 0, viewed: 1, command: 2, output: 3 };

const add = (found, { file, by, why }, at, turn) => {
	const known = found.get(file);

	if (known) {
		known.lastAt = at ?? known.lastAt;
		// What Claude said as it wrote the file says best what it is
		if (BY_RANK[by] < BY_RANK[known.by]) Object.assign(known, { by, why: why || known.why, turn });

		return;
	}
	// A long session names thousands of paths: the oldest named go first
	if (found.size >= MAX_NAMED) found.delete(found.keys().next().value);
	found.set(file, { file, by, why, turn, firstAt: at, lastAt: at });
};

const transcriptArtifacts = async (id, cwd) => {
	const file = await transcriptFile(id, cwd);

	if (!file) return new Map();

	let state = read.get(id);

	if (!state || state.name !== file.name || file.size < state.offset) state = { ...fresh(file.name), cwd };
	if (file.size > state.offset) {
		const lines = (state.rest + (await file.slice(state.offset, file.size).text())).split('\n');

		state.rest = lines.pop();
		state.offset = file.size;
		for (const raw of lines) {
			let line;

			try {
				line = JSON.parse(raw);
			} catch {
				continue;
			}
			for (const found of artifactsOfLine(line, state)) add(state.found, found, line.timestamp, state.turn);
		}
	}
	read.set(id, state);

	return state.found;
};

// Of these files, the ones git tracks, asked of each repository they're in once
const trackedOf = async files => {
	const byFolder = Map.groupBy(files, file => path.dirname(file));
	const tracked = new Set();

	await Promise.all(
		[...byFolder].map(async ([folder, inFolder]) => {
			const child = Bun.spawn(['git', '-C', folder, 'ls-files', '-z', '--full-name', '--', ...inFolder], {
				stdout: 'pipe',
				stderr: 'ignore',
			});
			const listed = await new Response(child.stdout).text();

			if ((await child.exited) !== 0) return;

			const root = (
				await new Response(
					Bun.spawn(['git', '-C', folder, 'rev-parse', '--show-toplevel'], { stdout: 'pipe', stderr: 'ignore' }).stdout,
				).text()
			).trim();

			for (const name of listed.split('\0').filter(Boolean)) tracked.add(path.join(root, name));
		}),
	);

	return tracked;
};

// Claude Code's scratchpad for a session: /tmp/claude-<uid>/<folder>/<session>/scratchpad/
const SCRATCHPAD = /^\/tmp\/claude-\d+\/[^/]+\/[\w-]+\/scratchpad\//;

// A path as it reads best: from the project, the scratchpad, or home
export const shownPath = (file, projectFolder) => {
	if (projectFolder && insideFolder(file, projectFolder)) return path.relative(projectFolder, file);
	if (SCRATCHPAD.test(file)) return file.replace(SCRATCHPAD, 'scratchpad/');

	const home = os.homedir();

	return file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
};

const insideFolder = (file, folder) => {
	const within = path.relative(folder, file);

	return Boolean(within) && !within.startsWith('..') && !path.isAbsolute(within);
};

// What the session made that's still there, newest first: { path, name, kind, size, modifiedAt, firstAt, lastAt,
// turn, why, by, inProject }
export const sessionArtifacts = async (id, cwd, { projectFolder } = {}) => {
	const named = [...(await transcriptArtifacts(id, cwd)).values()].filter(
		artifact => !insideFolder(artifact.file, path.join(claudeHome(), 'projects')),
	);
	const existing = (
		await Promise.all(
			named.map(async artifact => {
				const info = await stat(artifact.file).catch(() => null);

				if (!info?.isFile()) return null;
				// Older than the session's first naming of it: read, not made (unless it was looked at, which is the point)
				if (artifact.by !== 'viewed' && info.mtimeMs < Date.parse(artifact.firstAt) - NAMED_SLACK_MS) return null;

				return { ...artifact, size: info.size, modifiedAt: info.mtimeMs };
			}),
		)
	).filter(Boolean);
	const tracked = await trackedOf(existing.map(artifact => artifact.file));

	const made = existing
		.filter(artifact => !tracked.has(artifact.file))
		.map(({ file, ...artifact }) => ({
			...artifact,
			path: file,
			name: path.basename(file),
			shown: shownPath(file, projectFolder),
			kind: kindOfPath(file),
			inProject: Boolean(projectFolder && insideFolder(file, projectFolder)),
		}))
		.sort((a, b) => b.modifiedAt - a.modifiedAt)
		.slice(0, MAX_ARTIFACTS);

	describeArtifacts(made);

	return made.map(artifact => ({
		...artifact,
		description: artifactDescriptionOf(artifact.path),
		describing: describingArtifact(artifact.path),
	}));
};

// What the project's latest sessions made, as one list: each with the session that made it, newest first
export const projectArtifacts = async project => {
	const projectFolder = projectPath(project);
	const made = new Map();

	for (const session of await projectSessions(project)) {
		const from = {
			id: session.sessionId,
			title: titleOf(session.sessionId, runningSession(session.sessionId), session),
		};

		for (const artifact of await sessionArtifacts(session.sessionId, session.cwd, { projectFolder }))
			if (!made.has(artifact.path) || made.get(artifact.path).modifiedAt < artifact.modifiedAt)
				made.set(artifact.path, { ...artifact, session: from });
	}

	return [...made.values()].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, MAX_ARTIFACTS);
};
