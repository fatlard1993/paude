import { credentialValid } from './auth';

// A share shown in a frame on another paude's page. That page is another site, and the browser sends a frame on it none
// of this paude's cookies: the login cookie is SameSite=Strict, and the share cookie Lax. So the frame comes with a
// ticket instead, asked for by whoever may see the share (the other paude, on its login here): one use, a minute to use
// it, for one share. The preview trades it for a cookie of its own that a frame may send (SameSite=None, partitioned
// to the page framing it), good for that share's preview alone and never for paude's API, and only while the login
// that asked for the ticket is still good.

/** The query parameter a frame's ticket rides in: the preview takes it off before the app sees the request */
export const FRAME_TICKET = 'paude-frame';

const TICKET_MS = 60_000;
const GRANT_MS = 12 * 60 * 60 * 1000;

const tickets = new Map();
const grants = new Map();

const token = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

const sweep = (map, now = Date.now()) => {
	for (const [key, { expires }] of map) if (expires < now) map.delete(key);
};

/** The cookie a frame's grant for a share goes by */
export const frameCookieName = shareName => `paude-frame-${shareName}`;

/**
 * A ticket for a frame to open a share with, for someone logged in here (their credential, as credentialOf gives it)
 * @param {string} shareName - The share
 * @param {string} credential - Who asked
 * @returns {string} The ticket
 */
export const issueFrameTicket = (shareName, credential) => {
	sweep(tickets);

	const ticket = token();

	tickets.set(ticket, { shareName, credential, expires: Date.now() + TICKET_MS });

	return ticket;
};

/**
 * A ticket used: gone, and if it was good and for this share, a grant for the frame to keep. Null otherwise.
 * @param {string} ticket - What the frame brought
 * @param {string} shareName - The share it was opened at
 * @returns {{ grant: string, seconds: number } | null} The grant's token and how long it lasts
 */
export const redeemFrameTicket = (ticket, shareName) => {
	const found = tickets.get(ticket);

	tickets.delete(ticket);
	if (!found || found.expires < Date.now() || found.shareName !== shareName || !credentialValid(found.credential))
		return null;
	sweep(grants);

	const grant = token();

	grants.set(grant, { shareName, credential: found.credential, expires: Date.now() + GRANT_MS, at: Date.now() });

	return { grant, seconds: GRANT_MS / 1000 };
};

/**
 * What a frame's grant is good for: { shareName, credential, at }, or null when it's unknown, spent, or the login that
 * asked for it has ended
 * @param {string} grant - The cookie's value
 * @returns {{ shareName: string, credential: string, at: number } | null} The grant
 */
export const frameGrant = grant => {
	const found = grant && grants.get(grant);

	if (!found) return null;
	if (found.expires < Date.now() || !credentialValid(found.credential)) {
		grants.delete(grant);

		return null;
	}

	return found;
};

/** Forget every ticket and grant: for tests */
export const clearFrameTickets = () => {
	tickets.clear();
	grants.clear();
};
