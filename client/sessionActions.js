import { Notify } from '@vanilla-bean/components';

import { archiveSessions, deleteSession, nameSession, setWatching } from './api';
import confirmDialog, { confirmDeleteSession, nameDialog } from './confirmDialog';
import { copyWithNotice } from './Terminal/copySelection';

const UNDO_MS = 8000;

const counted = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const named = sessions => (sessions.length === 1 ? `"${sessions[0].title}"` : counted(sessions.length, 'session'));

const failed = what => new Notify({ type: 'error', content: `Could not ${what}.` });

const archive = async (sessions, archived, changed, { undoing = false } = {}) => {
	const ids = sessions.map(({ id }) => id);
	const { response } = await archiveSessions(ids, archived);

	if (!response?.ok) return failed(archived ? 'archive it' : 'bring it back');

	changed();
	if (undoing) return;

	new Notify({
		type: 'success',
		timeout: UNDO_MS,
		content: `${archived ? 'Archived' : 'Unarchived'} ${named(sessions)}`,
		actions: [{ textContent: 'Undo', onPress: () => archive(sessions, !archived, changed, { undoing: true }) }],
	});
};

const watch = async (sessions, watching, changed) => {
	const answers = await Promise.all(sessions.map(({ id }) => setWatching(id, watching)));

	if (answers.some(({ response }) => !response?.ok)) failed('change watching');
	changed();
};

const rename = async (session, changed) => {
	const name = await nameDialog({ current: session.title, pinned: true });

	if (name === null) return;

	const { response } = await nameSession(session.id, name);

	if (!response?.ok) return failed('rename it');
	changed();
};

// Running ones are in use: archiving waits for them to stop, so it isn't offered
const archivable = sessions => sessions.filter(({ live }) => !live);

// What one of this server's sessions offers from a list: `changed()` redraws the list after
export const sessionMenu = (session, changed) => [
	{
		label: session.watching ? 'Stop watching' : 'Watch',
		detail: session.watching ? '' : 'Show whether it works, waits or is ready, and what happened since you looked',
		onPress: () => watch([session], !session.watching, changed),
	},
	{ label: 'Rename...', onPress: () => rename(session, changed) },
	...(session.live
		? []
		: [
				{
					label: session.archived ? 'Unarchive' : 'Archive',
					detail: session.archived ? '' : 'Out of the lists; search and the Archived filter still find it',
					onPress: () => archive([session], !session.archived, changed),
				},
			]),
	{
		label: 'Copy link',
		onPress: () => copyWithNotice(`${location.origin}${location.pathname}#/sessions/${session.id}`, 'Link copied'),
	},
	{
		label: 'Delete...',
		onPress: async () => (await confirmDeleteSession(session, deleteSession)) && changed(),
	},
];

// What several picked sessions offer together
export const bulkActions = (sessions, changed) => {
	const stopped = archivable(sessions);
	const unarchived = stopped.filter(({ archived }) => !archived);
	const archived = stopped.filter(({ archived: put }) => put);

	return [
		...(unarchived.length
			? [
					{
						label: `Archive ${unarchived.length}`,
						title: unarchived.length < sessions.length ? "Running ones aren't archived: they're in use" : '',
						onPress: () => archive(unarchived, true, changed),
					},
				]
			: []),
		...(archived.length
			? [{ label: `Unarchive ${archived.length}`, onPress: () => archive(archived, false, changed) }]
			: []),
		{ label: 'Watch', onPress: () => watch(sessions, true, changed) },
		{ label: 'Stop watching', onPress: () => watch(sessions, false, changed) },
		{
			label: `Delete ${sessions.length}...`,
			danger: true,
			onPress: async () => {
				const sure = await confirmDialog({
					header: `Delete ${named(sessions)}?`,
					body: 'Their conversations, chat and comments are removed, and anyone invited loses access. This cannot be undone.',
					confirmLabel: 'Delete',
				});

				if (!sure) return;

				const answers = await Promise.all(sessions.map(({ id }) => deleteSession(id)));
				const gone = answers.filter(({ response }) => response?.ok).length;

				if (gone < sessions.length) failed(`delete ${sessions.length - gone} of them`);
				changed();
			},
		},
	];
};
