import { mkdir } from 'fs/promises';
import path from 'path';

// Files dropped or pasted into a session, kept outside its project so they never show up as changes; Claude is
// handed the path and reads it from there
export const MAX_ATTACHMENT = 25 * 1024 * 1024;

let folder;

export const initAttachments = dataDir => {
	folder = path.join(dataDir, 'attachments');
};

const safeName = name =>
	path
		.basename(name || 'pasted')
		.replace(/[^\w.-]+/g, '-')
		.replace(/^[-.]+/, '')
		.slice(-80) || 'pasted';

export const saveAttachment = async (sessionId, name, bytes) => {
	const directory = path.join(folder, safeName(sessionId));
	const file = path.join(directory, `${Date.now().toString(36)}-${safeName(name)}`);

	await mkdir(directory, { recursive: true });
	await Bun.write(file, bytes);

	return file;
};
