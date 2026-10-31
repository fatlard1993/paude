import { transcriptFile } from './sessions/transcript';

// What a session's conversation costs to carry, from the usage Claude Code records with each request in its
// transcript: how big the context is, whether Claude's prompt cache still holds it, what coming back to it cold costs,
// and what the session has spent so far. Costs are in base-input-token equivalents: what the tokens would cost as plain
// uncached input, at the API's published rates.
export const RATES = { input: 1, read: 0.1, write5m: 1.25, write1h: 2, output: 5 };
const TTL_MS = { '5m': 5 * 60 * 1000, '1h': 60 * 60 * 1000 };
// What's burned counts over a usage window's length, and its rate over the last few minutes
const WINDOW_MS = 5 * 60 * 60 * 1000;
const RATE_MS = 10 * 60 * 1000;

const fresh = () => ({
	offset: 0,
	carry: '',
	seen: new Set(),
	last: null,
	ttl: '1h',
	totals: { input: 0, read: 0, write5m: 0, write1h: 0, output: 0, requests: 0 },
	// Each request in the last usage window, when it was and what it cost
	recent: [],
});

// Per session, read so far: the transcript only grows, so each look reads what was added since the last
const meters = new Map();

// One request's usage, counted once: Claude Code writes a line per content block, each repeating the usage
export const countRequest = (meter, line) => {
	const usage = line.message?.usage;
	const id = line.message?.id;

	if (line.type !== 'assistant' || !usage || !id || meter.seen.has(id)) return;
	meter.seen.add(id);

	const write5m = usage.cache_creation?.ephemeral_5m_input_tokens;
	const write1h = usage.cache_creation?.ephemeral_1h_input_tokens;
	const written = usage.cache_creation_input_tokens ?? 0;
	const request = {
		input: usage.input_tokens ?? 0,
		read: usage.cache_read_input_tokens ?? 0,
		// Without the split, the conversation's own TTL says which it was
		write1h: write1h ?? (write5m === undefined && meter.ttl === '1h' ? written : 0),
		write5m: write5m ?? (write1h === undefined && meter.ttl === '5m' ? written : 0),
		output: usage.output_tokens ?? 0,
	};
	const at = Date.parse(line.timestamp);

	for (const kind of Object.keys(request)) meter.totals[kind] += request[kind];
	meter.totals.requests += 1;
	if (Date.now() - at < WINDOW_MS) meter.recent.push({ at, cost: spentOf(request) });
	meter.model = line.message.model ?? meter.model;
	if (write1h) meter.ttl = '1h';
	else if (write5m) meter.ttl = '5m';
	meter.last = {
		at,
		context: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + written,
	};
};

const readNew = async (id, cwd) => {
	const file = await transcriptFile(id, cwd);

	if (!file) return null;

	let meter = meters.get(id);

	// Rewritten shorter: counted again from the top
	if (!meter || file.size < meter.offset) meter = fresh();
	meters.set(id, meter);
	if (file.size === meter.offset) return meter;

	const text = meter.carry + (await file.slice(meter.offset, file.size).text());
	const lines = text.split('\n');

	meter.offset = file.size;
	meter.carry = lines.pop();
	for (const line of lines) {
		try {
			if (line.includes('"usage"')) countRequest(meter, JSON.parse(line));
		} catch {
			// A line cut short; whole lines are all that count
		}
	}

	return meter;
};

export const spentOf = totals =>
	Math.round(
		totals.input * RATES.input +
			totals.read * RATES.read +
			totals.write5m * RATES.write5m +
			totals.write1h * RATES.write1h +
			totals.output * RATES.output,
	);

// { context, lastAt, ttl, warmUntil, coldCost, hitRate, spent, requests, model } (null before Claude's first answer)
export const meterOf = async (id, cwd, now = Date.now()) => {
	const meter = await readNew(id, cwd);

	if (!meter?.last) return null;

	const { context, at } = meter.last;
	const { read, input, write5m, write1h, requests } = meter.totals;
	const warmUntil = at + TTL_MS[meter.ttl];

	return {
		context,
		lastAt: at,
		ttl: meter.ttl,
		warmUntil,
		warm: now < warmUntil,
		// Coming back once it's cold: the whole context written to the cache again
		coldCost: Math.round(context * (meter.ttl === '1h' ? RATES.write1h : RATES.write5m)),
		// A turn while it's warm: the context read from the cache
		warmCost: Math.round(context * RATES.read),
		hitRate: read + input + write5m + write1h ? read / (read + input + write5m + write1h) : 0,
		spent: spentOf(meter.totals),
		requests,
		model: meter.model,
	};
};

// What every conversation read here has burned over the last usage window, and how fast lately (per minute), in
// base-input-token equivalents. Only conversations read since this server started count, which the universe view
// does for every running session.
export const burnOf = (now = Date.now()) => {
	let burned = 0;
	let lately = 0;

	for (const meter of meters.values()) {
		meter.recent = meter.recent.filter(({ at }) => now - at < WINDOW_MS);
		for (const { at, cost } of meter.recent) {
			burned += cost;
			if (now - at < RATE_MS) lately += cost;
		}
	}

	return { burned, rate: Math.round(lately / (RATE_MS / 60_000)) };
};
