import { View } from '@vanilla-bean/components';

import {
	answerAsking,
	getArcade,
	getAsking,
	getFeed,
	getSession,
	getShares,
	getTasks,
	logout,
	runTask,
	sendPrompt,
	shelveArcade,
	undoArcadeTurn,
} from '../api';
import { Bar, ghostButton } from '../Bar';
import confirmDialog from '../confirmDialog';
import { button, element, icon } from '../dom';
import { canType, identity } from '../identity';
import { openMenu } from '../menu';
import { canListen, canSpeak, displayTokens, listen, speak, spokenText, stopSpeaking } from '../speech';
import { recall, remember } from '../storage';
import { updateTabTitle } from '../tabTitle';
import { toolIcon, toolWord } from '../toolIcons';
import ArcadePage from './Arcade.styles';

// A session as a kid plays it: the game they're building on one side, the talk with Claude on the other, in big type,
// read aloud, answered by tapping a choice or talking. No terminal. The same session as its own page shows; this is
// another window on it, for the owner too (to try it, or to sit beside the kid).
const POLL_MS = 2000;
const IDLE_POLL_MS = 4000;
const HIDDEN_POLL_MS = 8000;
// How far back the transcript is read on opening, for the last few things said
const BACK_BYTES = 150_000;
const SHOWN_HISTORY = 4;
const GAME_CHECK_EVERY = 5;
const DEV_TASK = 'package.json:dev';
const NUDGE = /^keep-?warm ping/i;
const PREFS = { speak: 'paude.arcade.speak', size: 'paude.arcade.size' };
const SIZES = [
	{ scale: 1, label: 'Normal' },
	{ scale: 1.25, label: 'Bigger' },
	{ scale: 1.55, label: 'Biggest' },
];
const LAMPS = {
	working: { icon: 'spinner fa-spin', words: 'Claude is working' },
	waiting: { icon: 'hand', words: 'Your turn!' },
	ready: { icon: 'circle-check', words: 'Ready. What next?' },
	stopped: { icon: 'moon', words: 'Asleep. Say something to wake it' },
};
// Working this long with nothing new from Claude reads as a long one, then as stuck
const LONG_MS = 90_000;
const STUCK_MS = 4 * 60_000;
const LAMP_TICK_MS = 1000;

const ago = ms => {
	const seconds = Math.round(ms / 1000);

	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
const EMOJI_FIRST = /^(\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*)\s*(.*)$/su;
// A question put to the player with AskUserQuestion shows its header as a checkbox; a permission prompt is titled
// by its tool and asks whether to proceed
const forPlayer = asking => /^[☐☑]/.test(asking.title) || (!asking.title && !/proceed/i.test(asking.question));

// A choice whose words mean the player will say it themselves: it opens the ear (or the box) rather than being
// answered as is, and what they say answers the question
const OWN_WORDS = /\b(my (own )?idea|my own|something else|i('ll| will) (say|tell|type)|tell you|other)\b/i;

const splitEmoji = label => {
	const match = EMOJI_FIRST.exec(label);

	return match ? { emoji: match[1], words: match[2] } : { emoji: '', words: label };
};

export default class Arcade extends View {
	build() {
		this.id = this.options.id;
		this.cursor = null;
		this.asked = null;
		this.gameUrl = null;
		this.status = null;
		this.ticks = 0;
		this.queue = [];
		this.saying = null;
		this.sent = [];
		this.did = null;
		this.asking = null;
		// What arcade this is ({ title, player, reading, shelf? }), once asked; null for an ordinary session
		this.arcade = null;
		this.reading = 'reading';
		this.prefs = {
			speak: (recall(PREFS.speak) || (canSpeak() ? 'yes' : 'no')) === 'yes',
			size: Math.min(Math.max(Number(recall(PREFS.size)) || 0, 0), SIZES.length - 1),
		};

		this.page = new ArcadePage({ appendTo: this });
		this.buildBar();
		this.buildStage();
		this.applySize();

		this.addCleanup('poll', () => {
			this.left = true;
			clearTimeout(this.timer);
			clearInterval(this.lampTimer);
		});
		this.statusSince = Date.now();
		this.heardFromAt = Date.now();
		this.lastAct = '';
		this.lampTimer = setInterval(() => this.status === 'working' && this.showLampWords(), LAMP_TICK_MS);
		this.addCleanup('speech', () => {
			stopSpeaking();
			this.ear?.stop();
		});
		this.addCleanup('tabTitle', () => updateTabTitle({ page: '' }));
		updateTabTitle({ page: 'Arcade' });
		this.learnArcade().finally(() => this.tick());
	}

	async learnArcade() {
		const { body, response } = await getArcade(this.id).catch(() => ({}));

		if (!response?.ok) return;
		this.arcade = body.arcade;
		this.reading = body.arcade?.reading ?? 'reading';
		if (this.arcade && canType()) this.putBack.hidden = false;
		if (this.arcade && body.shelf && identity()?.owner) this.shelfButton.hidden = false;
	}

	buildBar() {
		const bar = new Bar({ appendTo: this.page });
		const owner = identity()?.owner;

		if (owner) {
			ghostButton(bar, { icon: 'house', title: 'Home', onPress: () => (window.location.hash = '#/') });
			ghostButton(bar, {
				icon: 'terminal',
				title: "The session's own page",
				onPress: () => (window.location.hash = `#/sessions/${this.id}`),
			});
		}
		this.title = element('span', 'title', 'Arcade');
		this.title.style.flex = '1';
		this.title.style.minWidth = '0';
		this.title.style.overflow = 'hidden';
		this.title.style.textOverflow = 'ellipsis';
		this.title.style.whiteSpace = 'nowrap';
		bar.elem.append(this.title);
		ghostButton(bar, { icon: 'rotate-right', title: 'Reload the game', onPress: () => this.reloadGame() });
		this.shelfButton = ghostButton(bar, {
			icon: 'box-archive',
			title: "Put it on the house shelf: run as one of the house's games, at a name of its own",
			onPress: () => this.shelve(),
		});
		this.shelfButton.hidden = true;
		if (canSpeak())
			this.speakButton = ghostButton(bar, {
				icon: this.prefs.speak ? 'volume-high' : 'volume-xmark',
				title: 'Read aloud',
				onPress: () => this.setSpeak(!this.prefs.speak),
			});
		this.sizeButton = ghostButton(bar, { icon: 'text-height', title: 'Text size', onPress: () => this.sizeMenu() });
		if (!owner)
			ghostButton(bar, {
				icon: 'right-from-bracket',
				title: 'Leave',
				onPress: async () => {
					await logout();
					window.location.reload();
				},
			});
	}

	buildStage() {
		const stage = element('div', 'stage');

		this.game = element('div', 'game');
		this.talk = element('div', 'talk');
		this.lamp = element('div', 'lamp');
		this.lampWords = element('span', 'words');
		this.putBack = button('Put it back', () => this.offerPutBack(), {
			icon: 'rotate-left',
			className: 'put-back variant-flat',
			title: "Undo Claude's last change to the game",
		});
		this.putBack.hidden = true;
		this.feed = element('div', 'feed');
		this.choices = element('div', 'choices');
		this.choices.hidden = true;
		this.talk.append(this.lamp, this.feed, this.choices, this.buildComposer());
		stage.append(this.game, this.talk);
		this.page.elem.append(stage);
		this.waitingRoom('Getting the game ready…');
	}

	buildComposer() {
		const composer = element('div', 'composer');

		this.input = element('input');
		this.input.placeholder = 'Tell Claude what to do';
		this.input.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.send(this.input.value);
				this.input.value = '';
			}
		});
		this.heard = element('div', 'heard');
		this.heard.hidden = true;
		if (canListen()) {
			this.mic = button('', () => this.toggleEar(), {
				icon: 'microphone',
				className: 'mic icon-only',
				title: 'Talk to Claude',
			});
			composer.append(this.mic);
		}
		composer.append(
			this.input,
			this.heard,
			button(
				'',
				() => {
					this.send(this.input.value);
					this.input.value = '';
				},
				{ icon: 'paper-plane', className: 'send icon-only', title: 'Send' },
			),
		);

		return composer;
	}

	// Preferences

	setSpeak(on) {
		this.prefs.speak = on;
		remember(PREFS.speak, on ? 'yes' : 'no');
		if (this.speakButton) this.speakButton.firstChild.className = `fa-solid fa-${on ? 'volume-high' : 'volume-xmark'}`;
		if (!on) {
			this.queue = [];
			stopSpeaking();
		}
	}

	applySize() {
		this.page.elem.style.setProperty('--arcade-scale', SIZES[this.prefs.size].scale);
	}

	sizeMenu() {
		openMenu(this.sizeButton, [
			{ heading: 'Text size' },
			...SIZES.map((size, index) => ({
				label: size.label,
				...(index === this.prefs.size && { icon: 'check' }),
				onPress: () => {
					this.prefs.size = index;
					remember(PREFS.size, String(index));
					this.applySize();
				},
			})),
		]);
	}

	// Following the session

	// Built before the router has placed it, so the first tick runs unattached; leaving the page ends them
	async tick() {
		clearTimeout(this.timer);
		if (this.left) return;

		const hidden = document.visibilityState === 'hidden';

		if (!hidden) {
			this.ticks += 1;
			try {
				const [session, entries] = await Promise.all([getSession(this.id), this.readFeed()]);

				if (session.response?.ok) this.showStatus(session.body);
				if (entries?.length) this.showEntries(entries);
				if (this.status === 'waiting') await this.showAsking();
				else this.clearAsking();
				if (!this.gameUrl || this.ticks % GAME_CHECK_EVERY === 0) await this.findGame();
			} catch {
				// Offline for a moment: the next tick tries again
			}
		}

		const busy = this.status === 'working' || this.status === 'waiting';

		this.timer = setTimeout(() => this.tick(), (hidden && HIDDEN_POLL_MS) || (busy ? POLL_MS : IDLE_POLL_MS));
	}

	async readFeed() {
		if (this.cursor !== null) {
			const { body, response } = await getFeed(this.id, this.cursor);

			if (!response?.ok) return null;
			this.cursor = body.cursor;

			return body.entries;
		}

		// Opening: the last few things said, then everything from here on
		const { body, response } = await getFeed(this.id);

		if (!response?.ok) return null;

		const end = Number(body.cursor);
		const recent = end > 0 ? await getFeed(this.id, Math.max(0, end - BACK_BYTES)) : null;

		this.cursor = recent?.response?.ok ? recent.body.cursor : body.cursor;
		if (!recent?.response?.ok) return [];

		const entries = recent.body.entries;
		const texts = entries.map((entry, index) => (entry.kind === 'text' ? index : -1)).filter(index => index !== -1);
		const from = texts.length > SHOWN_HISTORY ? texts.at(-SHOWN_HISTORY) : 0;

		return entries.slice(from).map(entry => ({ ...entry, old: true }));
	}

	showStatus(session) {
		if (session.status !== this.status) {
			this.statusSince = Date.now();
			this.heardFromAt = Date.now();
			this.lastAct = '';
		}
		this.status = session.status;
		this.title.textContent = session.title || session.project || 'Arcade';

		const lamp = LAMPS[session.status] ?? LAMPS.stopped;

		this.lamp.className = `lamp ${session.status}`;
		this.lamp.replaceChildren(icon(lamp.icon), this.lampWords, this.putBack);
		this.showLampWords();
	}

	// The lamp's words: while Claude works, what it's at and for how long, and plainly when it's been a while
	showLampWords() {
		const lamp = LAMPS[this.status] ?? LAMPS.stopped;

		if (this.status !== 'working') {
			this.lampWords.textContent =
				this.status === 'waiting' && this.asking && !forPlayer(this.asking) && !identity()?.owner
					? 'Waiting for a grown-up'
					: lamp.words;

			return;
		}

		const quiet = Date.now() - this.heardFromAt;
		const since = ago(Date.now() - this.statusSince);

		if (quiet > STUCK_MS) this.lampWords.textContent = `Claude has been quiet for ${ago(quiet)}. It may be stuck`;
		else if (quiet > LONG_MS) this.lampWords.textContent = `Still working, a big one · ${since}`;
		else this.lampWords.textContent = `Claude is ${this.lastAct || 'working'} · ${since}`;
	}

	showEntries(entries) {
		const atBottom = this.feed.scrollHeight - this.feed.scrollTop - this.feed.clientHeight < 80;

		for (const entry of entries) {
			if (!entry.old) this.heardFromAt = Date.now();
			if (entry.kind === 'tool') {
				this.noteDid(entry);
				if (!entry.old) this.lastAct = `${toolWord(entry.name)}${entry.file ? ` ${entry.file.split('/').pop()}` : ''}`;
				continue;
			}
			if (entry.kind === 'text' && !entry.old) this.lastAct = 'thinking what to say';

			this.did = null;
			if (entry.kind === 'prompt') {
				if (NUDGE.test(entry.text)) continue;
				// Already shown as it was sent from here
				const index = this.sent.indexOf(entry.text);

				if (index !== -1) {
					this.sent.splice(index, 1);
					continue;
				}
				this.feed.append(element('div', 'card you', entry.text));
			}
			if (entry.kind === 'text') {
				const card = this.claudeCard(entry.text);

				this.feed.append(card);
				if (!entry.old && this.prefs.speak) this.enqueue(card.spokenText, card);
			}
		}
		if (atBottom || entries.some(entry => !entry.old)) this.feed.scrollTop = this.feed.scrollHeight;
	}

	// What Claude did between two things it said, as one quiet row: each kind of act once, counted when it repeats,
	// however many polls it arrived over
	noteDid(entry) {
		if (!this.did) {
			this.did = { row: element('div', 'did'), marks: new Map() };
			this.feed.append(this.did.row);
		}

		const word = toolWord(entry.name);
		const known = this.did.marks.get(word);

		if (known) {
			known.count += 1;
			known.node.lastChild.textContent = ` ${word} ×${known.count}`;
			known.node.title = [known.node.title, entry.summary ?? entry.name].filter(Boolean).join('\n');

			return;
		}

		const node = element('span');

		node.append(icon(toolIcon(entry.name)), element('span', '', ` ${word}`));
		node.title = entry.summary ?? entry.name;
		this.did.row.append(node);
		this.did.marks.set(word, { node, count: 1 });
	}

	claudeCard(text) {
		const card = element('div', 'card claude');
		const words = [];

		for (const paragraph of displayTokens(text)) {
			const line = element('p');

			for (const token of paragraph) {
				const span = element('span', token.emoji ? 'emoji' : 'word', token.text);

				if (!token.emoji) words.push(span);
				line.append(span, ' ');
			}
			card.append(line);
		}
		card.words = words;
		card.spokenText = words.map(span => span.textContent).join(' ');
		if (canSpeak() && words.length)
			card.prepend(
				button('', () => this.say(card.spokenText, card), {
					icon: 'volume-high',
					className: 'say icon-only variant-flat',
					title: 'Say it again',
				}),
			);

		return card;
	}

	// A word to whoever is here, in the feed where they look, never a toast over the choices and the box
	notice(text, intent = 'info') {
		const card = element('div', `card notice ${intent}`);

		card.textContent = text;
		this.feed.append(card);
		this.feed.scrollTop = this.feed.scrollHeight;
	}

	// Reading aloud: one thing at a time, in the order it arrived

	enqueue(text, card) {
		if (!text) return;
		this.queue.push({ text, card });
		if (!this.saying) this.sayNext();
	}

	sayNext() {
		const next = this.queue.shift();

		if (!next) {
			this.saying = null;

			return;
		}
		this.say(next.text, next.card, () => this.sayNext());
	}

	say(text, card, then) {
		const light = index => card?.words?.forEach((span, at) => span.classList.toggle('lit', at === index));

		this.saying = speak(text, {
			session: this.id,
			onWord: light,
			onEnd: () => {
				light(-1);
				this.saying = null;
				then?.();
			},
		});
	}

	// Choices

	async showAsking() {
		const { body, response } = await getAsking(this.id);
		const asking = response?.ok ? body.asking : null;

		if (!asking) return this.clearAsking();

		const key = JSON.stringify([asking.title, asking.question, asking.options.map(option => option.label)]);

		if (this.asked === key) return;
		this.asked = key;
		this.asking = asking;
		this.choices.replaceChildren();
		this.choices.hidden = false;

		const player = forPlayer(asking);

		if (!player && !identity()?.owner) {
			this.choices.append(element('div', 'grown-up', 'Claude is asking a grown-up something. One moment.'));

			return;
		}

		const question = element('div', 'question', player ? asking.question : `${asking.title}: ${asking.question}`);

		if (!player && asking.details.length) {
			const details = element('pre', 'details', asking.details.join('\n'));

			details.style.whiteSpace = 'pre-wrap';
			details.style.fontSize = '0.7em';
			question.append(details);
		}
		this.choices.append(question);

		for (const option of asking.options) {
			const { emoji, words } = splitEmoji(option.label);
			const ownWords = player && asking.typing && OWN_WORDS.test(option.label);
			const choice = button(
				'',
				async () => {
					if (ownWords) return this.askInOwnWords();

					const answered = await answerAsking(this.id, asking.question, option.key);

					if (answered.response?.ok) {
						this.clearAsking();
						this.showStatus({ status: 'working', title: this.title.textContent });
					} else this.notice('Claude is no longer asking that', 'warning');
				},
				{ className: 'choice' },
			);

			const label = element('span', 'label');

			if (emoji) choice.append(element('span', 'emoji', emoji));
			label.append(element('span', 'words', words));
			// A reader gets the line under each choice; a listener hears the choices alone
			if (option.detail && (!player || this.reading !== 'listening'))
				label.append(element('small', 'detail', option.detail));
			choice.append(label);
			this.choices.append(choice);
		}
		this.feed.scrollTop = this.feed.scrollHeight;
		if (player && this.prefs.speak)
			this.enqueue(`${asking.question} ${asking.options.map(option => spokenText(option.label)).join('. ')}`);
	}

	clearAsking() {
		this.asking = null;
		if (this.asked === null) return;
		this.asked = null;
		this.choices.hidden = true;
		this.choices.replaceChildren();
	}

	// "My idea": the ear opens (or the box takes focus), and what comes answers the question in words
	askInOwnWords() {
		stopSpeaking();
		this.queue = [];
		if (this.mic && !this.ear) this.toggleEar();
		else this.input.focus();
		this.input.placeholder = 'Say your idea';
		if (this.prefs.speak) this.enqueue('Tell me your idea.');
	}

	// Talking to Claude

	async send(text) {
		const typed = String(text ?? '').trim();

		if (!typed) return;
		stopSpeaking();
		this.queue = [];

		// Words while a question with a typing option is up answer that question; otherwise they're the next prompt
		const asking = this.asking;
		let { response, body } = asking?.typing
			? await answerAsking(this.id, asking.question, asking.typing, typed)
			: await sendPrompt(this.id, typed);

		// The question went away meanwhile: the words go as a prompt instead
		if (!response?.ok && asking?.typing && response?.status === 409)
			({ response, body } = await sendPrompt(this.id, typed));
		if (!response?.ok) {
			this.notice(typeof body === 'string' && body ? body : 'Could not send that', 'danger');

			return;
		}
		this.input.placeholder = 'Tell Claude what to do';
		this.sent.push(typed);
		this.feed.append(element('div', 'card you', typed));
		this.feed.scrollTop = this.feed.scrollHeight;
		this.clearAsking();
		if (this.status !== 'working') this.showStatus({ status: 'working', title: this.title.textContent });
	}

	toggleEar() {
		if (this.ear) {
			this.ear.stop();

			return;
		}
		stopSpeaking();
		this.queue = [];
		this.mic.classList.add('hearing');
		this.input.hidden = true;
		this.heard.hidden = false;
		this.heard.textContent = 'Listening…';

		let heard = '';

		this.ear = listen({
			session: this.id,
			onHeard: text => {
				heard = text;
				this.heard.textContent = text;
			},
			onThinking: () => {
				this.mic.classList.remove('hearing');
				this.mic.classList.add('thinking');
				this.heard.textContent = 'Thinking…';
			},
			onEnd: reason => {
				this.ear = null;
				this.mic.classList.remove('hearing', 'thinking');
				this.input.hidden = false;
				this.heard.hidden = true;
				if (reason === 'done' && heard.trim()) this.send(heard);
				else if (reason === 'failed') this.notice("I couldn't hear that. Try again", 'warning');
				else if (reason === 'denied')
					this.notice('The microphone is blocked here: allow it in the address bar', 'warning');
				else if (reason === 'unsupported') this.notice("This browser can't listen; type instead", 'warning');
			},
		});
	}

	// Putting the game back to before Claude's last turn: offered, then done

	offerPutBack() {
		if (this.status === 'working') {
			this.notice('Claude is still working. Wait for it to finish', 'warning');

			return;
		}
		stopSpeaking();
		this.queue = [];
		this.asked = 'put-back';
		this.choices.replaceChildren(element('div', 'question', 'Put the game back the way it was?'));

		const yes = button('', () => this.putItBack(), { className: 'choice' });
		const no = button('', () => this.clearAsking(), { className: 'choice' });

		yes.append(element('span', 'emoji', '↩️'), element('span', 'label', 'Yes, put it back'));
		no.append(element('span', 'emoji', '✖️'), element('span', 'label', 'No, keep it'));
		this.choices.append(yes, no);
		this.choices.hidden = false;
		this.feed.scrollTop = this.feed.scrollHeight;
		if (this.prefs.speak) this.enqueue('Put the game back the way it was? Yes, put it back. No, keep it.');
	}

	async putItBack() {
		this.clearAsking();

		const { body, response } = await undoArcadeTurn(this.id);

		if (!response?.ok) {
			this.notice(typeof body === 'string' && body ? body : 'It could not be put back', 'warning');

			return;
		}
		this.feed.append(element('div', 'card you', `Put it back: ${body.undone}`));
		this.feed.scrollTop = this.feed.scrollHeight;
		this.showStatus({ status: 'working', title: this.title.textContent });
		if (this.prefs.speak) this.enqueue("It's back the way it was.");
	}

	async shelve() {
		const name = this.arcade?.title || this.title.textContent;
		const confirmed = await confirmDialog({
			header: `Put ${name} on the house shelf?`,
			body: "It runs as one of the house's games from now on, at a name of its own, built as it is right now. Shelving it again later puts the newer game there.",
			confirmLabel: 'Put it on the shelf',
		});

		if (!confirmed) return;

		this.notice('Putting it on the shelf…', 'info');

		const { body, response } = await shelveArcade(this.id);

		if (!response?.ok) {
			this.notice(typeof body === 'string' && body ? body : 'The shelf refused it', 'danger');

			return;
		}
		this.notice(`On the shelf, on port ${body.port}`, 'success');
	}

	// The game

	async findGame() {
		const { body, response } = await getShares(this.id);

		if (!response?.ok) return;

		const port = (body?.shares ?? []).find(share => share.kind === 'port');

		if (port) {
			if (this.gameUrl !== port.url) {
				this.gameUrl = port.url;
				this.frame = element('iframe');
				this.frame.src = port.url;
				this.frame.allow = 'autoplay; fullscreen';
				this.game.replaceChildren(this.frame);
			}

			return;
		}

		this.gameUrl = null;
		if (!identity()?.owner) return this.waitingRoom('Claude is getting the game ready…');

		const tasks = await getTasks(this.id);
		const running = tasks.body?.runs?.some(run => run.taskId === DEV_TASK && run.code === undefined);

		this.waitingRoom(running ? 'The game is starting…' : 'The game is not running', !running);
	}

	waitingRoom(words, canStart = false) {
		const room = element('div', 'waiting-room');

		room.append(icon('gamepad'), element('div', '', words));
		if (canStart)
			room.append(
				button('Start the game', async () => {
					const { response, body } = await runTask(this.id, DEV_TASK);

					if (response?.ok) this.waitingRoom('The game is starting…');
					else this.notice(typeof body === 'string' ? body : 'Could not start it', 'danger');
				}),
			);
		this.game.replaceChildren(room);
	}

	reloadGame() {
		if (this.frame) this.frame.src = this.gameUrl;
		else this.findGame();
	}
}
