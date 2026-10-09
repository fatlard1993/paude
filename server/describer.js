import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import askHaiku, { jsonIn } from './haiku';

const BATCH = 20;
// A batch Haiku couldn't answer waits this long before it's asked again
const RETRY_MS = 60 * 60 * 1000;

// Haiku's reply as { [number]: description }: a JSON object, perhaps fenced or with words around it
export const parseDescriptions = reply =>
	Object.fromEntries(Object.entries(jsonIn(reply) ?? {}).filter(([, text]) => typeof text === 'string' && text.trim()));

// Short descriptions Haiku writes for things that came up in sessions (links, artifacts): once per thing, kept by its
// key in `<dataDir>/<fileName>`. Asked in the background, a batch at a time, the soonest first, while the panel shows
// what it has. promptFor(batch) numbers the batch from 1; describable(item) says whether there's anything to go on.
const describer = ({ fileName, keyOf, promptFor, sooner, describable = () => true }) => {
	let file;
	let descriptions = {};
	const queue = new Map();
	const failedAt = new Map();
	let working = false;

	const work = async () => {
		if (working) return;
		working = true;
		try {
			while (queue.size) {
				const batch = [...queue.values()].sort(sooner).slice(0, BATCH);
				const written = parseDescriptions(await askHaiku(await promptFor(batch)));

				// No answer at all (not logged in, out of usage): the rest wait their hour too, rather than each failing
				if (!Object.keys(written).length) {
					for (const key of queue.keys()) failedAt.set(key, Date.now());
					queue.clear();
					break;
				}

				batch.forEach((item, index) => {
					const text = written[String(index + 1)];

					if (text) descriptions[keyOf(item)] = text.trim().replace(/\.$/, '');
					else failedAt.set(keyOf(item), Date.now());
					queue.delete(keyOf(item));
				});
				await writeJsonFile(file, () => descriptions);
			}
		} finally {
			working = false;
		}
	};

	return {
		init: async dataDir => {
			file = path.join(dataDir, fileName);
			descriptions = await readJsonFile(file, {});
		},
		descriptionOf: key => descriptions[key],
		describingOf: key => queue.has(key),
		// Those not described yet, asked for in the background
		describe: items => {
			if (!file) return;
			for (const item of items) {
				const key = keyOf(item);

				if (descriptions[key] || queue.has(key) || !describable(item)) continue;
				if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS) continue;
				queue.set(key, item);
			}
			if (queue.size) work();
		},
	};
};

export default describer;
