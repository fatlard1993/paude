import { getShares, getTasks, runTask } from '../api';
import { button, element, icon } from '../dom';
import { identity } from '../identity';
import GameFrame from './ArcadeGame.styles';

// The game a session builds, live: the server it runs (the project's dev task, found and shared by paude) in a frame,
// reloading itself as Claude saves. Until it's up, a room that says so; the owner's page starts a dead server again
// by itself. The same frame on the arcade page and in the universe's dock.
const FIND_MS = 3000;
const CHECK_MS = 15_000;
const DEV_TASK = 'package.json:dev';
// A game server found down is started again at most this often
const RESTART_EVERY_MS = 60_000;

export default class ArcadeGame extends GameFrame {
	build() {
		this.sessionId = this.options.sessionId;
		this.url = null;
		this.frame = null;
		this.elem.classList.add('arcade-game');
		this.addCleanup('finding', () => {
			this.left = true;
			clearTimeout(this.timer);
		});
		this.waitingRoom('Getting the game ready…');
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
				this.frame = element('iframe');
				this.frame.src = port.url;
				this.frame.allow = 'autoplay; fullscreen';
				this.elem.replaceChildren(this.frame);
			}

			return;
		}

		this.url = null;
		this.frame = null;
		if (!identity()?.owner) return this.waitingRoom('The game is getting ready…');

		const tasks = await getTasks(this.sessionId);
		const running = tasks.body?.runs?.some(run => run.taskId === DEV_TASK && run.code === undefined);

		// Down (it crashed, or the session slept and woke): started again by itself, with the button for a stubborn one
		if (!running && Date.now() - (this.restartedAt ?? 0) > RESTART_EVERY_MS) {
			this.restartedAt = Date.now();
			this.waitingRoom('The game is starting…');
			await runTask(this.sessionId, DEV_TASK).catch(() => {});

			return;
		}
		this.waitingRoom(running ? 'The game is starting…' : 'The game is not running', !running);
	}

	waitingRoom(words, canStart = false) {
		const room = element('div', 'waiting-room');

		room.append(icon('gamepad'), element('div', '', words));
		if (canStart)
			room.append(
				button('Start the game', async () => {
					const { response } = await runTask(this.sessionId, DEV_TASK);

					this.waitingRoom(response?.ok ? 'The game is starting…' : 'It could not be started', !response?.ok);
				}),
			);
		this.elem.replaceChildren(room);
	}

	reload() {
		if (this.frame) this.frame.src = this.url;
		else this.find();
	}
}
