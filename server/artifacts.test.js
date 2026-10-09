import os from 'os';
import { expect, test } from 'bun:test';

import { artifactsOfLine, commandFolders, kindOfPath, pathsIn, shownPath, withVariables } from './artifacts';

const freshState = () => ({ turn: '', said: '', cwd: '/work/app', commands: new Map() });
const said = text => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const tool = (name, input, id = 't1') => ({
	type: 'assistant',
	message: { content: [{ type: 'tool_use', id, name, input }] },
});
const result = (text, id = 't1') => ({
	type: 'user',
	message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
});

test('paths with an artifact kind, made absolute, without dependencies, builds or hidden folders', () => {
	expect(pathsIn('node shot.js && open out/report.html ~/Desktop/a.png /tmp/x.csv', '/work/app')).toEqual([
		'/work/app/shot.js',
		'/work/app/out/report.html',
		`${os.homedir()}/Desktop/a.png`,
		'/tmp/x.csv',
	]);
	expect(pathsIn('cat node_modules/x/a.js dist/app.js .git/HEAD.txt ~/.paude/auth.json', '/work/app')).toEqual([]);
	expect(kindOfPath('/a/b.PNG')).toBe('image');
	expect(kindOfPath('/a/Makefile')).toBeNull();
});

test("a command's relative paths may be from where the session is or anywhere it cd's", () => {
	expect(commandFolders('cd /tmp/scratch && bun x.js', '/work/app')).toEqual(['/work/app', '/tmp/scratch']);
	expect(commandFolders('mkdir -p out; cd "my dir"; ls', '/work/app')).toEqual(['/work/app', '/work/app/my dir']);
	expect(commandFolders('ls', '/work/app')).toEqual(['/work/app']);
	expect(pathsIn('cat a.csv /tmp/b.csv', ['/work/app', '/tmp/s'])).toEqual([
		'/work/app/a.csv',
		'/tmp/s/a.csv',
		'/tmp/b.csv',
	]);
});

test('what Claude wrote, looked at, and its commands named, each with what it was for', () => {
	const state = freshState();

	expect(artifactsOfLine({ type: 'user', message: { content: 'make a chart' } }, state)).toEqual([]);
	expect(state.turn).toBe('make a chart');
	artifactsOfLine(said('Drawing it now.'), state);
	expect(artifactsOfLine(tool('Write', { file_path: '/tmp/s/chart.py' }), state)).toEqual([
		{ file: '/tmp/s/chart.py', by: 'written', why: 'Drawing it now.' },
	]);
	expect(
		artifactsOfLine(tool('Bash', { command: 'cd /tmp/s && python chart.py', description: 'Render the chart' }), state),
	).toEqual([
		// Wherever it may be: what isn't there is left out when listed
		{ file: '/work/app/chart.py', by: 'command', why: 'Render the chart' },
		{ file: '/tmp/s/chart.py', by: 'command', why: 'Render the chart' },
	]);
	expect(artifactsOfLine(result('Saved chart.png'), state).map(found => found.file)).toEqual([
		'/work/app/chart.png',
		'/tmp/s/chart.png',
	]);
	expect(artifactsOfLine(tool('Read', { file_path: '/tmp/s/chart.png' }, 't2'), state)).toEqual([
		{ file: '/tmp/s/chart.png', by: 'viewed', why: 'Drawing it now.' },
	]);
	// Code it read is just reading
	expect(artifactsOfLine(tool('Read', { file_path: '/work/app/src/a.js' }, 't3'), state)).toEqual([]);
});

test('a path as it reads best: from the project, the scratchpad, or home', () => {
	expect(shownPath('/work/app/out/a.png', '/work/app')).toBe('out/a.png');
	expect(shownPath('/tmp/claude-1000/-home-me-app/0f1e-22/scratchpad/sel/a.png', '/work/app')).toBe(
		'scratchpad/sel/a.png',
	);
	expect(shownPath(`${os.homedir()}/Desktop/a.png`, '/work/app')).toBe('~/Desktop/a.png');
	expect(shownPath('/var/tmp/a.png')).toBe('/var/tmp/a.png');
});

test('a path built from a variable the command sets is seen whole', () => {
	expect(withVariables('D=/tmp/viz\nmkdir -p $D && cat > $D/gen.js && node ${D}/gen.js > "$D/out.csv"')).toBe(
		'D=/tmp/viz\nmkdir -p /tmp/viz && cat > /tmp/viz/gen.js && node /tmp/viz/gen.js > "/tmp/viz/out.csv"',
	);
	expect(withVariables('OUT="/tmp/a b"; ls $OUTPUT $OUT')).toBe('OUT="/tmp/a b"; ls $OUTPUT /tmp/a b');
	expect(pathsIn(withVariables('D=/tmp/viz; cat > $D/gen.js'), '/work')).toEqual(['/tmp/viz/gen.js']);
	expect(pathsIn('cat /tmp/claude-1000/bundled-skills/2.1/x/dataviz/palette.md', '/work')).toEqual([]);
});
