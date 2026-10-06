import { Page, Router } from '@vanilla-bean/components';

import Home from './Home';
import { setIdentity } from './identity';
import Login from './Login';
import Project from './Project';
import TerminalView from './Terminal/TerminalView';

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

if (joinToken) {
	const response = await fetch('/api/join', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ token: joinToken }),
	});

	if (response.ok) window.location.replace(`#/sessions/${(await response.json()).sessionId}`);
	else joinFailed = true;
}

// VBC's Router through 2.0.3 keeps the current view when only a route parameter changes, which would leave one
// session's page (and its delete button) showing under another session's address
const sessionIn = url => new URL(url).hash.match(/^#\/sessions\/([^/?]+)/)?.[1];

window.addEventListener('hashchange', ({ oldURL, newURL }) => {
	if (sessionIn(oldURL) && sessionIn(newURL) && sessionIn(oldURL) !== sessionIn(newURL)) window.location.reload();
});

// A one-time link from the terminal (paude web) logs the owner in
const handoffCode = window.location.hash.match(/^#\/handoff\/(.+)$/)?.[1];

if (handoffCode) {
	// An expired code just leaves the login page showing
	await fetch('/api/handoff/redeem', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ code: handoffCode }),
	});

	window.location.replace('#/');
}

const { authenticated, passwordSet, identity } = await (await fetch('/api/auth')).json();

setIdentity(identity);

const content = () => {
	if (!authenticated) return new Login({ passwordSet, joinFailed });

	// A guest has exactly one session and nowhere else to go
	if (!identity.owner) return new TerminalView({ id: identity.sessionId });

	return new Router({
		views: { '/': Home, '/projects/:project': Project, '/sessions/:id': TerminalView },
		defaultPath: '/',
	});
};

new Page({ appendTo: document.body, append: content() });
