// A session starting another, from inside it: `paude start` asks paude at the address the session was given
// ($PAUDE_START), which asks the people in the session first; `paude lineage` finds the sessions it came from and
// started. Neither takes a login: the address names the session and carries its own token.

export const START_USAGE = `paude start [--project <name>] [--worktree <name>] [--model <model>] [--] <prompt...>
  From inside a paude session: start a new session with that prompt, in this session's project or the one named,
  once someone in this session says yes on paude's page. Waits for the answer (up to as long as it takes; give the
  command a long timeout). With no prompt words, the prompt is read from stdin.
paude lineage
  From inside a paude session: the session it was started from and the sessions it started, with each one's status,
  transcript and page.`;

const OPTIONS = { '--project': 'project', '--worktree': 'worktree', '--model': 'model' };

// { prompt, project, worktree, model }, or { error }; prompt is null when it's to be read from stdin
export const parseStart = args => {
	const parsed = {};
	const words = [];

	for (let at = 0; at < args.length; at++) {
		const arg = args[at];

		if (arg === '--') {
			words.push(...args.slice(at + 1));
			break;
		}
		if (OPTIONS[arg]) {
			if (args[at + 1] === undefined) return { error: `${arg} needs a value` };
			parsed[OPTIONS[arg]] = args[++at];
		} else if (arg.startsWith('--')) return { error: `Not understood: ${arg}` };
		else words.push(arg);
	}

	return { ...parsed, prompt: words.length ? words.join(' ') : null };
};

const outside = () =>
	new Error(
		'paude start and paude lineage work from inside a paude session ($PAUDE_START is where it asks). From a terminal, start a session from the picker or the page.',
	);

const address = () => {
	if (!process.env.PAUDE_START) throw outside();

	return process.env.PAUDE_START;
};

const failed = async response => new Error((await response.text()) || `paude answered ${response.status}`);

const shown = session =>
	[
		`${session.title || 'New session'} (${session.id}) in ${session.project}, ${session.status}`,
		`  page:       ${session.page}`,
		`  transcript: ${session.transcript ?? 'none yet'}`,
	].join('\n');

// What paude streams back, line by line: { asked }, { waiting }, { output }, then { started, by }, { declined, by } or
// { error }
export const readAnswers = async function* (body) {
	const decoder = new TextDecoder();
	let buffered = '';

	for await (const chunk of body) {
		buffered += decoder.decode(chunk, { stream: true });

		const lines = buffered.split('\n');

		buffered = lines.pop();
		for (const line of lines) if (line.trim()) yield JSON.parse(line);
	}
	if (buffered.trim()) yield JSON.parse(buffered);
};

export const startFromSession = async args => {
	const parsed = parseStart(args);

	if (parsed.error) throw new Error(`${parsed.error}\n\n${START_USAGE}`);

	const at = address();
	const prompt = parsed.prompt ?? (process.stdin.isTTY ? '' : (await Bun.stdin.text()).trim());

	if (!prompt) throw new Error(`Say what the new session should do.\n\n${START_USAGE}`);

	const response = await fetch(at, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ ...parsed, prompt }),
	});

	if (!response.ok) throw await failed(response);

	for await (const answer of readAnswers(response.body)) {
		if (answer.asked)
			console.error("Asked in this session: waiting for someone here to say yes or no on paude's page.");
		else if (answer.output) console.error(answer.output);
		else if (answer.error) throw new Error(answer.error);
		else if (answer.declined) {
			console.log(`${answer.by} said no: no session was started.`);
			process.exitCode = 1;

			return;
		} else if (answer.started) {
			console.log(`Started, on ${answer.by}'s yes:\n${shown(answer.started)}\n\`paude lineage\` finds it again.`);

			return;
		}
	}

	throw new Error('paude stopped answering before saying yes or no.');
};

export const lineage = async () => {
	const response = await fetch(address());

	if (!response.ok) throw await failed(response);

	const { from, started } = await response.json();

	console.log(
		from
			? `Started from, on ${from.by}'s yes:\n${from.gone ? `${from.id}, deleted since` : shown(from)}`
			: 'Started from: no other session (it was started by hand).',
	);
	console.log(
		started.length
			? `\nStarted from here:\n${started.map(session => (session.gone ? `${session.id}, deleted since` : shown(session))).join('\n')}`
			: '\nStarted from here: none yet.',
	);
};
