import { Page, Router } from '@vanilla-bean/components';

import Home from './Home';
import { setIdentity } from './identity';
import Login from './Login';
import { recall, remember } from './storage';
import { registerNotificationWorker } from './notify';
import Project from './Project';
import TerminalView from './Terminal/TerminalView';
import { startWatchAlerts } from './watchAlerts';

import './hotReload';

// A login that expires mid-visit (30 days, a sign-out elsewhere, a new password) sends every API call a 401;
// reloading lands on the login page instead of a screen that looks empty
const nativeFetch = window.fetch.bind(window);
const LOGIN_ROUTES = ['/api/auth', '/api/login', '/api/tokens', '/api/join'];

window.fetch = async (input, init) => {
	const response = await nativeFetch(input, init);
	const { pathname } = new URL(typeof input === 'string' ? input : input.url, window.location.href);

	if (response.status === 401 && pathname.startsWith('/api/') && !LOGIN_ROUTES.includes(pathname))
		window.location.reload();

	return response;
};

// An invite link (#/join/<token>) logs its guest in and opens the session it was made for
const joinToken = window.location.hash.match(/^#\/join\/(.+)$/)?.[1];
let joinFailed = false;
const GUEST_KEY = 'paude.guest';

if (joinToken) {
	const response = await fetch('/api/join', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ token: joinToken }),
	});

	if (response.ok) {
		remember(GUEST_KEY, 'yes');
		window.location.replace(`#/sessions/${(await response.json()).sessionId}`);
	} else joinFailed = true;
}

// A one-time link, optionally naming where to land: #/handoff/<code> or #/handoff/<code>/sessions/<id>
const [, handoffCode, handoffTo] = window.location.hash.match(/^#\/handoff\/([^/]+)(\/sessions\/[^/]+)?$/) ?? [];

if (handoffCode) {
	// An expired code just leaves the login page showing
	await fetch('/api/handoff/redeem', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ code: handoffCode }),
	});

	window.location.replace(`#${handoffTo ?? '/'}`);
}

const { authenticated, passwordSet, identity } = await (await fetch('/api/auth')).json();

setIdentity(identity);

if (authenticated) {
	registerNotificationWorker();
	startWatchAlerts(identity);
}

const content = () => {
	// A browser that came in by invite and is now logged out had its invite end, not a password to type
	if (!authenticated) return new Login({ passwordSet, inviteEnded: joinFailed || recall(GUEST_KEY) === 'yes' });
	if (identity.owner) remember(GUEST_KEY, '');

	// A guest has exactly one session and nowhere else to go
	if (!identity.owner) return new TerminalView({ id: identity.sessionId });

	return new Router({
		views: { '/': Home, '/projects/:project': Project, '/sessions/:id': TerminalView },
		defaultPath: '/',
	});
};

new Page({ appendTo: document.body, append: content() });
