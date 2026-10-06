import { chmod, mkdir, rename } from 'fs/promises';
import path from 'path';

const queues = new Map();

// Saves to one file run one at a time, each through its own temp file, so overlapping saves can't collide
// mid-rename. The data is serialized when its turn comes, so a queued save writes the latest state.
const writeJsonFile = (file, read) => {
	const previous = queues.get(file) ?? Promise.resolve();
	const next = previous
		.catch(() => {})
		.then(async () => {
			const temporary = `${file}.${crypto.randomUUID()}.tmp`;

			await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
			await Bun.write(temporary, JSON.stringify(read(), null, '\t'));
			await chmod(temporary, 0o600);
			await rename(temporary, file);
		});

	queues.set(file, next);

	return next;
};

export default writeJsonFile;
