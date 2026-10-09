import os from 'os';
import { expect, test } from 'bun:test';

import { artifactsOfLine, commandFolder, kindOfPath, pathsIn, shownPath } from './artifacts';

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

test("a command's relative paths are from where it cd's first", () => {
	expect(commandFolder('cd /tmp/scratch && bun x.js', '/work/app')).toBe('/tmp/scratch');
	expect(commandFolder('cd "my dir"; ls', '/work/app')).toBe('/work/app/my dir');
	expect(commandFolder('ls', '/work/app')).toBe('/work/app');
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
	).toEqual([{ file: '/tmp/s/chart.py', by: 'command', why: 'Render the chart' }]);
	expect(artifactsOfLine(result('Saved chart.png'), state)).toEqual([
		{ file: '/tmp/s/chart.png', by: 'output', why: 'Render the chart' },
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
