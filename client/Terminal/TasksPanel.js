import { relativeTime } from '@vanilla-bean/components/utils/date';
import {
	getEnvironment,
	getRun,
	getShares,
	getTasks,
	runTask,
	sessionOf,
	setAfterTurn,
	stopProcess,
	stopRun,
} from '../api';
import { button, closeButton, element } from '../dom';
import { canType } from '../identity';
import Panel from './GitPanel.styles';

// The commands that run and end, by what they're for; a server (dev, start) is the Running section's
const TASK_GROUPS = [
	['Checks', ['test', 'check']],
	['Build', ['build']],
	['Other', ['run']],
];
// How a task's last run went, at a glance
const MARKS = { ok: '✓', failed: '✗', running: '●', stopped: '■', never: '·' };
// A task's errors show unfolded up to this many
const OPEN_ERRORS = 20;
const FOLLOW_MS = 700;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const isRunning = run => run.code === undefined || run.code === null;

// "179 warnings", or "179 warnings, 176 spelling" when one rule makes up most of them
const warningsSaid = warnings => {
	const rules = new Map();

	for (const { message } of warnings) {
		const rule = /\s(\S+\/\S+|[\w-]+)$/.exec(message.trim())?.[1];

		if (rule) rules.set(rule, (rules.get(rule) ?? 0) + 1);
	}

	const [rule, count] = [...rules].sort((a, b) => b[1] - a[1])[0] ?? [];

	return count > warnings.length / 2
		? `${plural(warnings.length, 'warning')}, ${count} ${rule.split('/').at(-1)}`
		: plural(warnings.length, 'warning');
};

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
		? `${run.tests.passed} passed${run.tests.failed ? `, ${run.tests.failed} failed` : ''}${run.tests.errors ? `, ${run.tests.errors} errors` : ''} · `
		: '';

	if (run.stopped) return { text: `stopped · ${time}`, state: 'stopped' };

	// A runner can exit 0 with failures or errors (piped through grep, say); its own counts win
	const counted = !run.tests || (!run.tests.failed && !run.tests.errors && run.tests.passed > 0);

	return run.code === 0 && counted
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

	// Which of the panel's parts it shows: its checks (and builds and scripts, with what they found wrong), what's
	// running (servers, other processes, the environment), or both where nothing else shows what's running
	get sections() {
		return this.options.sections ?? ['checks', 'running'];
	}

	async refresh() {
		if (this.viewing) return this.followRun();

		const running = this.sections.includes('running') && sessionOf(this.options.place);
		const [{ body, response }, shared] = await Promise.all([
			getTasks(this.options.place),
			running ? getShares(running).catch(() => ({})) : {},
		]);

		// A run opened while the list was on its way: the run's output stays
		if (this.viewing) return;

		if (!response?.ok) {
			this.body.replaceChildren(
				element('div', 'empty', 'Could not read the tasks here.'),
				button('Try again', () => this.refresh(), { className: 'variant-flat' }),
			);

			return;
		}

		this.state = { ...body, shares: shared.body?.shares ?? [] };
		this.renderTasks();
	}

	// The newest run of each task
	latestRuns() {
		const latest = new Map();

		for (const run of this.state.runs) latest.set(run.taskId, run);

		return latest;
	}

	renderTasks() {
		this.body.replaceChildren(
			...(this.sections.includes('checks') ? this.checksNodes() : []),
			...(this.sections.includes('running') ? this.runningNodes() : []),
		);
	}

	// The project's commands that run and end, by what they're for, then what the latest runs of them found wrong
	checksNodes() {
		const { tasks } = this.state;
		const latest = this.latestRuns();
		const nodes = [];

		if (!tasks.length)
			return [element('div', 'empty', 'No package.json scripts, Makefile, justfile, Cargo, Go or pytest here.')];

		for (const [title, kinds] of TASK_GROUPS) {
			const members = tasks.filter(task => kinds.includes(task.kind));

			if (!members.length) continue;
			nodes.push(element('div', 'section-head', title));
			for (const task of members) nodes.push(this.taskRow(task, latest.get(task.id)));
		}

		return [...nodes, ...this.problemNodes(latest)];
	}

	// What the latest runs found wrong, a fold for each task: its errors open, its warnings folded, a kind of warning
	// that makes up most of them named
	problemNodes(latest) {
		const found = [...latest.values()].filter(run => run.problems.length);
		const head = element('div', 'section-head', 'Problems');

		if (!found.length)
			return [
				head,
				element(
					'div',
					'empty',
					latest.size ? 'None in the latest runs.' : 'Run a check or the tests to see them here.',
				),
			];

		const attach = problems =>
			problems
				.map(
					problem => `${problem.file}:${problem.line}${problem.column ? `:${problem.column}` : ''}: ${problem.message}`,
				)
				.join('\n');

		return [
			head,
			...found.map(run => {
				const errors = run.problems.filter(problem => problem.severity !== 'warning');
				const warnings = run.problems.filter(problem => problem.severity === 'warning');
				const fold = element('details', 'problems');
				const summary = element('summary');
				const said = [errors.length && plural(errors.length, 'error'), warnings.length && warningsSaid(warnings)];

				fold.open = errors.length > 0 && errors.length <= OPEN_ERRORS;
				summary.append(element('span', 'name', run.name), element('span', 'meta', said.filter(Boolean).join(', ')));
				if (canType())
					summary.append(
						button(
							'Attach',
							event => {
								event.preventDefault();
								this.options.attach(`Problems found by ${run.name}:\n${attach([...errors, ...warnings])}`);
							},
							{ className: 'variant-flat', title: `Put what ${run.name} found in Claude's prompt` },
						),
					);
				fold.append(summary, ...[...errors, ...warnings].map(problem => this.problemRow(problem)));

				return fold;
			}),
		];
	}

	problemRow(problem) {
		const row = element('button', `problem ${problem.severity} variant-flat`);

		row.append(
			element('span', 'where', `${problem.file}:${problem.line}`),
			element('span', 'message', problem.message),
		);
		row.title = problem.message;
		row.addEventListener('click', () => this.options.openFile(problem.file, problem.line));

		return row;
	}

	// What's running: the project's servers, up or not, each with the port it serves on; the session's other
	// processes; and the environment they see
	runningNodes() {
		const { tasks, processes, shares } = this.state;
		const latest = this.latestRuns();
		const servers = tasks.filter(task => task.kind === 'serve');
		const serving = new Set();
		const nodes = [element('div', 'section-head', 'Servers')];

		if (!servers.length) nodes.push(element('div', 'empty', 'No dev or start script here.'));
		for (const task of servers) {
			const run = latest.get(task.id);
			const up = run && isRunning(run);
			const theirs = up ? processes.filter(found => found.run === run.id) : [];
			const pids = new Set(theirs.map(({ pid }) => pid));
			const ports = shares.filter(share => share.kind === 'port' && pids.has(share.pid));

			for (const pid of pids) serving.add(pid);
			nodes.push(
				this.serverRow(task, run, { up, ports, memory: theirs.reduce((sum, found) => sum + found.memoryBytes, 0) }),
			);
		}

		const others = processes.filter(found => !serving.has(found.pid));
		const named = new Map(this.state.runs.map(run => [run.id, run.name]));

		nodes.push(element('div', 'section-head', 'Other processes'));
		if (!others.length)
			nodes.push(element('div', 'empty', sessionOf(this.options.place) ? 'Nothing but Claude.' : 'Nothing.'));
		for (const found of others) nodes.push(this.processRow(found, named.get(found.run)));

		if (canType()) nodes.push(...this.environmentNodes());

		return nodes;
	}

	serverRow(task, run, { up, ports, memory }) {
		const row = element('div', `branch-row task server${up ? ' up' : ''}`);
		const name = element('button', 'name task-name variant-flat');

		name.append(
			element('span', `mark ${up ? 'running' : 'idle'}`, up ? '●' : '○'),
			element('span', 'label', task.name),
		);
		name.title = `${task.command.join(' ')} (${task.source})${run ? ': show its output' : ''}`;
		if (!run) name.setAttribute('aria-disabled', 'true');
		name.addEventListener('click', () => run && this.showRun(run.id));
		const idle = run ? `stopped ${relativeTime(run.endedAt ?? run.startedAt)}` : 'not running';
		const serving = [
			...ports.map(share => `:${share.port}`),
			ports.length && 'shared',
			memory && megabytes(memory),
			run && relativeTime(run.startedAt),
		];

		name.append(
			element('span', `meta${up ? ' outcome running' : ''}`, up ? serving.filter(Boolean).join(' · ') : idle),
		);
		row.append(name);
		if (canType())
			row.append(
				up
					? button('Stop', () => stopRun(this.options.place, run.id).then(() => this.refresh()), {
							className: 'variant-flat danger',
						})
					: button('Start', () => this.start(task), { className: 'variant-flat' }),
			);

		return row;
	}

	processRow(found, runName) {
		const row = element('div', 'branch-row process');

		const said = element('div', 'name task-name');

		said.append(
			element('span', 'label', found.command),
			element(
				'span',
				'meta',
				[runName, megabytes(found.memoryBytes), `${Math.round(found.cpuSeconds)}s cpu`, relativeTime(found.startedAt)]
					.filter(Boolean)
					.join(' · '),
			),
		);
		row.append(said);
		row.title = `pid ${found.pid}: ${found.args}`;
		if (canType())
			row.append(
				button(
					'',
					async () => {
						const { body, response } = await stopProcess(this.options.place, found.pid);

						if (!response?.ok) this.say(typeof body === 'string' ? body : 'Could not stop it.');
						setTimeout(() => this.refresh(), 500);
					},
					{ icon: 'stop', title: 'Stop it', className: 'icon-only danger' },
				),
			);

		return row;
	}

	// What the session's processes see, and the project's .env files: shown on asking, secret values masked
	environmentNodes() {
		const head = element('div', 'section-head', 'Environment');

		head.append(
			button(this.environment ? 'Hide' : 'Show', async () => {
				this.environment = this.environment ? null : (await getEnvironment(this.options.place)).body;
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

	// A command that runs and ends: how its last run went, a press away; whether it runs after Claude's turns (a check
	// or the tests); and running it
	taskRow(task, run) {
		const row = element('div', 'branch-row task');
		const name = element('button', 'name task-name variant-flat');
		const running = run && isRunning(run);
		const { text, state } = run ? outcome(run) : { text: 'never run', state: 'never' };

		name.append(
			element('span', `mark ${state}`, MARKS[state]),
			element('span', 'label', task.name),
			element(
				'span',
				`meta outcome ${state}`,
				run && !running ? `${text} · ${relativeTime(run.endedAt ?? run.startedAt)}` : text,
			),
		);
		name.title = `${task.command.join(' ')} (${task.source})${run ? ': show its last run' : ''}`;
		if (!run) name.setAttribute('aria-disabled', 'true');
		name.addEventListener('click', () => run && this.showRun(run.id));
		row.append(name);
		if (!canType()) return row;

		if (['test', 'check'].includes(task.kind)) {
			const after = button(
				'after turns',
				async () => {
					const { body, response } = await setAfterTurn(this.options.place, task.id, !task.afterTurn);

					if (!response?.ok) this.say(typeof body === 'string' ? body : 'Could not change that.');
					this.refresh();
				},
				{
					title: task.afterTurn
						? "Runs after each of Claude's turns that edits files: press to stop"
						: "Run it after each of Claude's turns that edits files",
					className: `variant-flat after-turns${task.afterTurn ? ' on' : ''}`,
				},
			);

			after.setAttribute('aria-pressed', String(Boolean(task.afterTurn)));
			row.append(after);
		}
		row.append(
			running
				? button('', () => stopRun(this.options.place, run.id), {
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
		const { body, response } = await runTask(this.options.place, task.id);

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
		const { body, response } = await getRun(this.options.place, viewing.id, viewing.text.length);

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
					? button('Stop', () => stopRun(this.options.place, body.id))
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
