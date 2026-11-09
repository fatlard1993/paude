#!/usr/bin/env bun
// Stands in for Claude Code in the browser tests, drawing the way it does now: on the alternate screen, with done
// lines, a URL, a file path, and a prompt box. PAUDE_E2E_FAKE=busy keeps printing too, as Claude does mid-turn.
// Typing work or rest titles the terminal as Claude does while working or idle.
const write = text => process.stdout.write(text);

// A tour of code, as the files panel asks Haiku for one: two stops, on the first lines shown and three lines on
const tourOf = prompt => {
	const first = Number(/^[+ -]? ?(\d+) \|/m.exec(prompt)?.[1] ?? 1);
	const file = /^File (\S+) \(/m.exec(prompt)?.[1];
	const stop = (from, text) => ({ ...(file && { file, side: 'new' }), from, to: from + 1, text });

	return JSON.stringify({
		overview: 'It sets lines up, one after another.',
		stops: [stop(first, 'The first two lines.'), stop(first + 3, 'Two more, a little further on.')],
	});
};

// claude -p: reads its prompt, answers once: a tour, what to open, links described (as the Links panel asks Haiku), or a commit
// message
if (process.argv.includes('-p')) {
	const prompt = await Bun.stdin.text();

	if (process.env.PAUDE_E2E_FAKE_LOG)
		(await import('fs')).appendFileSync(process.env.PAUDE_E2E_FAKE_LOG, `-p ${prompt.slice(0, 4000)}\n---\n`);
	const links = [...prompt.matchAll(/^(\d+)\. (\S+)/gm)];

	if (prompt.includes('as a guided tour')) {
		write(tourOf(prompt));
		process.exit(0);
	}
	// What to open for a few words asked aside: the file named by a word of it (app for server/app.js), and the latest
	// commit when there is one
	if (prompt.includes('asks to open something')) {
		const words = /asks to open something: "(.*)"/.exec(prompt)[1].split(' ');
		const files = /^The project's files:\n([\s\S]*)$/m.exec(prompt)?.[1].split('\n') ?? [];
		const file = files.find(path => words.includes(path.split('/').pop().split('.')[0]));
		const commit = /^The latest commits:\n(\w+)/m.exec(prompt)?.[1];

		write(
			JSON.stringify({ said: 'The app, and the latest commit.', open: [{ file }, ...(commit ? [{ commit }] : [])] }),
		);
		process.exit(0);
	}
	// The Decisions panel: what each turn settled (a turn about locking settles one), then where each is written down
	// (in a commit that says so)
	if (prompt.includes('Find what each turn settled')) {
		const turns = [
			...prompt.matchAll(/^Turn (\d+)\n {2}Asked: (.*)(?:\n {2}The person added while Claude worked: (.*))?$/gm),
		];

		write(
			JSON.stringify(
				Object.fromEntries(
					turns.map(([, number, asked, added]) => [
						number,
						asked.includes('lock')
							? [
									{
										kind: 'decision',
										chose: 'Lock accounts per user',
										rejected: 'Per session',
										because: added ?? 'A new session would reset the count',
									},
								]
							: [],
					]),
				),
			),
		);
		process.exit(0);
	}
	if (prompt.includes('Written down means that place says the same thing')) {
		const commit = /^commit (\w+)\n.*per user/im.exec(prompt)?.[1] ?? null;

		write(
			JSON.stringify(Object.fromEntries([...prompt.matchAll(/^(\d+)\. /gm)].map(([, number]) => [number, commit]))),
		);
		process.exit(0);
	}

	// Where a prompt goes: the first conversation, for a task that says it carries one on, and the first project
	if (prompt.includes('Decide where it belongs')) {
		const task = /^The task:\n(.*)$/m.exec(prompt)?.[1] ?? '';
		const project = /the projects \(each on its server\) are: ([^,\n]+?)(?:,|\.$)/m.exec(prompt)?.[1];
		const carries = task.includes('carry on') && prompt.includes('The conversations:');

		write(
			JSON.stringify({
				matches: carries ? [{ n: 1, why: 'It carries on the latest conversation.' }] : [],
				fresh: { ...(project && { project }), lifetime: 'ordinary', why: 'A task of its own.' },
			}),
		);
		process.exit(0);
	}
	// Filing what explains a pushed commit into the next open one changing its files
	if (prompt.includes('Write the whole message anew') && prompt.includes('The message now:\ncount tries')) {
		write(
			JSON.stringify({
				message: 'count tries\n\nLocks per user, not per session: a new session would reset the count.',
				says: [1],
			}),
		);
		process.exit(0);
	}
	// Filing one into the commit it shaped: what it can't settle it asks, until the person has answered
	if (prompt.includes('Write the whole message anew')) {
		// The person's answer settles why, or what they said mid-turn (which the reading took as the reason)
		const answered =
			/They answered: (.*)$/m.exec(prompt)?.[1] ?? /Because: (a new session would reset the count)$/m.exec(prompt)?.[1];

		write(
			JSON.stringify(
				answered
					? { message: `lock accounts\n\nLocks per user, not per session: ${answered}`, says: [1] }
					: { message: '', says: [], ask: { 1: 'Why per user and not per session?' } },
			),
		);
		process.exit(0);
	}

	write(
		process.argv.includes('haiku')
			? JSON.stringify(Object.fromEntries(links.map(([, number, url]) => [number, `described ${new URL(url).host}`])))
			: 'describe the staged change\n',
	);
	process.exit(0);
}

const busy = process.env.PAUDE_E2E_FAKE === 'busy';

const screen = () =>
	[
		'\x1b[?1049h\x1b[2J\x1b[H',
		'❯ first prompt\r\n\r\n',
		'● Some answer text, see server/app.js:3 and https://example.com/docs for more.\r\n\r\n',
		'✻ Worked for 12s · done 10:22 AM\r\n\r\n',
		'❯ second prompt\r\n\r\n',
		'● More answer.\r\n\r\n',
		'✻ Cogitated for 1m 3s · done 10:25 AM · 1 shell still running\r\n\r\n',
	].join('');

write(screen());

if (busy) {
	let tick = 0;

	setInterval(() => {
		tick += 1;
		write(`\r\x1b[2K✻ Thinking… ${tick}`);
		if (tick % 10 === 0) write(`\r\x1b[2Knew output line ${tick}\r\n`);
	}, 100);
}

const TITLES = { work: '◐ Working', rest: '✳ Resting' };

// --- Asking, as the arcade has Claude do every turn: a prompt with "ask" in it brings up an AskUserQuestion dialog
// drawn as Claude Code draws one (a rule, a ☐ title, the question, numbered choices with a detail line under each,
// "Type something", the footer), recorded in the transcript as the tool call, and reported through the hooks paude
// gave in --settings, so paude sees the turn as it would with the real Claude. A digit answers; "Type something" (3)
// opens for words. Each answer changes Game.js, says so, and asks the next question, round and round.
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const QUESTIONS = [
	{
		header: 'Next',
		question: 'What should happen next?',
		options: [
			{ label: '🐸 A frog', description: 'A frog that jumps over logs' },
			{ label: '⭐ A star', description: 'A star to catch' },
		],
	},
	{
		header: 'Then',
		question: 'And after that?',
		options: [
			{ label: '🌙 A moon', description: 'Night falls' },
			{ label: '🌧️ Rain', description: 'Rain that falls' },
		],
	},
];
const settingsArgument = process.argv[process.argv.indexOf('--settings') + 1] ?? '';
const hookMatch = /http:\/\/([^\s\\"]+)\/api\/hooks\/([A-Za-z0-9_-]+)/.exec(settingsArgument);
const hookBase = hookMatch ? `http://${hookMatch[1]}/api/hooks/${hookMatch[2]}` : null;
const sessionId = process.env.PAUDE_SESSION ?? 'fake';
const hook = async payload => {
	if (!hookBase) return;
	await fetch(`${hookBase}/${sessionId}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ session_id: sessionId, ...payload }),
	}).catch(() => {});
};
const transcriptPath = () => {
	const folder = join(
		process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
		'projects',
		process.cwd().replace(/[^a-zA-Z0-9]/g, '-'),
	);

	mkdirSync(folder, { recursive: true });

	return join(folder, `${sessionId}.jsonl`);
};
const record = line =>
	appendFileSync(
		transcriptPath(),
		`${JSON.stringify({ sessionId, cwd: process.cwd(), timestamp: new Date().toISOString(), ...line })}\n`,
	);

let asking = null; // { set, id, typing: text | null }
let round = 0;
let input = '';

const drawDialog = () => {
	const { set, typing } = asking;
	const rows = set.options.flatMap((option, index) => [
		`${typing === null && index === 0 ? '❯' : ' '} ${index + 1}. ${option.label}`,
		`     ${option.description}`,
	]);

	write(
		`${screen()}${'─'.repeat(60)}\r\n☐ ${set.header}\r\n\r\n${set.question}\r\n${rows.join('\r\n')}\r\n` +
			`${typing === null ? ' ' : '❯'} 3. Type something.\r\n${typing ? `     ${typing}\r\n` : ''}` +
			'Enter to confirm · Esc to cancel\r\n',
	);
};

const ask = async () => {
	const set = QUESTIONS[round % QUESTIONS.length];

	log(`ask ${set.question}`);
	const id = `ask-${round}`;

	round += 1;
	asking = { set, id, typing: null };
	record({
		type: 'assistant',
		message: {
			role: 'assistant',
			content: [
				{ type: 'text', text: `Ready. ${set.question}` },
				{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: [set] } },
			],
		},
	});
	await hook({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [set] } });
	drawDialog();
	await hook({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' });
};

const answer = async text => {
	const { set, id } = asking;

	log(`answer ${text}`);
	asking = null;
	record({
		type: 'user',
		message: {
			role: 'user',
			content: [{ type: 'tool_result', tool_use_id: id, content: `The user answered: "${set.question}"="${text}".` }],
		},
		toolUseResult: { questions: [set], answers: { [set.question]: text } },
	});
	await hook({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [set] } });
	write(`${screen()}● Making it: ${text}\r\n`);
	writeFileSync(join(process.cwd(), 'Game.js'), `export default ${JSON.stringify(text)};\n`);
	record({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `Made it: ${text}` }] } });
	setTimeout(ask, 700);
};

const prompted = async text => {
	if (text === 'exit') process.exit(0);
	if (TITLES[text]) return write(`\x1b]0;${TITLES[text]}\x07`);
	if (!/\bask\b/i.test(text) && !asking) return;
	record({ type: 'user', message: { role: 'user', content: text } });
	await hook({ hook_event_name: 'UserPromptSubmit', prompt: text });
	await ask();
};

// Interrupted by words while asking, as Claude Code is: the question is dropped and the words are the prompt
const interrupted = async text => {
	const { set, id } = asking;

	asking = null;
	record({
		type: 'user',
		message: {
			role: 'user',
			content: [
				{ type: 'tool_result', tool_use_id: id, content: "The user doesn't want to proceed with this tool use." },
			],
		},
		toolUseResult: 'User rejected tool use',
	});
	write(`${screen()}● Heard: ${text}\r\n`);
	record({ type: 'user', message: { role: 'user', content: text } });
	await hook({ hook_event_name: 'UserPromptSubmit', prompt: text });
	writeFileSync(join(process.cwd(), 'Game.js'), `export default ${JSON.stringify(text)};\n`);
	record({
		type: 'assistant',
		message: { role: 'assistant', content: [{ type: 'text', text: `Made it: ${text} (after ${set.question})` }] },
	});
	setTimeout(ask, 700);
};

const unpasted = text => text.replaceAll('\x1b[200~', '').replaceAll('\x1b[201~', '');
// What the fake heard and did, for a test to read when it goes wrong
const log = text => process.env.PAUDE_E2E_FAKE_LOG && appendFileSync(process.env.PAUDE_E2E_FAKE_LOG, `${text}\n`);

// Keys one at a time (a choice is a digit with no Enter), with the terminal still echoing what's typed, as it did
// when this read whole lines
Bun.spawnSync(['stty', '-icanon', 'min', '1'], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
// The arcade test says when to ask by dropping an .ask file in the project, since its page has no terminal to type in
setInterval(() => {
	if (asking || !existsSync('.ask')) return;
	rmSync('.ask', { force: true });
	ask();
}, 200);
process.stdin.on('data', chunk => {
	log(`heard ${JSON.stringify(chunk.toString())} asking=${asking ? 'yes' : 'no'} typing=${asking?.typing !== null}`);
	for (const key of unpasted(chunk.toString())) {
		if (asking && asking.typing === null) {
			if (key === '1' || key === '2') answer(asking.set.options[Number(key) - 1].label);
			else if (key === '3') {
				asking.typing = '';
				drawDialog();
			} else if (key === '\x1b') {
				asking = null;
				write(screen());
			} else if (key === '\r' || key === '\n') {
				if (input.trim()) interrupted(input.trim());
				input = '';
			} else input += key;
			continue;
		}
		if (asking) {
			if (key === '\r' || key === '\n') {
				if (asking.typing.trim()) answer(asking.typing.trim());
			} else {
				asking.typing += key;
				drawDialog();
			}
			continue;
		}
		if (key === '\r' || key === '\n') {
			const text = input.trim();

			input = '';
			if (text) prompted(text);
		} else input += key;
	}
});
