import { Notify, View } from '@vanilla-bean/components';

import { answerAsking, getAsking, getFeed, getSession, getShares, getTasks, logout, runTask, sendPrompt } from '../api';
import { Bar, ghostButton } from '../Bar';
import { button, element, icon } from '../dom';
import { identity } from '../identity';
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
const EMOJI_FIRST = /^(\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*)\s*(.*)$/su;
// A question put to the player with AskUserQuestion shows its header as a checkbox; a permission prompt is titled
// by its tool and asks whether to proceed
const forPlayer = asking => /^[☐☑]/.test(asking.title) || (!asking.title && !/proceed/i.test(asking.question));

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
		});
		this.addCleanup('speech', () => {
			stopSpeaking();
			this.ear?.stop();
		});
		this.addCleanup('tabTitle', () => updateTabTitle({ page: '' }));
		updateTabTitle({ page: 'Arcade' });
		this.tick();
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
		this.status = session.status;
		this.title.textContent = session.title || session.project || 'Arcade';

		const lamp = LAMPS[session.status] ?? LAMPS.stopped;

		this.lamp.className = `lamp ${session.status}`;
		this.lamp.replaceChildren(icon(lamp.icon), element('span', '', lamp.words));
	}

	showEntries(entries) {
		const atBottom = this.feed.scrollHeight - this.feed.scrollTop - this.feed.clientHeight < 80;

		for (const entry of entries) {
			if (entry.kind === 'tool') {
				this.noteDid(entry);
				continue;
			}

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
			const choice = button(
				'',
				async () => {
					const answered = await answerAsking(this.id, asking.question, option.key);

					if (answered.response?.ok) {
						this.clearAsking();
						this.showStatus({ status: 'working', title: this.title.textContent });
					} else new Notify({ intent: 'warning', content: 'Claude is no longer asking that' });
				},
				{ className: 'choice' },
			);

			if (emoji) choice.append(element('span', 'emoji', emoji));
			choice.append(element('span', 'words', words));
			if (!player && option.detail) choice.append(element('small', '', ` ${option.detail}`));
			this.choices.append(choice);
		}
		this.feed.scrollTop = this.feed.scrollHeight;
		if (player && this.prefs.speak)
			this.enqueue(`${asking.question} ${asking.options.map(option => spokenText(option.label)).join('. ')}`);
	}

	clearAsking() {
		if (this.asked === null) return;
		this.asked = null;
		this.choices.hidden = true;
		this.choices.replaceChildren();
	}

	// Talking to Claude

	async send(text) {
		const typed = String(text ?? '').trim();

		if (!typed) return;
		stopSpeaking();
		this.queue = [];

		const { response, body } = await sendPrompt(this.id, typed);

		if (!response?.ok) {
			new Notify({ intent: 'danger', content: typeof body === 'string' && body ? body : 'Could not send that' });

			return;
		}
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
			onHeard: text => {
				heard = text;
				this.heard.textContent = text;
			},
			onEnd: reason => {
				this.ear = null;
				this.mic.classList.remove('hearing');
				this.input.hidden = false;
				this.heard.hidden = true;
				if (reason === 'done' && heard.trim()) this.send(heard);
				else if (reason === 'denied')
					new Notify({ intent: 'warning', content: 'The microphone is blocked here: allow it in the address bar' });
				else if (reason === 'unsupported')
					new Notify({ intent: 'warning', content: "This browser can't listen; type instead" });
			},
		});
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
					else new Notify({ intent: 'danger', content: typeof body === 'string' ? body : 'Could not start it' });
				}),
			);
		this.game.replaceChildren(room);
	}

	reloadGame() {
		if (this.frame) this.frame.src = this.gameUrl;
		else this.findGame();
	}
}
