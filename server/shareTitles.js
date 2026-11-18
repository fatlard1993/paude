import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { promisify } from 'util';

import describer from './describer';
import { projectOf } from './projects';
import { runningSession } from './sessions/running';

const run = promisify(execFile);

const PAGE_TIMEOUT_MS = 1500;
// A page without a title is looked at again after this long, in case it grew one
const LOOK_AGAIN_MS = 10 * 60 * 1000;
const MAX_TITLE = 60;
const MAX_ARGS = 400;

// What each listening process was started as, by pid: what Haiku names a service from
const argsByPid = new Map();
// The <title> of what each service serves, by its port and process: { title, at }. A hint for Haiku, never the name
// itself: two worktrees of one app give the same title, and an API's root page is often titled "Error".
const pageTitles = new Map();

const argsOf = async pid => {
	if (argsByPid.has(pid)) return argsByPid.get(pid);

	const args =
		process.platform === 'linux'
			? (await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).split('\0').join(' ').trim()
			: ((await run('ps', ['-o', 'command=', '-p', String(pid)]).catch(() => ({ stdout: '' }))).stdout ?? '').trim();

	argsByPid.set(pid, args.slice(0, MAX_ARGS));

	return argsByPid.get(pid);
};

export const titleIn = html => {
	const found = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];

	return (
		found
			?.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, MAX_TITLE) || null
	);
};

const pageKey = share => `${share.port}:${share.pid}`;

const lookAtPage = async share => {
	const seen = pageTitles.get(pageKey(share));

	if (seen && (seen.title || Date.now() - seen.at < LOOK_AGAIN_MS)) return;
	pageTitles.set(pageKey(share), { title: null, at: Date.now() });

	const html = await fetch(
		`http://${share.host?.includes(':') ? `[${share.host}]` : (share.host ?? '127.0.0.1')}:${share.port}/`,
		{
			signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
			redirect: 'follow',
		},
	)
		.then(response => (response.headers.get('content-type')?.includes('html') ? response.text() : ''))
		.catch(() => '');

	pageTitles.set(pageKey(share), { title: titleIn(html), at: Date.now() });
};

export const namePrompt = services =>
	[
		'Each entry below is a local development service a coding session started: the port it listens on, the project, the command it was started with, and the title of the page it serves, when it serves one.',
		'Name each in 2 to 5 plain words, as a person would call it in a list (like "Storybook", "Enterprise web app", "Docs site", "Render API"). Services that differ only by a worktree or branch in their command get names that tell them apart by it. A page title is a hint, not the name: it may be generic ("Error", "Directory listing for /"). No port numbers, no paths, no quotes, no trailing period.',
		'Reply with only a JSON object from each number to its name, like {"1": "…", "2": "…"}.',
		services
			.map((service, index) =>
				[
					`${index + 1}. port ${service.port} · ${service.project} · ${service.args}`,
					service.title && `   page title: ${service.title}`,
				]
					.filter(Boolean)
					.join('\n'),
			)
			.join('\n'),
	].join('\n\n');

// Kept by what the service is, its project and command, so a restart on a new pid keeps its name
const names = describer({
	fileName: 'share-names.json',
	keyOf: service => `${service.project} ${service.args}`,
	promptFor: namePrompt,
	sooner: () => 0,
	describable: service => Boolean(service.args),
	keep: text => text.trim().replace(/\.$/, '').slice(0, MAX_TITLE),
});

export const initShareTitles = names.init;

// The home folder said as ~, so a command reads as what it runs rather than whose machine it's on
const shortened = args => (process.env.HOME ? args.replaceAll(process.env.HOME, '~') : args);

const serviceOf = share => ({
	port: share.port,
	project: projectOf(runningSession(share.sessionId)?.cwd) ?? 'a session',
	args: shortened(argsByPid.get(share.pid) ?? ''),
	title: pageTitles.get(pageKey(share))?.title ?? null,
});

const nameKey = share => `${serviceOf(share).project} ${serviceOf(share).args}`;

const naming = share => Boolean(share.kind === 'port' && share.auto && !share.named && share.pid);

// What a service is called in a list, as Haiku named it; null until it has
export const titleOf = share => (naming(share) ? (names.descriptionOf(nameKey(share)) ?? null) : null);

// Whether a name is still being found for it
export const namingOf = share =>
	naming(share) &&
	!titleOf(share) &&
	(!pageTitles.has(pageKey(share)) || !argsByPid.has(share.pid) || names.describingOf(nameKey(share)));

// The services among `shares` that have no name, once their pages and commands are read; named in the background,
// asked of Haiku together so it can tell apart those that look alike
export const toName = async shares => {
	const unnamed = shares.filter(naming);

	await Promise.all(unnamed.map(share => Promise.all([lookAtPage(share), argsOf(share.pid)])));

	return unnamed.map(serviceOf);
};

export const nameShares = async shares => names.describe(await toName(shares));
