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

for await (const line of console) {
	if (line === 'exit') process.exit(0);
	if (TITLES[line]) write(`\x1b]0;${TITLES[line]}\x07`);
}
