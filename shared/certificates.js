import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { rootCertificates } from 'tls';

// Certificate authorities paude trusts besides the usual ones, in one PEM file: a paude on the local network behind
// Caddy's own authority (tls internal) has a certificate nothing else vouches for
export const certificatesFile = path.join(
	process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
	'paude',
	'certificates.pem',
);

const read = () => {
	try {
		return readFileSync(certificatesFile, 'utf8');
	} catch {
		return null;
	}
};

// For fetch's tls option, read each time so a new one needs no restart; undefined when there are none
export const trustedCertificates = () => {
	const extra = read();

	return extra ? { ca: [...rootCertificates, extra] } : undefined;
};

// Bun takes NODE_EXTRA_CA_CERTS for every connection, but only from the environment it started in; true when this
// process should start again with it
export const needsRestartForCertificates = () =>
	process.env.NODE_EXTRA_CA_CERTS !== certificatesFile && read() !== null;
