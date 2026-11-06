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

test('shares are reached beside where the viewer reached paude: the listener directly, else the port in front', () => {
	const direct = request('http://localhost:8044/api/x', { host: 'localhost:8044' });
	const forwarded = host => ({ 'x-forwarded-proto': 'https', 'x-forwarded-host': host, 'x-forwarded-for': '10.0.0.2' });
	const on443 = request('http://127.0.0.1:8044/api/x', forwarded('workbook.local'));
	const onOwnPort = request('http://127.0.0.1:8044/api/x', forwarded('workbook.local:9443'));
	const options = settings => ({ listenerPort: 8045, settings });
	const tailnet = { publicUrl: 'https://workbook.tail1234.ts.net' };

	expect(previewOrigin(direct, options({}))).toBe('http://localhost:8045');
	expect(previewOrigin(direct, options(tailnet))).toBe('http://localhost:8045');
	expect(previewOrigin(on443, options({}))).toBe('https://workbook.local:8444');
	expect(previewOrigin(on443, options({ previewPort: 9444 }))).toBe('https://workbook.local:9444');
	// A LAN viewer keeps LAN links even when the server has a tailnet address; the tailnet viewer gets tailnet ones
	expect(previewOrigin(on443, options(tailnet))).toBe('https://workbook.local:8444');
	expect(previewOrigin(onOwnPort, options(tailnet))).toBe('https://workbook.local:9444');
	expect(
		previewOrigin(request('http://127.0.0.1:8044/api/x', forwarded('workbook.tail1234.ts.net')), options(tailnet)),
	).toBe('https://workbook.tail1234.ts.net:8444');
});
