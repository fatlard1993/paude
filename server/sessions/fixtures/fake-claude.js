#!/usr/bin/env bun
// Stands in for the claude CLI in tests: titles itself the way Claude Code does, goes busy on "work", redraws on a
// resize, echoes other lines, and exits on "exit"
const write = text => process.stdout.write(text);
const title = text => write(`\x1b]0;${text}\x07`);

title('✳ Fake session');
write('ready\r\n');
// What Claude does on a size change: draws the screen again
process.stdout.on('resize', () => write(`redrawn at ${process.stdout.columns}x${process.stdout.rows}\r\n`));

for await (const line of console) {
	if (line === 'exit') process.exit(0);
	if (line === 'work') {
		title('◐ Fake session');
		await Bun.sleep(150);
		title('◑ Fake session');
		await Bun.sleep(150);
		title('✳ Fake session');
		write('✻ Worked for 1s · done 2:48 PM\r\n');
	} else write(`echo: ${line}\r\n`);
}
