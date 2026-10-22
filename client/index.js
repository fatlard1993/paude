import { Page, Router, fitToKeyboard } from '@vanilla-bean/components';

import { getAuth, joinInvite, redeemHandoff } from './api';
import Home from './Home';
import { setIdentity, setServerName } from './identity';
import Login from './Login';
import { recall, remember } from './storage';
import { registerNotificationWorker } from './notify';
import Project from './Project';
import { keepDraft } from './PromptHome';
import TerminalView from './Terminal/TerminalView';
import { updateTabTitle } from './tabTitle';
import { startWatchAlerts } from './watchAlerts';

import '@vanilla-bean/components/app/reloadOnBuild';

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
	const { response, body } = await joinInvite(joinToken);

	if (response?.ok) {
		remember(GUEST_KEY, 'yes');
		window.location.replace(`#/sessions/${body.sessionId}`);
	} else joinFailed = true;
}

// A handoff from another server: a code to log in with, where to go, and for a project page a prompt to start with
// and how long its session should last
const [, handoffCode, handoffTo, handoffProject, handoffLifetime, handoffDraft] =
	window.location.hash.match(
		/^#\/handoff\/([^/]+)(\/sessions\/[^/]+|\/projects\/([^/]+))?(?:\/lifetime\/(\w+))?(?:\/draft\/(.+))?$/,
	) ?? [];

if (handoffCode) {
	// An expired code leaves the login page showing
	await redeemHandoff(handoffCode);

	if (handoffProject && handoffDraft)
		keepDraft(decodeURIComponent(handoffProject), decodeURIComponent(handoffDraft), handoffLifetime);
	window.location.replace(`#${handoffTo ?? '/'}`);
}

const {
	body: { authenticated, passwordSet, identity, name },
} = await getAuth();

setIdentity(identity);
setServerName(name);
updateTabTitle();

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

fitToKeyboard();
// paude styles its own elements; its buttons and fields take the library's look through dom.js
new Page({ themeElements: false, appendTo: document.body, append: content() });
