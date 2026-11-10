import { getShares, getTasks, openRemote, runTask, sessionRemote } from '../api';
import { button, element, icon } from '../dom';
import { identity } from '../identity';
import FilesPanel from '../Terminal/FilesPanel';
import GameFrame from './ArcadeGame.styles';
import { settledYet } from './settled';

// A session's output, live: the page its server runs (the project's dev task, found and shared by paude) in a frame,
// reloading itself as Claude saves. Until it's up, a room that says so; the owner's page starts a dead server again
// by itself. The same frame on the arcade page and in the universe's dock.
const FIND_MS = 3000;
const CHECK_MS = 15_000;
const DEV_TASK = 'package.json:dev';
// A game server found down is started again at most this often
const RESTART_EVERY_MS = 60_000;
// How long the curtain takes to fade as it lifts
const LIFT_MS = 300;
const SETTLE_CHECK_MS = 250;

export default class ArcadeGame extends GameFrame {
	static schema = { sessionId: {} };

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
			clearTimeout(this.settleTimer);
		});
		this.loadedAt = 0;
		this.curtain = this.buildCurtain();
		this.waitingRoom('Getting it ready…');
		this.find();
	}

	// Over the game while it's being built: blocks stacking, then "almost ready" while it settles. The frame keeps
	// loading behind it, so the game is there the moment the curtain lifts.
	buildCurtain() {
		const curtain = element('div', 'curtain');
		const blocks = element('div', 'blocks');

		for (let block = 0; block < 3; block++) blocks.append(element('span', 'block'));
		curtain.append(blocks, element('div', 'words', 'Building…'));

		return curtain;
	}

	// Claude at work on the game: the curtain down. Lifted again only by settle().
	building() {
		clearTimeout(this.settleTimer);
		this.settling = null;
		this.curtain.classList.remove('settling', 'lifting');
		this.curtain.querySelector('.words').textContent = 'Building…';
		this.elem.classList.add('built');
		if (this.frame) this.elem.append(this.curtain);
	}

	// The building done: the curtain lifts once the game has stopped reloading, resolving then. Resolves at once when
	// it isn't down.
	settle() {
		if (!this.elem.classList.contains('built')) return Promise.resolve();
		if (this.settling) return this.settling;

		this.curtain.classList.add('settling');
		this.curtain.querySelector('.words').textContent = 'Almost ready…';

		const began = Date.now();

		this.settling = new Promise(resolve => {
			const check = () => {
				if (!settledYet({ hasGame: Boolean(this.frame), loadedAt: this.loadedAt, began, now: Date.now() })) {
					this.settleTimer = setTimeout(check, SETTLE_CHECK_MS);

					return;
				}
				this.settling = null;
				this.elem.classList.remove('built');
				this.curtain.classList.add('lifting');
				this.settleTimer = setTimeout(() => {
					this.curtain.remove();
					this.curtain.classList.remove('lifting');
				}, LIFT_MS);
				resolve();
			};

			check();
		});

		return this.settling;
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
				if (this.remote && !this.loggedInThere) return this.loginRoom();
				this.showFrame();
			}

			return;
		}

		this.url = null;
		this.frame = null;
		if (!identity()?.owner) return this.waitingRoom('Getting it ready…');

		const tasks = await getTasks(this.sessionId);

		// A project with nothing running to show (no page shared, no dev script): its output is what Claude changes
		if (tasks.body?.tasks && !tasks.body.tasks.some(task => task.id === DEV_TASK)) return this.showChanges();

		const running = tasks.body?.runs?.some(run => run.taskId === DEV_TASK && run.code === undefined);

		// Down (it crashed, or the session slept and woke): started again by itself, with the button for a stubborn one
		if (!running && Date.now() - (this.restartedAt ?? 0) > RESTART_EVERY_MS) {
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

	showFrame() {
		this.frame = element('iframe');
		this.frame.src = this.url;
		this.frame.allow = 'autoplay; fullscreen';
		// Every load counts, the game reloading itself after a save included: settling waits for them to stop
		this.frame.addEventListener('load', () => (this.loadedAt = Date.now()));
		this.loadedAt = Date.now();
		this.show(this.frame);
	}

	// What the game's space shows: the game, the curtain kept over it while it's down, or a room saying why there's no
	// game, which needs no curtain
	show(what) {
		this.elem.replaceChildren(what);
		if (what === this.frame && this.elem.classList.contains('built')) this.elem.append(this.curtain);
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
		if (this.frame) this.frame.src = this.url;
		else if (this.url && this.remote) this.showFrame();
		else this.find();
	}
}
