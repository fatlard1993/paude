import { expect, test } from 'bun:test';

import { cleanPublicUrl, previewOrigin, publicOrigin } from './publicOrigin';

const request = (url, headers = {}) => new Request(url, { headers });

test('a public address is https and the host alone', () => {
	expect(cleanPublicUrl('https://workbook.tail1234.ts.net')).toBe('https://workbook.tail1234.ts.net');
	expect(cleanPublicUrl(' https://workbook.tail1234.ts.net/ ')).toBe('https://workbook.tail1234.ts.net');
	expect(cleanPublicUrl('https://paude.example.com:8443')).toBe('https://paude.example.com:8443');
	expect(cleanPublicUrl('http://workbook.local')).toBeNull();
	expect(cleanPublicUrl('https://workbook.local/sessions')).toBeNull();
	expect(cleanPublicUrl('workbook.local')).toBeNull();
	expect(cleanPublicUrl(undefined)).toBeNull();
});

test('a link for someone else carries the public address over where the request came in', () => {
	const viaCaddy = request('http://127.0.0.1:8044/api/x', {
		'x-forwarded-proto': 'https',
		'x-forwarded-host': 'workbook.local',
		'x-forwarded-for': '192.168.1.20',
	});

	expect(publicOrigin(viaCaddy, {})).toBe('https://workbook.local');
	expect(publicOrigin(viaCaddy, { publicUrl: 'https://workbook.tail1234.ts.net' })).toBe(
		'https://workbook.tail1234.ts.net',
	);
	expect(publicOrigin(request('http://localhost:8044/api/x', { host: 'localhost:8044' }), {})).toBe(
		'http://localhost:8044',
	);
});

test('shares are reached on the preview listener directly, else on the preview port of the public address', () => {
	const direct = request('http://localhost:8044/api/x', { host: 'localhost:8044' });
	const viaProxy = request('http://127.0.0.1:8044/api/x', {
		'x-forwarded-proto': 'https',
		'x-forwarded-host': 'workbook.local',
		'x-forwarded-for': '192.168.1.20',
	});
	const options = settings => ({ listenerPort: 8045, settings });

	expect(previewOrigin(direct, options({}))).toBe('http://localhost:8045');
	expect(previewOrigin(direct, options({ publicUrl: 'https://workbook.tail1234.ts.net' }))).toBe(
		'http://localhost:8045',
	);
	expect(previewOrigin(viaProxy, options({}))).toBe('https://workbook.local:8444');
	expect(previewOrigin(viaProxy, options({ previewPort: 9444 }))).toBe('https://workbook.local:9444');
	expect(previewOrigin(viaProxy, options({ publicUrl: 'https://workbook.tail1234.ts.net' }))).toBe(
		'https://workbook.tail1234.ts.net:8444',
	);
});
