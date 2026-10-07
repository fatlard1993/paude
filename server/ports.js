import { readdir, readFile, readlink } from 'fs/promises';

// What each session's processes listen on. Everything a session starts (Claude, what Claude runs, the side terminal)
// carries PAUDE_SESSION in its environment, so its processes are found by that rather than by walking a process tree
// a holder (dtach) breaks. Resolves to Map(sessionId → [{ port, host, pid, command }]), Claude's own listeners left out.
const MARK = /(?:^|\0| )PAUDE_SESSION=([\w-]+)/;
// Claude Code opens ports of its own (for an editor to connect to); those aren't the session's services
const OWN = new Set(['claude']);
const LISTEN = '0A';

const add = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);

// The address to reach a listener at: anything bound to every address is reached on loopback
const reachAt = address => {
	if (['0.0.0.0', '::', '*', '127.0.0.1', '::ffff:127.0.0.1'].includes(address)) return '127.0.0.1';

	return address === '::1' ? '[::1]' : null;
};

// /proc/net/tcp's addresses are hex, little-endian per 32 bits
const hexAddress = hex => {
	if (hex.length === 8)
		return hex
			.match(/../g)
			.reverse()
			.map(byte => parseInt(byte, 16))
			.join('.');
	if (/^0+$/.test(hex)) return '::';
	if (hex === '00000000000000000000000001000000') return '::1';
	if (hex.startsWith('0000000000000000FFFF0000')) return `::ffff:${hexAddress(hex.slice(24))}`;

	return 'other';
};

const linuxListeners = async () => {
	const sockets = new Map();

	for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
		const rows = (await readFile(table, 'utf8').catch(() => '')).split('\n').slice(1);

		for (const row of rows) {
			const fields = row.trim().split(/\s+/);

			if (fields[3] !== LISTEN) continue;

			const [address, port] = fields[1].split(':');

			sockets.set(fields[9], { port: parseInt(port, 16), host: reachAt(hexAddress(address)) });
		}
	}

	const found = new Map();
	const pids = (await readdir('/proc').catch(() => [])).filter(name => /^\d+$/.test(name));

	await Promise.all(
		pids.map(async pid => {
			const session = MARK.exec(await readFile(`/proc/${pid}/environ`, 'latin1').catch(() => ''))?.[1];

			if (!session) return;

			const command = (await readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '')).trim();

			if (OWN.has(command)) return;

			for (const fd of await readdir(`/proc/${pid}/fd`).catch(() => [])) {
				const inode = /^socket:\[(\d+)\]$/.exec(await readlink(`/proc/${pid}/fd/${fd}`).catch(() => ''))?.[1];
				const socket = inode && sockets.get(inode);

				if (socket?.host) add(found, session, { ...socket, pid: Number(pid), command });
			}
		}),
	);

	return found;
};

const output = args => {
	const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'ignore' });

	return result.exitCode === 0 ? result.stdout.toString() : '';
};

// macOS: ps shows each process's environment after its command (-E), and lsof its listening sockets
const macListeners = async () => {
	const sessions = new Map();

	for (const line of output(['ps', '-A', '-E', '-ww', '-o', 'pid=,comm=,command=']).split('\n')) {
		const [, pid, comm] = /^\s*(\d+)\s+(\S+)/.exec(line) ?? [];
		const session = MARK.exec(line)?.[1];

		if (pid && session && !OWN.has(comm.split('/').at(-1)))
			sessions.set(pid, { session, command: comm.split('/').at(-1) });
	}

	const found = new Map();

	if (!sessions.size) return found;

	let pid = null;

	for (const line of output([
		'lsof',
		'-nP',
		'-a',
		'-iTCP',
		'-sTCP:LISTEN',
		'-p',
		[...sessions.keys()].join(','),
		'-F',
		'pn',
	]).split('\n')) {
		if (line.startsWith('p')) pid = line.slice(1);
		else if (line.startsWith('n') && sessions.has(pid)) {
			const [, address, port] = /^(.*):(\d+)$/.exec(line.slice(1)) ?? [];
			const host = reachAt(address?.replace(/^\[|\]$/g, ''));

			if (host)
				add(found, sessions.get(pid).session, {
					port: Number(port),
					host,
					pid: Number(pid),
					command: sessions.get(pid).command,
				});
		}
	}

	return found;
};

// One listener per port, whichever address it's on
const deduplicated = found =>
	new Map(
		[...found].map(([session, listeners]) => [
			session,
			[...new Map(listeners.map(listener => [listener.port, listener])).values()].sort((a, b) => a.port - b.port),
		]),
	);

export const sessionListeners = async () =>
	deduplicated(process.platform === 'darwin' ? await macListeners() : await linuxListeners());

// Every process a session runs, for the Tasks panel: [{ pid, session, task, command, args, cpuSeconds, memoryBytes,
// startedAt, own }], `task` naming the run that started it, and `own` marking Claude itself
const TASK_MARK = /(?:^|\0| )PAUDE_TASK=([\w-]+)/;
const CLOCK_TICKS = 100;
const PAGE_BYTES = 4096;

const linuxProcesses = async () => {
	const uptime = Number((await readFile('/proc/uptime', 'utf8').catch(() => '0')).split(' ')[0]);
	const bootedAt = Date.now() - uptime * 1000;
	const pids = (await readdir('/proc').catch(() => [])).filter(name => /^\d+$/.test(name));
	const found = await Promise.all(
		pids.map(async pid => {
			const environment = await readFile(`/proc/${pid}/environ`, 'latin1').catch(() => '');
			const session = MARK.exec(environment)?.[1];

			if (!session) return null;

			const [command, cmdline, stat, statm] = await Promise.all([
				readFile(`/proc/${pid}/comm`, 'utf8').catch(() => ''),
				readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => ''),
				readFile(`/proc/${pid}/stat`, 'utf8').catch(() => ''),
				readFile(`/proc/${pid}/statm`, 'utf8').catch(() => ''),
			]);
			// The fields after the command, which is in parentheses and may hold spaces
			const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');

			return {
				pid: Number(pid),
				session,
				task: TASK_MARK.exec(environment)?.[1] ?? null,
				command: command.trim(),
				args: cmdline.split('\0').filter(Boolean).join(' ').slice(0, 300),
				cpuSeconds: (Number(fields[11]) + Number(fields[12])) / CLOCK_TICKS,
				memoryBytes: Number(statm.split(' ')[1]) * PAGE_BYTES,
				startedAt: bootedAt + (Number(fields[19]) / CLOCK_TICKS) * 1000,
				own: OWN.has(command.trim()),
			};
		}),
	);

	return found.filter(Boolean);
};

// ps's cpu time ([[dd-]hh:]mm:ss.cc) as seconds
const seconds = time =>
	time
		.replace('-', ':')
		.split(':')
		.reverse()
		.reduce((total, part, index) => total + Number(part) * [1, 60, 3600, 86400][index], 0);

const macProcesses = async () =>
	output(['ps', '-A', '-E', '-ww', '-o', 'pid=,time=,rss=,etime=,comm=,command='])
		.split('\n')
		.flatMap(line => {
			const [, pid, time, rss, elapsed, comm] = /^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)/.exec(line) ?? [];
			const session = MARK.exec(line)?.[1];

			if (!pid || !session) return [];

			const command = comm.split('/').at(-1);

			return [
				{
					pid: Number(pid),
					session,
					task: TASK_MARK.exec(line)?.[1] ?? null,
					command,
					args: command,
					cpuSeconds: seconds(time),
					memoryBytes: Number(rss) * 1024,
					startedAt: Date.now() - seconds(elapsed) * 1000,
					own: OWN.has(command),
				},
			];
		});

export const sessionProcesses = async () => (process.platform === 'darwin' ? macProcesses() : linuxProcesses());
