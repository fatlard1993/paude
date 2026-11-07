import { expect, test } from 'bun:test';

import { parseStatus, previewPortFlag, tailnetDetail } from './tailscale';

const status = (state, name) => JSON.stringify({ BackendState: state, Self: { DNSName: name } });

test('this machine on its tailnet reads from tailscale status, trailing dot dropped', () => {
	expect(parseStatus(status('Running', 'workbook.tail1234.ts.net.'))).toEqual({
		name: 'workbook.tail1234.ts.net',
		running: true,
	});
	expect(parseStatus(status('Stopped', 'workbook.tail1234.ts.net.'))).toEqual({
		name: 'workbook.tail1234.ts.net',
		running: false,
	});
	expect(parseStatus(status('NeedsLogin', ''))).toBeNull();
	expect(parseStatus('not json')).toBeNull();
});

test('the doctor says what to do at each step from no tailscale to serving', () => {
	const tailnet = { installed: true, name: 'workbook.tail1234.ts.net', running: true };

	expect(tailnetDetail(null)).toMatch(/install it/);
	expect(tailnetDetail({ installed: true })).toMatch(/tailscale up/);
	expect(tailnetDetail({ ...tailnet, running: false })).toMatch(/not connected: tailscale up/);
	expect(tailnetDetail(tailnet, undefined)).toBe(
		'paude tailscale puts this paude at https://workbook.tail1234.ts.net, with HTTPS',
	);
	expect(tailnetDetail(tailnet, 'https://workbook.tail1234.ts.net')).toBe(
		'serving this paude at https://workbook.tail1234.ts.net',
	);
});

test('the share port is 8444 unless --preview-port names another, which may not be 443', () => {
	expect(previewPortFlag([])).toBe(8444);
	expect(previewPortFlag(['--preview-port', '8443'])).toBe(8443);
	expect(previewPortFlag(['--preview-port', '443'])).toBeNaN();
	expect(previewPortFlag(['--preview-port', 'lots'])).toBeNaN();
	expect(previewPortFlag(['--preview-port'])).toBeNaN();
});
