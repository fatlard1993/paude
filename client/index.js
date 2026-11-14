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
import Arcade from './Arcade/Arcade';
import MakerHome from './Arcade/MakerHome';
import Universe from './Universe/Universe';
import { updateTabTitle } from './tabTitle';
import { startWatchAlerts } from './watchAlerts';
import { offerNewVersions } from './newVersion';

// A development build is offered to the page, not loaded under it
if (process.env.NODE_ENV === 'development') offerNewVersions();

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
		// A game maker has no one session: their arcade, their games in it
		window.location.replace(body.maker ? '#/arcade' : `#/sessions/${body.sessionId}`);
	} else joinFailed = true;
}

// A handoff from another server: a code to log in with, where to go (a session, its arcade, a project), and for a project page a prompt to start with
// and how long its session should last
const [, handoffCode, handoffTo, handoffProject, handoffLifetime, handoffDraft] =
	window.location.hash.match(
		/^#\/handoff\/([^/]+)(\/sessions\/[^/]+|\/arcade\/[^/]+|\/projects\/([^/]+))?(?:\/lifetime\/(\w+))?(?:\/draft\/(.+))?$/,
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
	// A guest in the arcade has one session, in front of them: no alerts about it over their page
	if (identity.view !== 'arcade') startWatchAlerts(identity);
}

const content = () => {
	// A browser that came in by invite and is now logged out had its invite end, not a password to type
	if (!authenticated) return new Login({ passwordSet, inviteEnded: joinFailed || recall(GUEST_KEY) === 'yes' });
	if (identity.owner) remember(GUEST_KEY, '');

	// A guest has exactly one session, and the universe with that session's grey and its project's machine alone
	// A game maker gets their own arcade: their games, each one session to come back to, and making new ones; each
	// game's arcade page as its guest would; nothing else
	if (identity.maker) {
		if (!/^#\/arcade\b/.test(window.location.hash)) window.location.replace('#/arcade');

		return new Router({ views: { '/arcade': MakerHome, '/arcade/:id': Arcade }, defaultPath: '/arcade' });
	}

	if (!identity.owner) {
		class GuestTerminal extends TerminalView {
			constructor(options) {
				super({ ...options, id: identity.sessionId });
			}
		}
		class GuestArcade extends Arcade {
			constructor(options) {
				super({ ...options, id: identity.sessionId });
			}
		}

		// Invited to the arcade, the guest gets the arcade and the ship (with the arcade's panels on their session's
		// dock), never the session's own page, whatever page the link or an old bookmark named
		if (identity.view === 'arcade') {
			if (!/^#\/(arcade|universe)\b/.test(window.location.hash))
				window.location.replace(`#/arcade/${identity.sessionId}`);

			return new Router({
				views: { '/arcade/:id': GuestArcade, '/universe': Universe, '/universe/sessions/:session': Universe },
				defaultPath: `/arcade/${identity.sessionId}`,
			});
		}

		return new Router({
			views: { '/sessions/:id': GuestTerminal, '/universe': Universe, '/universe/sessions/:session': Universe },
			defaultPath: `/sessions/${identity.sessionId}`,
		});
	}

	return new Router({
		views: {
			'/': Home,
			'/projects/:project': Project,
			'/sessions/:id': TerminalView,
			'/arcade/:id': Arcade,
			'/universe': Universe,
			// Opened looking at one session's grey, or one project's machine
			'/universe/sessions/:session': Universe,
			'/universe/projects/:project': Universe,
		},
		defaultPath: '/',
	});
};

fitToKeyboard();
// paude styles its own elements; its buttons and fields take the library's look through dom.js
new Page({ themeElements: false, appendTo: document.body, append: content() });
