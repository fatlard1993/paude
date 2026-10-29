import { credentialOf, identityOf } from '../auth';
import { may } from '../permissions';
import { projectOf } from '../projects';
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
import { placeFolder, placeMark, placeMatch, placeMissing } from './place';

// The Tasks panel: what's there and what's running is reading the project ('files'); starting or stopping anything,
// or choosing what runs after each turn, is as much a write as typing into Claude ('type')
const ROUTES = [
	['GET', '/tasks', 'files'],
	['GET', '/tasks/runs/:run', 'files'],
	['POST', '/tasks/run', 'type'],
	['POST', '/tasks/runs/:run/stop', 'type'],
	['POST', '/tasks/after-turn', 'type'],
	['POST', '/processes/:pid/stop', 'type'],
];

const tasksRoutes = async request => {
	const found = ROUTES.map(([method, pattern, role]) => ({
		match: placeMatch(method, pattern, request),
		pattern,
		role,
	})).find(({ match }) => match);

	if (!found) return null;

	const { match, pattern, role } = found;

	if (!may(identityOf(credentialOf(request)), role, match.id))
		return new Response('Not part of your invite', { status: 403 });

	const cwd = await placeFolder(match);

	if (!cwd) return placeMissing(match);

	// Runs are kept per session, or per project folder or worktree
	const runner = placeMark(match, cwd);
	const project = match.project ?? projectOf(cwd);

	try {
		switch (pattern) {
			case '/tasks': {
				const after = new Set(afterTurnTasks(project));

				return Response.json({
					tasks: (await discoverTasks(cwd)).map(task => ({ ...task, afterTurn: after.has(task.id) })),
					runs: runsOf(runner),
					processes: await processesOf(runner),
				});
			}
			case '/tasks/runs/:run':
				return Response.json(runOutput(runner, match.run, match.from));
			case '/tasks/run':
				return Response.json(await runTask(runner, cwd, (await request.json()).task));
			case '/tasks/runs/:run/stop':
				await stopRun(runner, match.run);

				return new Response(null, { status: 204 });
			case '/tasks/after-turn': {
				const { task, on } = await request.json();

				await setAfterTurn(project, task, Boolean(on));

				return new Response(null, { status: 204 });
			}
			default:
				await stopProcess(runner, match.pid);

				return new Response(null, { status: 204 });
		}
	} catch (error) {
		if (error instanceof TaskError) return new Response(error.message, { status: 400 });
		throw error;
	}
};

export default tasksRoutes;
