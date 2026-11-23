import { stat } from 'fs/promises';

import { requestMatch } from '@vanilla-bean/components/app';

import { statusOf } from '../activity';
import { hookSecret, serverAddress } from '../hookSettings';
import { projectOf, projectPath } from '../projects';
import { serverSettings } from '../serverSettings';
import { askToStart, recordStart, startToken, startedBy, startedFrom, withdrawStart } from '../sessionStarts';
import { sessionRecord } from '../sessions/record';
import { runningSession } from '../sessions/running';
import { transcriptFile } from '../sessions/transcript';
import { WorktreeError, createWorktree, validWorktreeName } from '../worktrees';
import { MODEL_NAMES } from '../../shared/models';
import { startWith } from './sessions';

const HEARTBEAT_MS = 5000;

const isFolder = async folder => Boolean(folder) && ((await stat(folder).catch(() => null))?.isDirectory() ?? false);
const MAX_PROMPT = 20_000;

const pageOf = async id => `${(await serverSettings()).publicUrl ?? serverAddress()}/#/sessions/${id}`;

// A session as the other finds it: what it's called, where, how it's doing, its transcript and its page
const described = async id => {
	const record = await sessionRecord(id);

	if (!record) return { id, gone: true };

	return {
		id,
		title: record.title,
		project: projectOf(record.cwd),
		folder: record.cwd,
		status: record.running ? statusOf(id) : 'stopped',
		transcript: (await transcriptFile(id, record.cwd).catch(() => null)) ?? null,
		page: await pageOf(id),
	};
};

// What a session asking to start another sends: { prompt, project (its own by default), worktree (a new one's name),
// model }; the reason it can't be, or the request
const requestOf = async (body, parent) => {
	const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MAX_PROMPT) : '';
	const project = typeof body.project === 'string' && body.project.trim() ? body.project.trim() : projectOf(parent.cwd);

	if (!prompt) return { refused: 'Say what the new session should do' };
	// A session of the machine's own, in its home folder, is in no project to start beside
	if (!project) return { refused: 'Name the project to start it in (--project)' };
	if (!(await isFolder(projectPath(project)))) return { refused: `No project here is called ${project}` };
	if (body.worktree !== undefined && !validWorktreeName(body.worktree))
		return { refused: 'Name the worktree with letters, digits, dots, dashes and underscores (up to 64)' };
	if (body.model !== undefined && !MODEL_NAMES.includes(body.model))
		return { refused: `The model is one of ${MODEL_NAMES.join(', ')}` };

	return {
		prompt,
		project,
		...(body.worktree && { worktree: body.worktree }),
		...(body.model && { model: body.model }),
	};
};

// The request waits on someone in the asking session; the answer streams back as lines of JSON, a heartbeat
// meanwhile, and the request is withdrawn if the asker stops listening
const asked = (parent, request) => {
	const encoder = new TextEncoder();
	let open = true;
	let heartbeat;

	return new Response(
		new ReadableStream({
			async start(controller) {
				const send = message => {
					if (!open) return;

					try {
						controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
					} catch {
						open = false;
					}
				};

				send({ asked: true });
				heartbeat = setInterval(() => send({ waiting: true }), HEARTBEAT_MS);

				const answer = await askToStart(parent.id, request);

				clearInterval(heartbeat);
				if (answer.busy) send({ error: 'This session is already asking to start one; wait for that answer first' });
				else if (answer.declined) send({ declined: true, by: answer.by });
				else if (!answer.withdrawn) {
					try {
						const folder = request.worktree
							? await createWorktree(projectPath(request.project), request.project, request.worktree, {
									onOutput: output => output && send({ output }),
								})
							: projectPath(request.project);
						const id = await startWith(folder, request.prompt, {
							model: request.model,
							identity: { owner: true },
							project: request.project,
						});

						await recordStart(id, {
							from: parent.id,
							fromTitle: parent.title,
							fromProject: projectOf(parent.cwd),
							by: answer.by,
						});
						send({ started: await described(id), by: answer.by });
					} catch (error) {
						const told = error instanceof WorktreeError;

						if (!told) console.error('A session asked for could not be made', error);
						send({ error: told ? error.message : 'The session could not be made.' });
					}
				}

				if (open) controller.close();
				open = false;
			},
			cancel() {
				open = false;
				clearInterval(heartbeat);
				withdrawStart(parent.id);
			},
		}),
		{ headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' } },
	);
};

// Where a session's Claude asks to start another, and finds the sessions it came from and started: the address it was
// given (its id and token, as $PAUDE_START) is the login, so no owner's token is handed to a session
const sessionStartsRoutes = async request => {
	const match =
		requestMatch('POST', '/api/session-starts/:session/:token', request) ||
		requestMatch('GET', '/api/session-starts/:session/:token', request);

	if (!match) return null;
	if (match.token !== startToken(hookSecret, match.session)) return new Response('Not Found', { status: 404 });

	if (request.method === 'GET') {
		const from = startedFrom(match.session);

		return Response.json({
			session: await described(match.session),
			from: from && { ...(await described(from.from)), by: from.by, at: from.at },
			started: await Promise.all(
				startedBy(match.session).map(async ({ id, at }) => ({ ...(await described(id)), at })),
			),
		});
	}

	// Asked of the people in it, so only while it runs: a session that isn't running has no one to ask
	if (!runningSession(match.session))
		return new Response('Only a running session can ask to start another', { status: 409 });

	const parent = await sessionRecord(match.session);
	const wanted = await requestOf(await request.json().catch(() => ({})), parent);

	if (wanted.refused) return new Response(wanted.refused, { status: 400 });

	return asked(parent, wanted);
};

export default sessionStartsRoutes;
