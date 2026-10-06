import { expect, test } from 'bun:test';

import { turnsFrom } from './history';

const user = (uuid, content) => ({ type: 'user', uuid, message: { content } });
const assistant = uuid => ({ type: 'assistant', uuid, message: { content: [{ type: 'text', text: 'ok' }] } });

test('each prompt is a turn ending at its last message, tool calls included', () => {
	const turns = turnsFrom([
		user('u1', 'first'),
		assistant('a1'),
		user('u2', [{ type: 'text', text: 'second' }]),
		assistant('a2'),
		user('t1', [{ type: 'tool_result', content: 'output' }]),
		assistant('a3'),
	]);

	expect(turns).toEqual([
		{ prompt: 'first', endUuid: 'a1' },
		{ prompt: 'second', endUuid: 'a3', last: true },
	]);
});

test('slash-command markup is not a prompt, and a turn without a reply is not complete', () => {
	const turns = turnsFrom([
		user('u1', 'first'),
		assistant('a1'),
		user('c1', '<command-name>/effort</command-name>'),
		user('c2', '<local-command-stdout>medium</local-command-stdout>'),
		user('u2', 'still running'),
	]);

	expect(turns).toEqual([{ prompt: 'first', endUuid: 'c2' }]);
});

test('a pasted prompt starting with < counts; an interrupted turn does not', () => {
	const turns = turnsFrom([
		user('u1', '<div>fix this markup</div>'),
		assistant('a1'),
		user('u2', 'do something long'),
		assistant('a2'),
		user('i1', [{ type: 'text', text: '[Request interrupted by user]' }]),
		user('u3', 'next'),
		assistant('a3'),
	]);

	expect(turns).toEqual([
		{ prompt: '<div>fix this markup</div>', endUuid: 'a1' },
		{ prompt: 'next', endUuid: 'a3', last: true },
	]);
});
