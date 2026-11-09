import {
	answerAsking,
	getArcade,
	getAsking,
	getFeed,
	getSession,
	restartSession,
	sendPrompt,
	sessionOrigin,
	undoArcadeTurn,
} from '../api';
import confirmDialog from '../confirmDialog';
import { button, element, icon } from '../dom';
import { canType, identity } from '../identity';
import { openMenu } from '../menu';
import { canListen, canSpeak, displayTokens, listen, speak, spokenText, stopSpeaking, wordsOf } from '../speech';
import { recall, remember } from '../storage';
import { toolDoing, toolIcon, toolWord } from '../toolIcons';
import attach from '../Terminal/attach';
import Talk from './ArcadeTalk.styles';
import sayQueue from './sayQueue';

// The talk with Claude as a kid has it: what Claude says in big type, read aloud with the words lit as they're said,
// what it did as a quiet row, its questions as big choices (lit as they're read), and a box with an ear to answer.
// Beside the game on the arcade page, and docked beside the universe's ship; the same on both. `onStatus(session)`
// and `onArcade(arcade, shelf)` tell whoever holds it what it learned.
const POLL_MS = 2000;
const IDLE_POLL_MS = 4000;
const HIDDEN_POLL_MS = 8000;
// How far back the transcript is read on opening, for the last few things said
const BACK_BYTES = 150_000;
const SHOWN_HISTORY = 4;
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
// With nothing read aloud, a question for the player counts as taken in after this long
const UNSPOKEN_REST_MS = 6000;
// Words sent while Claude works go into its box, and Claude takes them up when the turn ends: a question that turn
// ends with is about to be interrupted by them, so it's not shown or read, for this long at most
const PENDING_MS = 30_000;

const ago = ms => {
	const seconds = Math.round(ms / 1000);

	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
// What answers a question when the kid wants other choices
const MORE_IDEAS = 'None of these. Ask the same question again with different ideas, all new.';
// What Claude is told when the kid picks again, after the game is put back
const PICK_AGAIN_PROMPT =
	'They want to choose differently: the game is back to how it was before. Ask your last question again, with the same choices.';
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

export default class ArcadeTalk extends Talk {
	// Options of the talk's own, not attributes of its element
	// onRested: Claude waits on a question for the player and everything has been read; onBusy: Claude is at work
	static schema = { sessionId: {}, onStatus: {}, onArcade: {}, onRested: {}, onBusy: {} };

	build() {
		this.id = this.options.sessionId;
		this.elem.classList.add('arcade-talk');
		this.cursor = null;
		this.asked = null;
		this.gameUrl = null;
		this.status = null;
		this.ticks = 0;
		this.voice = sayQueue({ session: this.id, say: speak, onIdle: () => this.rested() });
		this.sent = [];
		this.did = null;
		this.asking = null;
		// A page just opened: a question already up is the player's to come back to, not read at them on arrival
		this.fresh = true;
		// { text, until }: words sent while Claude worked, not yet taken up
		this.pending = null;
		// What arcade this is ({ title, player, reading, shelf? }), once asked; null for an ordinary session
		this.arcade = null;
		this.reading = 'reading';
		this.prefs = {
			speak: (recall(PREFS.speak) || (canSpeak() ? 'yes' : 'no')) === 'yes',
			size: Math.min(Math.max(Number(recall(PREFS.size)) || 0, 0), SIZES.length - 1),
		};

		this.buildTalk();
		this.applySize();
		// Attached as the page's own client, so whoever is here is aboard the ship (a guest beside the grey) and the
		// session knows them; what it says and asks still comes by polling, which works for a page the socket can't reach
		this.connection = attach(this.id, {
			url: sessionOrigin(this.id),
			hello: () => ({ kind: 'web', label: 'arcade' }),
			onOutput: () => {},
			onMessage: () => {},
			onState: () => {},
		});
		this.addCleanup('attached', () => this.connection.close());

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
		this.learnArcade().finally(() => this.tick());
	}

	// The dock shows the panel again: it has been following all along
	refresh() {}

	async learnArcade() {
		const { body, response } = await getArcade(this.id).catch(() => ({}));

		if (!response?.ok) return;
		this.arcade = body.arcade;
		this.reading = body.arcade?.reading ?? 'reading';
		if (this.arcade && canType()) this.putBack.style.display = '';
		this.options.onArcade?.(body.arcade, body.shelf);
	}

	buildTalk() {
		this.lamp = element('div', 'lamp');
		this.lampWords = element('span', 'words');
		this.putBack = button('Put it back', () => this.offerPutBack(), {
			icon: 'rotate-left',
			className: 'put-back variant-flat',
			title: "Undo Claude's last change to the game",
		});
		// Not the hidden attribute: the button's own display rule outranks it
		this.putBack.style.display = 'none';
		// The talk's own controls, in the status row, so they're the same wherever the talk is
		this.controls = [this.putBack];
		if (canSpeak()) {
			this.speakButton = button('', () => this.setSpeak(!this.prefs.speak), {
				icon: this.prefs.speak ? 'volume-high' : 'volume-xmark',
				className: 'control icon-only variant-flat',
				title: 'Read aloud',
			});
			this.controls.push(this.speakButton);
		}
		this.sizeButton = button('', () => this.sizeMenu(), {
			icon: 'text-height',
			className: 'control icon-only variant-flat',
			title: 'Text size',
		});
		this.controls.push(this.sizeButton);
		if (identity()?.owner)
			this.controls.push(
				button('', () => this.restartClaude(), {
					icon: 'power-off',
					className: 'control icon-only variant-flat',
					title:
						'Restart Claude: start it over in this same conversation, reading its rules again; for one that is stuck',
				}),
			);
		this.feed = element('div', 'feed');
		this.choices = element('div', 'choices');
		this.choices.hidden = true;
		this.elem.append(this.lamp, this.feed, this.choices, this.buildComposer());
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
			this.voice.clear();
			stopSpeaking();
		}
	}

	applySize() {
		this.elem.style.setProperty('--arcade-scale', SIZES[this.prefs.size].scale);
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
				if (this.status === 'waiting' && this.promptPending()) {
					this.clearAsking();
					this.lampWords.textContent = 'Claude is taking what you sent next';
				} else if (this.status === 'waiting') await this.showAsking();
				else this.clearAsking();
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
			if (session.status === 'working') {
				this.fresh = false;
				this.options.onBusy?.();
			}
		}
		this.status = session.status;
		if (session.title !== undefined) this.options.onStatus?.(session);

		const lamp = LAMPS[session.status] ?? LAMPS.stopped;

		this.lamp.className = `lamp ${session.status}`;
		this.lamp.replaceChildren(icon(lamp.icon), this.lampWords, ...this.controls);
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
				if (!entry.old)
					this.lastAct = `${toolDoing(entry.name)}${entry.file && entry.name !== 'Bash' ? ` ${entry.file.split('/').pop()}` : ''}`;
				continue;
			}
			if (entry.kind === 'text' && !entry.old) this.lastAct = 'thinking what to say';

			this.did = null;
			if (entry.kind === 'prompt') {
				if (NUDGE.test(entry.text)) continue;
				// Already shown as it was sent from here
				const index = this.sent.indexOf(entry.text);

				if (this.pending?.text === entry.text) this.pending = null;
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

		// Each token the voice says lights as it's said, an emoji by its name (a word or a few) among them
		const owners = [];

		for (const paragraph of displayTokens(text)) {
			const line = element('p');

			for (const token of paragraph) {
				const span = element('span', token.emoji ? 'emoji' : 'word', token.text);

				if (token.spoken) {
					span.dataset.spoken = token.spoken;
					for (const _ of wordsOf(token.spoken)) owners.push(words.length);
					words.push(span);
				}
				line.append(span, ' ');
			}
			card.append(line);
		}
		card.words = words;
		card.spokenText = words.map(span => span.dataset.spoken).join(' ');
		card.lightWord = index => {
			const owner = index === -1 ? -1 : owners[index];

			words.forEach((span, at) => span.classList.toggle('lit', at === owner));
		};
		if (canSpeak() && words.length)
			card.prepend(
				button('', () => this.sayAgain(card), {
					icon: 'volume-high',
					className: 'say icon-only variant-flat',
					title: 'Say it again',
				}),
			);

		return card;
	}

	// The choice made, in the log as the kid's own words would be, with a way to choose differently: the game put back
	// to before Claude's answer to it, and Claude asked to ask again. Only the latest choice offers it, and only in an
	// arcade, where there are snapshots to put back.
	noteChoice(label) {
		const card = element('div', 'card you chosen');
		const { emoji, words } = splitEmoji(label);

		if (emoji) card.append(element('span', 'emoji', emoji), ' ');
		card.append(element('span', '', words));
		this.pickAgain?.remove();
		if (this.arcade && canType()) {
			this.pickAgain = button('Pick again', () => this.offerPickAgain(label), {
				icon: 'rotate-left',
				className: 'pick-again variant-flat',
				title: 'Put the game back to before this, and choose something else',
			});
			card.append(this.pickAgain);
		}
		this.feed.append(card);
		this.feed.scrollTop = this.feed.scrollHeight;
	}

	offerPickAgain(label) {
		if (this.status === 'working') {
			this.notice('Claude is still working on it. Wait for it to finish, then pick again', 'warning');

			return;
		}
		stopSpeaking();
		this.voice.clear();
		this.asked = 'pick-again';
		this.choices.replaceChildren(element('div', 'question', `Undo "${spokenText(label)}" and pick something else?`));

		const yes = button('', () => this.pickAgain_(label), { className: 'choice' });
		const no = button('', () => this.clearAsking(), { className: 'choice' });

		yes.append(element('span', 'emoji', '↩️'), element('span', 'label', 'Yes, pick again'));
		no.append(element('span', 'emoji', '✖️'), element('span', 'label', 'No, keep going'));
		this.choices.append(yes, no);
		this.choices.hidden = false;
		this.feed.scrollTop = this.feed.scrollHeight;
		if (this.prefs.speak) this.enqueue('Undo that and pick something else? Yes, pick again. No, keep going.');
	}

	async pickAgain_(label) {
		this.clearAsking();

		const { body, response } = await undoArcadeTurn(this.id);

		if (!response?.ok) {
			this.notice(typeof body === 'string' && body ? body : 'It could not be put back', 'warning');

			return;
		}
		this.pickAgain?.remove();
		this.pickAgain = null;
		this.sent.push(PICK_AGAIN_PROMPT);
		await sendPrompt(this.id, PICK_AGAIN_PROMPT);
		this.feed.append(element('div', 'card you', `Pick again instead of "${spokenText(label)}"`));
		this.feed.scrollTop = this.feed.scrollHeight;
		this.showStatus({ status: 'working' });
	}

	// A word to whoever is here, in the feed where they look, never a toast over the choices and the box
	notice(text, intent = 'info') {
		const card = element('div', `card notice ${intent}`);

		card.textContent = text;
		this.feed.append(card);
		this.feed.scrollTop = this.feed.scrollHeight;
	}

	// Reading aloud, in the order it arrived (sayQueue.js)

	enqueue(text, target) {
		this.voice.enqueue(text, target);
	}

	// A line asked for again, by its speaker button: said now, alone; whatever was queued waits for the next thing
	sayAgain(card) {
		this.voice.sayNow(card.spokenText, card);
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

		const question = element(
			'div',
			'question',
			player ? asking.questionText || asking.question : `${asking.title}: ${asking.question}`,
		);

		if (!player && asking.details.length) {
			const details = element('pre', 'details', asking.details.join('\n'));

			details.style.whiteSpace = 'pre-wrap';
			details.style.fontSize = '0.7em';
			question.append(details);
		}
		this.dismissed = new Set();
		this.shown = { question, player, asking };
		this.drawChoices();
		this.feed.scrollTop = this.feed.scrollHeight;
		// The first reading of a new question is what the player takes in before playing; readings after a tap are not
		this.restArmed = player;
		clearTimeout(this.restTimer);
		// Found already up on arrival: straight to the game, and the big button reads it when they're ready
		if (this.fresh) {
			this.fresh = false;
			if (player) this.rested();

			return;
		}
		if (player && this.prefs.speak) this.readShown();
		else if (player) this.restTimer = setTimeout(() => this.rested(), UNSPOKEN_REST_MS);
	}

	// Words sent while Claude worked that it hasn't taken up yet: a question up meanwhile is the end of the last
	// thing, about to be interrupted by them
	promptPending() {
		if (this.pending && Date.now() > this.pending.until) this.pending = null;

		return Boolean(this.pending);
	}

	// The question with its choices, those not dropped; for the player each tap opens the choice to confirm, and More
	// ideas asks Claude for a fresh set through the question's own typing option
	drawChoices() {
		const { question, player, asking } = this.shown;
		const options = asking.options.filter(option => !this.dismissed.has(option.key));

		this.choices.replaceChildren(question);
		for (const option of options) {
			const { emoji, words } = splitEmoji(option.label);
			const ownWords = player && asking.typing && OWN_WORDS.test(option.label);
			const choice = button(
				'',
				() => {
					if (ownWords) return this.askInOwnWords();
					if (player) return this.confirmChoice(option);

					return this.choose(option);
				},
				{ className: 'choice' },
			);
			const label = element('span', 'label');

			if (emoji) choice.append(element('span', 'emoji', emoji));
			label.append(element('span', 'words', words));
			// A grown-up's prompt shows its lines; a player hears a choice's detail once they tap it
			if (option.detail && !player) label.append(element('small', 'detail', option.detail));
			choice.append(label);
			this.choices.append(choice);
		}
		if (player && asking.typing) {
			const more = button('', () => this.moreIdeas(asking), { className: 'choice more-ideas' });

			more.append(element('span', 'emoji', '🎲'), element('span', 'label', 'More ideas'));
			this.choices.append(more);
		}
		this.choices.hidden = false;
	}

	// The headlines read, those still listed
	readShown() {
		if (!this.shown?.player || !this.prefs.speak) return;

		const { question, asking } = this.shown;

		this.readChoices(
			question,
			asking.options.filter(option => !this.dismissed.has(option.key)),
			{ more: Boolean(asking.typing) },
		);
	}

	// A choice tapped: what it would do, in full, read out, and a green yes or a red no. No drops it from the list.
	confirmChoice(option) {
		const { emoji, words } = splitEmoji(option.label);
		const card = element('div', 'confirm');
		const head = element('div', 'headline');
		const detail = element('div', 'detail', option.detail || '');
		const yes = button('', () => this.choose(option), { className: 'choice yes' });
		const no = button('', () => this.dropChoice(option), { className: 'choice no' });

		if (emoji) head.append(element('span', 'emoji', emoji), ' ');
		head.append(element('span', 'words', words));
		yes.append(element('span', 'emoji', '✅'), element('span', 'label', 'Yes, do it'));
		no.append(element('span', 'emoji', '✖️'), element('span', 'label', 'Not that one'));
		const yesNo = element('div', 'yes-no');

		yesNo.append(yes, no);
		card.append(head, detail, yesNo);
		this.choices.replaceChildren(card);
		this.feed.scrollTop = this.feed.scrollHeight;
		if (!this.prefs.speak) return;

		// Read in turn, each part lit while it's said: the headline, the detail, then the two answers
		const parts = [spokenText(option.label), spokenText(option.detail || ''), 'Yes, do it?', 'Or not that one.'];
		const owners = [];

		parts.forEach((part, index) => {
			for (const _ of wordsOf(part)) owners.push(index);
		});

		const targets = [head, detail, yes, no];
		const light = index => {
			const owner = index === -1 ? -1 : owners[index];

			targets.forEach((node, at) => node.classList.toggle('lit', owner === at));
		};

		this.voice.sayNow(parts.filter(Boolean).join(' '), { lightWord: light });
	}

	async choose(option) {
		const { asking } = this.shown;
		const answered = await answerAsking(this.id, asking.question, option.key);

		if (answered.response?.ok) {
			this.clearAsking();
			this.noteChoice(option.label);
			this.showStatus({ status: 'working' });
		} else this.notice('Claude is no longer asking that', 'warning');
	}

	dropChoice(option) {
		this.dismissed.add(option.key);
		this.drawChoices();
		this.feed.scrollTop = this.feed.scrollHeight;
		if (this.prefs.speak) this.readShown();
	}

	// The question and its choices read again, for whoever comes back to them
	readAsking() {
		this.readShown();
	}

	// Nothing left to say after a new question's first reading, and Claude waiting on the player: time to play
	rested() {
		if (!this.restArmed) return;
		this.restArmed = false;
		if (this.status === 'waiting' && this.asking && forPlayer(this.asking)) this.options.onRested?.();
	}

	async moreIdeas(asking) {
		const answered = await answerAsking(this.id, asking.question, asking.typing, MORE_IDEAS);

		if (!answered.response?.ok) return this.notice('Claude is no longer asking that', 'warning');
		this.clearAsking();
		this.feed.append(element('div', 'card you', '🎲 More ideas'));
		this.feed.scrollTop = this.feed.scrollHeight;
		this.showStatus({ status: 'working' });
	}

	// The question and each choice read in turn, each lit while it is said, so a kid learning to read hears which is
	// which: the question's words as spans, then the choices' buttons, one lit at a time
	readChoices(question, options, { more = false } = {}) {
		const parts = [spokenText(question.firstChild?.textContent ?? question.textContent)];
		const buttons = [...this.choices.querySelectorAll('button.choice')];

		for (const option of options) parts.push(spokenText(option.label));
		// Tacked on by the page, not one of Claude's, so it's read as an afterthought: "...a star. Or more ideas."
		if (more) parts.push('or more ideas');

		// Which part each spoken word belongs to, by the words' count
		const owners = [];

		parts.forEach((part, index) => {
			for (const _ of wordsOf(part)) owners.push(index);
		});

		const light = index => {
			const owner = index === -1 ? -1 : owners[index];

			question.classList.toggle('lit', owner === 0);
			buttons.forEach((choice, at) => choice.classList.toggle('lit', owner === at + 1));
		};

		this.enqueue(parts.join('. '), { lightWord: light });
	}

	clearAsking() {
		this.asking = null;
		this.shown = null;
		this.restArmed = false;
		clearTimeout(this.restTimer);
		if (this.asked === null) return;
		this.asked = null;
		this.choices.hidden = true;
		this.choices.replaceChildren();
	}

	// "My idea": the ear opens (or the box takes focus), and what comes answers the question in words
	askInOwnWords() {
		stopSpeaking();
		this.voice.clear();
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
		this.voice.clear();

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
		// Sent while Claude works, the words wait their turn: what comes next is the end of what it was doing, and a
		// question it ends with is kept from the player, since the words are about to interrupt it
		if (this.status === 'working' && !asking?.typing) {
			this.pending = { text: typed, until: Date.now() + PENDING_MS };
			this.notice('Claude is finishing the last thing first. This goes next.', 'info');
			if (this.prefs.speak) this.enqueue('Claude is finishing the last thing first. This goes next.');
		}
		this.feed.scrollTop = this.feed.scrollHeight;
		this.clearAsking();
		if (this.status !== 'working') this.showStatus({ status: 'working' });
	}

	toggleEar() {
		if (this.ear) {
			this.ear.stop();

			return;
		}
		stopSpeaking();
		this.voice.clear();
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
		this.voice.clear();
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
		this.showStatus({ status: 'working' });
		if (this.prefs.speak) this.enqueue("It's back the way it was.");
	}

	async restartClaude() {
		const confirmed = await confirmDialog({
			header: 'Restart Claude?',
			body: 'It stops what Claude is doing right now and starts it again in this same conversation, with its rules read fresh. The game keeps running.',
			confirmLabel: 'Restart',
		});

		if (!confirmed) return;
		this.notice('Restarting Claude…', 'info');

		const { body, response } = await restartSession(this.id);

		if (response?.ok) this.notice('Claude is back', 'info');
		else this.notice(typeof body === 'string' && body ? body : 'Claude could not be restarted', 'danger');
		this.clearAsking();
	}
}
