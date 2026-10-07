import { credentialOf, identityOf } from '../auth';
import { may } from '../permissions';
import { projectOf } from '../projects';
import { sessionRecord } from '../sessions/record';
import {
	TaskError,
	afterTurnTasks,
	discoverTasks,
	processesOf,
	runOutput,
	runTask,
	runsOf,
	setAfterTurn,
	stopProcess,
	stopRun,
} from '../tasks';
import requestMatch from '../utils/requestMatch';

// The Tasks panel: what's there and what's running is reading the project ('files'); starting or stopping anything,
// or choosing what runs after each turn, is as much a write as typing into Claude ('type')
const ROUTES = [
	['GET', '/api/sessions/:id/tasks', 'files'],
	['GET', '/api/sessions/:id/tasks/runs/:run', 'files'],
	['POST', '/api/sessions/:id/tasks/run', 'type'],
	['POST', '/api/sessions/:id/tasks/runs/:run/stop', 'type'],
	['POST', '/api/sessions/:id/tasks/after-turn', 'type'],
	['POST', '/api/sessions/:id/processes/:pid/stop', 'type'],
];

const tasksRoutes = async request => {
	const found = ROUTES.map(([method, pattern, role]) => ({
		match: requestMatch(method, pattern, request),
		pattern,
		role,
	})).find(({ match }) => match);

	if (!found) return null;

	const { match, pattern, role } = found;

	if (!may(identityOf(credentialOf(request)), role, match.id))
		return new Response('Not part of your invite', { status: 403 });

	const record = await sessionRecord(match.id);

	if (!record) return new Response('Session not found', { status: 404 });

	const project = projectOf(record.cwd);

	try {
		switch (pattern) {
			case '/api/sessions/:id/tasks': {
				const after = new Set(afterTurnTasks(project));

				return Response.json({
					tasks: (await discoverTasks(record.cwd)).map(task => ({ ...task, afterTurn: after.has(task.id) })),
					runs: runsOf(match.id),
					processes: await processesOf(match.id),
				});
			}
			case '/api/sessions/:id/tasks/runs/:run':
				return Response.json(runOutput(match.id, match.run, match.from));
			case '/api/sessions/:id/tasks/run':
				return Response.json(await runTask(match.id, record.cwd, (await request.json()).task));
			case '/api/sessions/:id/tasks/runs/:run/stop':
				await stopRun(match.id, match.run);

				return new Response(null, { status: 204 });
			case '/api/sessions/:id/tasks/after-turn': {
				const { task, on } = await request.json();

				await setAfterTurn(project, task, Boolean(on));

				return new Response(null, { status: 204 });
			}
			default:
				await stopProcess(match.id, match.pid);

				return new Response(null, { status: 204 });
		}
	} catch (error) {
		if (error instanceof TaskError) return new Response(error.message, { status: 400 });
		throw error;
	}
};

export default tasksRoutes;
