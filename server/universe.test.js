import { expect, test } from 'bun:test';

import {
	instrumentsOf,
	logOf,
	noteHook,
	notePrompt,
	noteTool,
	noteTurnDone,
	peopleOf,
	replyOf,
	usageOf,
} from './universe';

const OWNER = { owner: true };
const GUEST = { inviteId: 'abc', role: 'comment', name: 'Sam' };

const fakeSession = (id, clients = [], readers = []) => ({
	id,
	clients: new Set(clients.map(([identity, name]) => ({ name, role: identity.role, socket: { data: { identity } } }))),
	readers: new Map(readers.map(([identity, name], index) => [index, { name, role: identity.role, identity }])),
});

test('a person on several devices and sessions is one person, with every session they see', () => {
	const people = peopleOf([
		fakeSession('one', [
			[OWNER, 'chase'],
			[OWNER, 'chase'],
		]),
		fakeSession('two', [[GUEST, 'Sam']], [[OWNER, 'chase']]),
	]);

	expect(people).toEqual([
		{ key: expect.any(String), name: 'chase', role: undefined, sessions: ['one', 'two'] },
		{ key: expect.any(String), name: 'Sam', role: 'comment', sessions: ['two'] },
	]);
});

test('two guests going by the same name are still two people', () => {
	const other = { inviteId: 'xyz', role: 'watch', name: 'Sam' };

	const people = peopleOf([fakeSession('one', [[GUEST, 'Sam']], [[other, 'Sam']])]);

	expect(people).toHaveLength(2);
	expect(people[0].key).not.toBe(people[1].key);
});

test("a finished turn keeps Claude's reply and the prompt it answered, by the session's id", () => {
	const session = { id: 'kept' };

	notePrompt(session, 'Fix the login');
	noteTurnDone(session, 'Fixed: the cookie was not Secure.');

	expect(replyOf('kept')).toMatchObject({
		turn: 1,
		prompt: 'Fix the login',
		text: 'Fixed: the cookie was not Secure.',
	});

	noteTurnDone(session);
	expect(replyOf('kept')).toMatchObject({ turn: 2, text: null });
});

test('what the hooks say goes to the instruments: failures this turn, the todo list, subagents out, the mode', () => {
	const session = {};
	const hook = (hook_event_name, more) => noteHook(session, { hook_event_name, permission_mode: 'plan', ...more });

	hook('UserPromptSubmit');
	hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'one' });
	hook('PreToolUse', { tool_name: 'Task', tool_use_id: 'two', tool_input: { description: 'Find the cookie code' } });
	hook('PostToolUse', { tool_name: 'Agent', tool_use_id: 'one' });
	hook('PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 'three' });
	hook('PostToolUse', {
		tool_name: 'TodoWrite',
		tool_input: {
			todos: [
				{ status: 'completed', content: 'Read it' },
				{ status: 'in_progress', content: 'Fix it', activeForm: 'Fixing it' },
			],
		},
	});

	expect(instrumentsOf(session)).toMatchObject({
		faults: 1,
		agents: 1,
		subagents: ['Find the cookie code'],
		mode: 'plan',
		todos: [
			{ status: 'completed', text: 'Read it' },
			{ status: 'in_progress', text: 'Fixing it' },
		],
	});
	expect(instrumentsOf(session).turnAge).toBeGreaterThanOrEqual(0);

	hook('Stop');
	expect(instrumentsOf(session)).toMatchObject({ agents: 0, subagents: undefined, turnAge: undefined, faults: 1 });
});

test("each facility's uses in the last ten minutes, and how many failed", async () => {
	const session = {};

	await noteTool(session, 'Read');
	await noteTool(session, 'Grep');
	await noteTool(session, 'Bash', true);
	await noteTool(session, 'mcp__github__search');

	expect(usageOf()).toMatchObject({
		library: { uses: 2, failures: 0 },
		reactor: { uses: 1, failures: 1 },
		'mcp:github': { uses: 1, failures: 0 },
	});
	expect(usageOf(Date.now() + 11 * 60_000)).toEqual({});
});

test("each facility's log says what its latest uses were used on, newest first", async () => {
	const session = { id: 's1', cwd: '/home/me/app' };

	await noteTool(session, 'Edit', false, { file_path: '/home/me/app/server/auth.js', old_string: 'a' });
	await noteTool(session, 'Bash', true, { command: 'bun test\nexit 1' });
	await noteTool(session, 'Edit', false, { file_path: '/home/me/app/README.md' });

	const log = logOf();

	expect(log.forge.slice(0, 2)).toMatchObject([
		{ tool: 'Edit', session: 's1', detail: 'README.md', failed: false },
		{ tool: 'Edit', session: 's1', detail: 'server/auth.js', failed: false },
	]);
	expect(log.reactor[0]).toMatchObject({ tool: 'Bash', detail: 'bun test', failed: true });
	expect(logOf(Date.now() + 11 * 60_000)).toEqual({});
});

test('a look kept from before is still an answer on its way, as one worked out now is', async () => {
	const { coldAt } = await import('./universe');
	const stopped = Date.now() - 60_000;

	await coldAt('kept-twice', '/nowhere', stopped);
	expect(coldAt('kept-twice', '/nowhere', stopped)).toBeInstanceOf(Promise);
});

test('whoever looks at the universe is aboard, once, attached to a session or not', async () => {
	const { withViewer } = await import('./universe');
	const watcher = { inviteId: 'abc', role: 'watch', name: 'Sam' };
	const alone = await withViewer([], watcher);

	expect(alone).toEqual([{ key: expect.any(String), name: 'Sam', role: 'watch', sessions: [] }]);
	expect(await withViewer([{ ...alone[0], sessions: ['one'] }], watcher)).toHaveLength(1);
	expect(await withViewer([], null)).toEqual([]);
});
