import { watch } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';

import writeJsonFile from '../shared/writeJsonFile';

const LOGIN_DAYS = 30;
const LOGIN_MS = LOGIN_DAYS * 24 * 60 * 60 * 1000;
const COOKIE = 'paude_login';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 60_000;
// Misses older than this stop counting against an address
const FORGIVE_MS = 24 * 60 * 60 * 1000;
// argon2 is deliberately slow; more parallel checks than this get a 429 instead of a turn
const MAX_CONCURRENT_CHECKS = 2;

let file;
let lastWritten = null;
const EMPTY = { passwordHash: null, logins: [], tokens: [], invites: [] };

let state = structuredClone(EMPTY);
const failures = new Map();
let checking = 0;

const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

// Only hashes are stored, so a copy of the file doesn't log anyone in
const digest = token => new Bun.CryptoHasher('sha256').update(token).digest('hex');

const save = () =>
	writeJsonFile(file, () => {
		lastWritten = JSON.stringify(state, null, '\t');

		return state;
	});

const load = async () => {
	const stored = Bun.file(file);

	if (!(await stored.exists())) return;

	const text = await stored.text();

	// Our own save coming back through the watcher; reloading it could drop a change made since
	if (text === lastWritten) return;

	state = { ...structuredClone(EMPTY), ...JSON.parse(text) };
	state.logins = state.logins.filter(login => login.expires > Date.now());
	state.invites = state.invites.filter(invite => invite.expires > Date.now());
};

// The server watches the file so a password set from the command line (scripts/set-password.js) takes effect,
// and its sign-outs hold, without a restart
export const initAuth = async (dataDir, { watchForChanges = false } = {}) => {
	await mkdir(dataDir, { recursive: true, mode: 0o700 });

	file = path.join(dataDir, 'auth.json');
	await load();

	if (!watchForChanges) return;

	let reload;

	watch(dataDir, (event, name) => {
		if (name !== 'auth.json') return;

		clearTimeout(reload);
		reload = setTimeout(() => load().catch(error => console.error('Could not reload auth.json', error)), 50);
	});
};

export const passwordIsSet = () => Boolean(state.passwordHash);

export const setPassword = async password => {
	state.passwordHash = await Bun.password.hash(password, 'argon2id');
	state.logins = [];
	state.tokens = [];
	state.invites = [];
	await save();
};

// Behind Caddy the first X-Forwarded-For entry is the client. IPv6 clients usually hold a whole /64, so that's
// what gets locked out.
const clientKey = request => {
	const address = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';

	return address.includes(':') ? address.split(':').slice(0, 4).join(':') : address;
};

// A damaged hash in auth.json reads as a wrong password rather than an error on every login
const verify = async password => {
	try {
		return await Bun.password.verify(password, state.passwordHash);
	} catch (error) {
		console.error('The stored password hash could not be checked', error.message);

		return false;
	}
};

// Resolves true or false, or a number of seconds to wait before trying again
export const checkPassword = async (request, password) => {
	const key = clientKey(request);
	const now = Date.now();
	const known = failures.get(key);
	const record = known && now - known.last < FORGIVE_MS ? known : { count: 0, until: 0, last: 0 };

	if (record.until > now) return Math.ceil((record.until - now) / 1000);
	if (checking >= MAX_CONCURRENT_CHECKS) return 1;

	// Counted before the slow check, so a burst of parallel guesses can't all slip in under one count
	record.count += 1;
	record.last = now;
	if (record.count >= MAX_FAILURES) record.until = now + LOCKOUT_MS * 2 ** (record.count - MAX_FAILURES);
	failures.set(key, record);

	checking += 1;

	try {
		const valid = Boolean(state.passwordHash && typeof password === 'string' && password) && (await verify(password));

		if (valid) failures.delete(key);

		return valid;
	} finally {
		checking -= 1;
	}
};

const liveInvite = id => state.invites.find(invite => invite.id === id && invite.expires > Date.now());

// A guest's login lasts as long as the invite it came from
export const createLogin = async ({ invite } = {}) => {
	const token = randomToken();

	state.logins.push({
		hash: digest(token),
		expires: invite ? invite.expires : Date.now() + LOGIN_MS,
		...(invite && { invite: invite.id }),
	});
	await save();

	return token;
};

export const loginCookie = (token, { clear = false } = {}) =>
	`${COOKIE}=${clear ? '' : token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : LOGIN_MS / 1000}`;

export const createToken = async (name, { invite } = {}) => {
	const token = randomToken();

	state.tokens.push({
		id: randomToken().slice(0, 8),
		name,
		hash: digest(token),
		created: Date.now(),
		...(invite && { invite: invite.id }),
	});
	await save();

	return token;
};

const cookieToken = request => request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];

const bearerToken = request => request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];

// A credential is the stored hash a request authenticated with, kept so a long-lived socket can be re-checked
// after a logout, a revoked token or a new password
const credentialRecord = credential => {
	if (typeof credential !== 'string') return null;

	const [kind, hash] = credential.split(':');
	const record =
		kind === 'login'
			? state.logins.find(login => login.hash === hash && login.expires > Date.now())
			: kind === 'token' && state.tokens.find(token => token.hash === hash);

	// A revoked or expired invite takes its logins and tokens with it
	if (!record || (record.invite && !liveInvite(record.invite))) return null;

	return record;
};

export const credentialValid = credential => credentialRecord(credential) !== null;

// Who a credential belongs to: the owner, or the guest an invite names, with their role and session
export const identityOf = credential => {
	const record = credentialRecord(credential);

	if (!record) return null;
	if (!record.invite) return { owner: true };

	const { id, name, role, sessionId } = liveInvite(record.invite);

	return { owner: false, inviteId: id, name, role, sessionId };
};

export const credentialOf = request => {
	const fromCookie = cookieToken(request);

	if (fromCookie && credentialValid(`login:${digest(fromCookie)}`)) return `login:${digest(fromCookie)}`;

	const fromBearer = bearerToken(request);

	if (fromBearer && credentialValid(`token:${digest(fromBearer)}`)) return `token:${digest(fromBearer)}`;

	return null;
};

export const isAuthenticated = request => credentialOf(request) !== null;

export const endLogin = async request => {
	const token = cookieToken(request);

	if (!token) return;

	const hash = digest(token);

	state.logins = state.logins.filter(login => login.hash !== hash);
	await save();
};

export const revokeToken = async request => {
	const token = bearerToken(request);

	if (!token) return false;

	const hash = digest(token);
	const before = state.tokens.length;

	state.tokens = state.tokens.filter(stored => stored.hash !== hash);
	await save();

	return state.tokens.length < before;
};

export const createInvite = async ({ sessionId, name, role, hours }) => {
	const token = randomToken();
	const invite = {
		id: randomToken().slice(0, 10),
		name,
		role,
		sessionId,
		hash: digest(token),
		created: Date.now(),
		expires: Date.now() + hours * 60 * 60 * 1000,
	};

	state.invites.push(invite);
	await save();

	return { invite, token };
};

export const inviteFromToken = token =>
	typeof token === 'string'
		? state.invites.find(invite => invite.hash === digest(token) && invite.expires > Date.now())
		: null;

export const listInvites = sessionId =>
	state.invites
		.filter(invite => invite.sessionId === sessionId && invite.expires > Date.now())
		.map(({ id, name, role, expires }) => ({ id, name, role, expires }));

export const revokeInvite = async id => {
	const before = state.invites.length;

	state.invites = state.invites.filter(invite => invite.id !== id);
	state.logins = state.logins.filter(login => login.invite !== id);
	state.tokens = state.tokens.filter(token => token.invite !== id);
	await save();

	return state.invites.length < before;
};

export const revokeInvitesFor = async sessionId => {
	const ids = new Set(state.invites.filter(invite => invite.sessionId === sessionId).map(({ id }) => id));

	if (!ids.size) return;

	state.invites = state.invites.filter(invite => !ids.has(invite.id));
	state.logins = state.logins.filter(login => !ids.has(login.invite));
	state.tokens = state.tokens.filter(token => !ids.has(token.invite));
	await save();
};
