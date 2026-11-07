import { spokenText, wordsOf } from '../shared/spoken';
import { readAloud } from './api';

export { displayTokens, spokenText, wordsOf } from '../shared/spoken';

// Reading aloud and listening, behind two small doors. speak(text) says it and reports each word as it's reached:
// with this paude's own voice (ElevenLabs, through the server, timed word by word) when it has one, and the
// browser's otherwise. listen() hears a sentence and hands it back. Both say when they can't.

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export const canListen = () =>
	typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

// Whether the server has a voice: unknown until first asked, then remembered for the page
let serverVoice = null;

// A voice that reads naturally in the page's language, the system's own if it has one
const pickVoice = () => {
	const voices = speechSynthesis.getVoices();
	const language = (navigator.language || 'en').toLowerCase();
	const ours = voices.filter(voice => voice.lang.toLowerCase().startsWith(language.slice(0, 2)));

	return (
		ours.find(voice => /natural|neural|premium|enhanced/i.test(voice.name)) ??
		ours.find(voice => voice.localService) ??
		ours[0] ??
		null
	);
};

// What's being said now, whichever voice says it: { stop }
let current = null;

const browserVoice = (spoken, words, { rate, onWord, onEnd }) => {
	if (!canSpeak()) {
		onEnd?.();

		return { stop() {} };
	}

	const utterance = new SpeechSynthesisUtterance(spoken);
	let ended = false;
	const finish = () => {
		if (ended) return;
		ended = true;
		onEnd?.();
	};
	const saying = {
		stop() {
			if (ended) return;
			speechSynthesis.cancel();
			finish();
		},
	};

	utterance.rate = rate;
	utterance.voice = pickVoice();
	utterance.onboundary = event => {
		if (event.name && event.name !== 'word') return;

		let index = -1;

		for (let i = 0; i < words.length && words[i].at <= event.charIndex; i++) index = i;
		if (index !== -1) onWord?.(index);
	};
	utterance.onend = finish;
	utterance.onerror = finish;
	// Chrome needs the voices loaded before the first utterance picks one
	if (!utterance.voice && speechSynthesis.getVoices().length === 0)
		speechSynthesis.addEventListener('voiceschanged', () => (utterance.voice = pickVoice()), { once: true });
	speechSynthesis.speak(utterance);

	return saying;
};

// The server's voice, as audio with a start time per word; null when it has none or couldn't this time
const fetchServerVoice = async (session, spoken) => {
	if (serverVoice === false) return null;

	const { body, response } = await readAloud(session, spoken);

	if (response?.status === 404) serverVoice = false;
	if (!response?.ok || !body?.audio) return null;
	serverVoice = true;

	return body;
};

const playServerVoice = ({ audio, words }, { onWord, onEnd }) => {
	const player = new Audio(`data:audio/mpeg;base64,${audio}`);
	let ended = false;
	let frame = null;
	let lit = -1;
	const finish = () => {
		if (ended) return;
		ended = true;
		cancelAnimationFrame(frame);
		onEnd?.();
	};
	const saying = {
		stop() {
			if (ended) return;
			player.pause();
			finish();
		},
	};
	const follow = () => {
		if (ended) return;

		const now = player.currentTime;
		let index = lit;

		while (index + 1 < words.length && words[index + 1].start <= now) index += 1;
		if (index !== lit) {
			lit = index;
			onWord?.(index);
		}
		frame = requestAnimationFrame(follow);
	};

	player.addEventListener('ended', finish);
	player.addEventListener('error', finish);
	player
		.play()
		.then(() => follow())
		// Not allowed yet (nothing pressed on the page so far): said when the next press lets it
		.catch(finish);

	return saying;
};

// Says `text` aloud. onWord(index) as each word is reached, onEnd() when done or stopped. Returns { stop }. Speaking
// again stops what was being said. `session` names the session whose paude may have a voice; without it, the
// browser's is used.
export const speak = (text, { rate = 0.95, onWord, onEnd, session } = {}) => {
	const spoken = spokenText(text);
	const words = wordsOf(spoken);
	let stopped = false;
	let inner = null;
	const saying = {
		stop() {
			if (stopped) return;
			stopped = true;
			if (current === saying) current = null;
			inner?.stop();
		},
	};
	const done = () => {
		if (current === saying) current = null;
		onEnd?.();
	};

	current?.stop();
	if (!spoken) {
		onEnd?.();

		return saying;
	}
	current = saying;

	if (!session || serverVoice === false) {
		inner = browserVoice(spoken, words, { rate, onWord, onEnd: done });

		return saying;
	}

	fetchServerVoice(session, spoken)
		.catch(() => null)
		.then(voiced => {
			if (stopped) return;
			inner = voiced
				? playServerVoice(voiced, { onWord, onEnd: done })
				: browserVoice(spoken, words, { rate, onWord, onEnd: done });
		});

	return saying;
};

export const stopSpeaking = () => {
	current?.stop();
	current = null;
	if (canSpeak()) speechSynthesis.cancel();
};

export const isSpeaking = () => current !== null;

// Hears one thing said. onHeard(text, final) as words come in and once more with final true; onEnd(reason) when it
// stops: 'done', 'nothing' (silence), 'denied' (the microphone), or 'unsupported'. Returns { stop }.
export const listen = ({ onHeard, onEnd } = {}) => {
	const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

	if (!Recognition) {
		onEnd?.('unsupported');

		return { stop() {} };
	}

	const recognition = new Recognition();
	let heard = '';
	let ended = false;
	const finish = reason => {
		if (ended) return;
		ended = true;
		onEnd?.(reason);
	};

	recognition.lang = navigator.language || 'en-US';
	recognition.interimResults = true;
	recognition.maxAlternatives = 1;
	recognition.onresult = event => {
		heard = [...event.results].map(result => result[0].transcript).join(' ');
		onHeard?.(
			heard,
			[...event.results].every(result => result.isFinal),
		);
	};
	recognition.onerror = event =>
		finish(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'denied' : 'nothing');
	recognition.onend = () => finish(heard.trim() ? 'done' : 'nothing');

	try {
		recognition.start();
	} catch {
		finish('nothing');
	}

	return {
		stop() {
			try {
				recognition.stop();
			} catch {
				finish(heard.trim() ? 'done' : 'nothing');
			}
		},
	};
};
