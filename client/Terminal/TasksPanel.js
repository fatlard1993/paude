import { getEnvironment, getRun, getTasks, runTask, setAfterTurn, stopProcess, stopRun } from '../api';
import { button, closeButton, element, icon } from '../dom';
import { canType } from '../identity';
import relativeTime from '../../shared/relativeTime';
import Panel from './GitPanel.styles';

const KIND_ICONS = { test: 'flask', check: 'circle-check', build: 'hammer', serve: 'server', run: 'play' };
const FOLLOW_MS = 700;

const seconds = (from, to = Date.now()) => {
	const total = Math.max(0, Math.round((to - from) / 1000));

	return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;
};

const megabytes = bytes => `${Math.round(bytes / 1024 / 1024)} MB`;

// How a run went, in a word or two
const outcome = run => {
	if (run.code === undefined || run.code === null)
		return { text: `running ${seconds(run.startedAt)}`, state: 'running' };

	const time = seconds(run.startedAt, run.endedAt);
	const tests = run.tests
		? `${run.tests.passed} passed${run.tests.failed ? `, ${run.tests.failed} failed` : ''} · `
		: '';

	if (run.stopped) return { text: `stopped · ${time}`, state: 'stopped' };

	return run.code === 0
		? { text: `${tests}ok · ${time}`, state: 'ok' }
		: { text: `${tests}failed · ${time}`, state: 'failed' };
};

// The project's own commands as buttons, what they found wrong, and what the session is running. A run's output
// streams in while it runs; a problem opens its file at the line; and the problems or a run's output can go to
// Claude's prompt.
export default class TasksPanel extends Panel {
	// Set here rather than as class fields: VBC runs build() from its own constructor, before subclass fields exist
	build() {
		this.bar = element('div', 'bar');
		this.output = element('div', 'output');
		this.body = element('div', 'body');
		this.bar.append(
			element('span', 'branch', 'Tasks'),
			element('span', 'spacer'),
			closeButton(() => this.options.close()),
		);
		this.elem.tabIndex = -1;
		this.elem.append(this.bar, this.output, this.body);
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;

			event.stopPropagation();
			if (this.viewing) this.leaveRun();
			else this.options.close();
		});
	}

	say(text) {
		this.output.replaceChildren(
			element('pre', '', text),
			button('', () => this.output.classList.remove('shown'), {
				icon: 'xmark',
				title: 'Dismiss',
				className: 'icon-only',
			}),
		);
		this.output.classList.add('error', 'shown');
	}

	async refresh() {
		if (this.viewing) return this.followRun();

		const { body, response } = await getTasks(this.options.sessionId);

		// A run opened while the list was on its way: the run's output stays
		if (this.viewing) return;

		if (!response?.ok) {
			this.body.replaceChildren(element('div', 'empty', 'Could not read the tasks here.'));

			return;
		}

		this.state = body;
		this.renderTasks();
	}

	// The newest run of each task
	latestRuns() {
		const latest = new Map();

		for (const run of this.state.runs) latest.set(run.taskId, run);

		return latest;
	}

	renderTasks() {
		const { tasks, processes } = this.state;
		const latest = this.latestRuns();
		const problems = [...latest.values()].flatMap(run => run.problems.map(problem => ({ ...problem, task: run.name })));
		const nodes = [element('div', 'section-head', 'Tasks')];

		if (!tasks.length)
			nodes.push(element('div', 'empty', 'No package.json scripts, Makefile, justfile, Cargo, Go or pytest here.'));
		for (const task of tasks) nodes.push(this.taskRow(task, latest.get(task.id)));

		const head = element('div', 'section-head', `Problems ${problems.length || ''}`);

		if (problems.length && canType())
			head.append(
				button('Attach all', () =>
					this.options.attach(
						`Problems found by ${[...new Set(problems.map(problem => problem.task))].join(', ')}:\n${problems
							.map(
								problem =>
									`${problem.file}:${problem.line}${problem.column ? `:${problem.column}` : ''}: ${problem.message}`,
							)
							.join('\n')}`,
					),
				),
			);
		nodes.push(head);
		if (!problems.length)
			nodes.push(
				element(
					'div',
					'empty',
					latest.size ? 'None in the latest runs.' : 'Run a check or the tests to see them here.',
				),
			);
		for (const problem of problems) {
			const row = element('button', `problem ${problem.severity}`);

			row.append(
				element('span', 'where', `${problem.file}:${problem.line}`),
				element('span', 'message', problem.message),
			);
			row.title = `${problem.task}: ${problem.message}`;
			row.addEventListener('click', () => this.options.openFile(problem.file, problem.line));
			nodes.push(row);
		}

		nodes.push(element('div', 'section-head', 'Running'));
		if (!processes.length) nodes.push(element('div', 'empty', 'Nothing but Claude.'));
		for (const found of processes) {
			const row = element('div', 'branch-row process');

			row.append(
				element('span', 'name', found.args || found.command),
				element(
					'span',
					'meta',
					`${megabytes(found.memoryBytes)} · ${Math.round(found.cpuSeconds)}s cpu · ${relativeTime(found.startedAt)}`,
				),
			);
			row.title = `pid ${found.pid}: ${found.args}`;
			if (canType())
				row.append(
					button(
						'',
						async () => {
							const { body, response } = await stopProcess(this.options.sessionId, found.pid);

							if (!response?.ok) this.say(typeof body === 'string' ? body : 'Could not stop it.');
							setTimeout(() => this.refresh(), 500);
						},
						{ icon: 'stop', title: 'Stop it', className: 'icon-only danger' },
					),
				);
			nodes.push(row);
		}

		if (canType()) nodes.push(...this.environmentNodes());

		this.body.replaceChildren(...nodes);
	}

	// What the session's processes see, and the project's .env files: shown on asking, secret values masked
	environmentNodes() {
		const head = element('div', 'section-head', 'Environment');

		head.append(
			button(this.environment ? 'Hide' : 'Show', async () => {
				this.environment = this.environment ? null : (await getEnvironment(this.options.sessionId)).body;
				this.renderTasks();
			}),
		);
		if (!this.environment) return [head];

		const variable = ({ name, value }) => {
			const row = element('div', 'variable');

			row.append(element('span', 'where', name), element('span', 'message', value));

			return row;
		};

		return [
			head,
			...this.environment.files.flatMap(({ file, variables }) => [
				element('div', 'meta', file),
				...variables.map(variable),
			]),
			element('div', 'meta', 'The session'),
			...this.environment.variables.map(variable),
		];
	}

	taskRow(task, run) {
		const row = element('div', 'branch-row task');
		const name = element('button', 'name task-name');
		const running = run && (run.code === undefined || run.code === null);

		name.append(icon(KIND_ICONS[task.kind]), ` ${task.name}`);
		name.title = `${task.command.join(' ')} (${task.source})${run ? ': show its last run' : ''}`;
		name.addEventListener('click', () => (run ? this.showRun(run.id) : this.start(task)));
		row.append(name);
		if (run) {
			const { text, state } = outcome(run);

			row.append(element('span', `meta outcome ${state}`, text));
		}
		if (!canType()) return row;

		const after = button(
			'',
			async () => {
				await setAfterTurn(this.options.sessionId, task.id, !task.afterTurn);
				this.refresh();
			},
			{
				icon: 'rotate',
				title: task.afterTurn
					? "Runs after each of Claude's turns that edits files (click to stop)"
					: "Run it after each of Claude's turns that edits files",
				className: `icon-only${task.afterTurn ? ' on' : ''}`,
			},
		);

		row.append(
			after,
			running
				? button('', () => stopRun(this.options.sessionId, run.id), {
						icon: 'stop',
						title: 'Stop it',
						className: 'icon-only danger',
					})
				: button('', () => this.start(task), {
						icon: 'play',
						title: `Run ${task.command.join(' ')}`,
						className: 'icon-only',
					}),
		);

		return row;
	}

	async start(task) {
		const { body, response } = await runTask(this.options.sessionId, task.id);

		if (!response?.ok) return this.say(typeof body === 'string' ? body : `Could not run ${task.name}.`);
		this.showRun(body.id);
	}

	// One run's output, followed while it runs
	showRun(runId) {
		this.viewing = { id: runId, text: '' };
		this.followRun();
	}

	leaveRun() {
		clearTimeout(this.following);
		this.viewing = null;
		this.refresh();
	}

	async followRun() {
		clearTimeout(this.following);

		const viewing = this.viewing;
		const { body, response } = await getRun(this.options.sessionId, viewing.id, viewing.text.length);

		if (this.viewing !== viewing) return;
		if (!response?.ok) return this.leaveRun();

		viewing.text += body.output;

		const { text, state } = outcome(body);
		const head = element('div', 'run-head');
		const output = element('pre', 'step-output run-output', viewing.text);
		const back = button('', () => this.leaveRun(), {
			icon: 'arrow-left',
			title: 'Back to the tasks',
			className: 'icon-only',
		});
		const running = state === 'running';

		head.append(
			back,
			element('span', 'branch', body.name),
			element('span', `meta outcome ${state}`, text),
			element('span', 'spacer'),
		);
		if (canType()) {
			head.append(
				running
					? button('Stop', () => stopRun(this.options.sessionId, body.id))
					: button('Run again', () => this.start({ id: body.taskId, name: body.name })),
				button('Attach output', () =>
					this.options.attach(`Output of ${body.command} (${text}):\n${viewing.text.slice(-12_000)}`),
				),
			);
		}

		const atBottom =
			!this.runOutput || this.runOutput.scrollTop + this.runOutput.clientHeight >= this.runOutput.scrollHeight - 8;

		this.body.replaceChildren(head, output);
		this.runOutput = output;
		if (atBottom) output.scrollTop = output.scrollHeight;
		if (running) this.following = setTimeout(() => this.followRun(), FOLLOW_MS);
	}
}
