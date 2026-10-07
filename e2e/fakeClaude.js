#!/usr/bin/env bun
// Stands in for Claude Code in the browser tests, drawing the way it does now: on the alternate screen, with done
// lines, a URL, a file path, and a prompt box. PAUDE_E2E_FAKE=busy keeps printing too, as Claude does mid-turn.
const write = text => process.stdout.write(text);
const busy = process.env.PAUDE_E2E_FAKE === 'busy';

const screen = () =>
	[
		'\x1b[?1049h\x1b[2J\x1b[H',
		'❯ first prompt\r\n\r\n',
		'● Some answer text, see server/app.js:3 and https://example.com/docs for more.\r\n\r\n',
		'✻ Worked for 12s · done 10:22 AM\r\n\r\n',
		'❯ second prompt\r\n\r\n',
		'● More answer.\r\n\r\n',
		'✻ Cogitated for 1m 3s · done 10:25 AM\r\n\r\n',
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

for await (const line of console) if (line === 'exit') process.exit(0);
