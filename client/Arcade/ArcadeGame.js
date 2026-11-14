import { frameShare, getShares, getTasks, openRemote, runTask, sessionRemote } from '../api';
import { button, element, icon } from '../dom';
import { identity } from '../identity';
import FilesPanel from '../Terminal/FilesPanel';
import GameFrame from './ArcadeGame.styles';

// A session's output, live: the page its server runs (the project's dev task, found and shared by paude) in a frame.
// Its newer versions are offered for its player to load (setNewVersion), not loaded under them. Until it's up, a room
// that says so; in an arcade (`keepRunning`), the owner's page starts a dead server again by itself, and elsewhere it
// offers to. The same frame on the arcade page, in the universe's dock and in a session page's Output panel.
const FIND_MS = 3000;
const CHECK_MS = 15_000;
const DEV_TASK = 'package.json:dev';
// A game server found down is started again at most this often
const RESTART_EVERY_MS = 60_000;

export default class ArcadeGame extends GameFrame {
	static schema = { sessionId: {}, keepRunning: { default: true } };

	build() {
		this.sessionId = this.options.sessionId;
		this.url = null;
		this.frame = null;
		// On another paude, the game's frame loads from there, where this browser may hold no login yet
		this.remote = sessionRemote(this.sessionId);
		this.elem.classList.add('arcade-game');
		this.addCleanup('finding', () => {
			this.left = true;
			clearTimeout(this.timer);
		});
		this.waitingRoom('Getting it ready…');
		this.find();
	}

	// The dock shows a panel again: nothing to do, the frame is live already
	refresh() {}

	async find() {
		clearTimeout(this.timer);
		if (this.left) return;
		if (document.visibilityState !== 'hidden')
			try {
				await this.look();
			} catch {
				// Offline for a moment: the next look tries again
			}
		this.timer = setTimeout(() => this.find(), this.url ? CHECK_MS : FIND_MS);
	}

	async look() {
		const { body, response } = await getShares(this.sessionId);

		if (!response?.ok) return;

		const port = (body?.shares ?? []).find(share => share.kind === 'port');

		if (port) {
			if (this.url !== port.url) {
				this.url = port.url;
				this.share = port.name;
				if (this.remote) return this.showRemoteFrame();
				this.showFrame();
			}
			this.setNewVersion(Boolean(port.newVersion));

			return;
		}

		this.url = null;
		this.setNewVersion(false);
		this.frame = null;
		if (!identity()?.owner) return this.waitingRoom('Getting it ready…');

		const tasks = await getTasks(this.sessionId);

		// A project with nothing running to show (no page shared, no dev script): its output is what Claude changes
		if (tasks.body?.tasks && !tasks.body.tasks.some(task => task.id === DEV_TASK)) return this.showChanges();

		const running = tasks.body?.runs?.some(run => run.taskId === DEV_TASK && run.code === undefined);

		// Down (it crashed, or the session slept and woke): started again by itself, with the button for a stubborn one
		if (this.options.keepRunning && !running && Date.now() - (this.restartedAt ?? 0) > RESTART_EVERY_MS) {
			this.restartedAt = Date.now();
			this.waitingRoom('Starting…');
			await runTask(this.sessionId, DEV_TASK).catch(() => {});

			return;
		}
		this.waitingRoom(running ? 'Starting…' : 'Not running', !running);
	}

	// What Claude has changed, as the Files panel lists it (each file's diff a tap away): the output of a session with
	// nothing running to look at. Made once, and kept while there's still nothing running.
	showChanges() {
		this.changes ??= new FilesPanel({
			sessionId: this.sessionId,
			place: this.sessionId,
			close: () => {},
			addClass: ['docked', 'files', 'open', 'arcade-changes'],
			setFullscreen: () => {},
			attach: () => {},
			comment: () => {},
			commentsOn: () => [],
			showComment: () => {},
		});
		if (this.changes.elem.parentNode !== this.elem) this.show(this.changes.elem);
		this.changes.setMode('changes');
	}

	showFrame(src = this.url) {
		this.frame = element('iframe');
		this.frame.src = src;
		this.frame.allow = 'autoplay; fullscreen';
		this.show(this.frame);
	}

	// What the game's space shows: the game, or a room saying why there's no game
	show(what) {
		this.elem.replaceChildren(what);
		if (what === this.frame && this.newVersion) this.elem.append(this.banner);
	}

	// A newer version of the game is ready (its app rebuilt or restarted). It's offered, not loaded under its player:
	// the button loads it when they say so
	setNewVersion(on) {
		this.newVersion = on;
		this.banner ??= button(
			'A new version is ready · Reload',
			() => {
				this.setNewVersion(false);
				this.reload();
			},
			{ icon: 'rotate-right', className: 'new-version variant-flat' },
		);
		this.banner.remove();
		if (on && this.frame && this.elem.contains(this.frame)) this.elem.append(this.banner);
	}

	// A game on another paude shows from there, in a frame that brings that paude none of this browser's cookies (this
	// page is another site): it opens with a ticket, asked for there on this paude's login, fresh for each load. A paude
	// too old to give one is logged into instead.
	async showRemoteFrame() {
		const asked = this.url;
		const { body, response } = await frameShare(this.sessionId, this.share).catch(() => ({}));

		if (this.left || this.url !== asked) return;
		if (response?.ok && body?.url) return this.showFrame(body.url);
		if (!this.loggedInThere) return this.loginRoom();
		this.showFrame();
	}

	// A game on another paude shows from there, and that paude knows this browser only once it has logged in there:
	// paude's handoff does that in a tab of its own, and the frame follows when this page is looked at again
	loginRoom() {
		const name = new URL(this.remote).hostname;
		const room = element('div', 'waiting-room');

		room.append(
			icon('gamepad'),
			element('div', '', `The game runs on ${name}. Log in there once and it shows here.`),
			button(`Log in on ${name}`, async () => {
				const { body, response } = await openRemote(this.remote, { home: true });

				if (!response?.ok) return;
				window.open(body.link, '_blank');
				this.loggedInThere = true;
				// Back from that tab, the frame loads with the login it now has
				window.addEventListener('focus', () => this.url && this.showFrame(), { once: true });
				this.waitingRoom('Come back here once you are logged in there');
			}),
		);
		this.show(room);
	}

	waitingRoom(words, canStart = false) {
		const room = element('div', 'waiting-room');

		room.append(icon('gamepad'), element('div', '', words));
		if (canStart)
			room.append(
				button('Start it', async () => {
					const { response } = await runTask(this.sessionId, DEV_TASK);

					this.waitingRoom(response?.ok ? 'Starting…' : 'It could not be started', !response?.ok);
				}),
			);
		this.show(room);
	}

	reload() {
		if (this.url && this.remote) this.showRemoteFrame();
		else if (this.frame) this.frame.src = this.url;
		else this.find();
	}
}
