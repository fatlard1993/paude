import { mkdirSync, openSync, closeSync, rmSync, statSync } from 'fs';
import { chmod, rename } from 'fs/promises';
import path from 'path';

const WAIT_MS = 5000;
const STALE_MS = 10_000;

const acquire = async lock => {
	const deadline = Date.now() + WAIT_MS;

	for (;;) {
		try {
			closeSync(openSync(lock, 'wx', 0o600));

			return;
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
		}

		// A lock left by a process that died is cleared once it's clearly abandoned
		try {
			if (Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock, { force: true });
		} catch {
			// Released between the two checks
		}

		if (Date.now() > deadline) throw new Error(`${lock} is held by another paude command`);
		await Bun.sleep(25);
	}
};

// Reads, changes and writes a JSON file under a lock file, so separate processes (two paude commands at once) can't
// lose each other's changes. `change` gets the current contents (or `fallback`) and returns the new ones.
const updateJsonFile = async (file, fallback, change) => {
	const lock = `${file}.lock`;

	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	await acquire(lock);

	try {
		const stored = Bun.file(file);
		const current = (await stored.exists()) ? await stored.json() : structuredClone(fallback);
		const next = await change(current);
		const temporary = `${file}.${crypto.randomUUID()}.tmp`;

		await Bun.write(temporary, JSON.stringify(next, null, '\t'));
		await chmod(temporary, 0o600);
		await rename(temporary, file);

		return next;
	} finally {
		rmSync(lock, { force: true });
	}
};

export default updateJsonFile;
