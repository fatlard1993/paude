// The browser's own voice and ear, behind two small doors, so a better voice (a server-side one) can stand in the same
// doorway later: speak(text) says it and reports each word as it's reached; listen() hears a sentence and hands it
// back. Both say when the browser can't.

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const MARKS = /[*_`#>~]+/g;

// A text as it should be heard: no markdown's marks, no emoji (a voice names them), links as their words
export const spokenText = text =>
	String(text ?? '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/```[\s\S]*?```/g, ' code ')
		.replace(MARKS, '')
		.replace(EMOJI, '')
		.replace(/\s+/g, ' ')
		.trim();

// The words of a text, each with where it starts in the text, for lighting the one being said
export const wordsOf = text => {
	const words = [];

	for (const match of text.matchAll(/\S+/g)) words.push({ word: match[0], at: match.index });

	return words;
};

const EMOJI_RUN = /\p{Extended_Pictographic}\u{FE0F}?(?:\u{200D}\p{Extended_Pictographic}\u{FE0F}?)*/gu;

// A text as the arcade shows it: paragraphs of tokens, each a word or one emoji (its own token, however it was
// written), the words being exactly what speak() is given, in order, so a boundary event lights the token it's at
export const displayTokens = text =>
	String(text ?? '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/```[\s\S]*?```/g, ' code ')
		.replace(MARKS, '')
		.split(/\n\s*\n/)
		.map(paragraph =>
			paragraph
				.replace(EMOJI_RUN, ' $& ')
				.split(/\s+/)
				.filter(Boolean)
				.map(token => ({ text: token, emoji: token.replace(EMOJI, '') === '' })),
		)
		.filter(paragraph => paragraph.length);

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export const canListen = () =>
	typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

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

let current = null;

// Says `text` aloud. onWord(index) as each word is reached (by the browser's boundary events, when it gives them);
// onEnd() when done or stopped. Returns { stop }. Speaking again stops what was being said.
export const speak = (text, { rate = 0.95, onWord, onEnd } = {}) => {
	stopSpeaking();
	if (!canSpeak()) {
		onEnd?.();

		return { stop() {} };
	}

	const spoken = spokenText(text);
	const words = wordsOf(spoken);
	const utterance = new SpeechSynthesisUtterance(spoken);
	let ended = false;
	const finish = () => {
		if (ended) return;
		ended = true;
		if (current === utterance) current = null;
		onEnd?.();
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
	current = utterance;
	// Chrome needs the voices loaded before the first utterance picks one
	if (!utterance.voice && speechSynthesis.getVoices().length === 0)
		speechSynthesis.addEventListener('voiceschanged', () => (utterance.voice = pickVoice()), { once: true });
	speechSynthesis.speak(utterance);

	return { stop: finish };
};

export const stopSpeaking = () => {
	if (!canSpeak()) return;
	current = null;
	speechSynthesis.cancel();
};

export const isSpeaking = () => canSpeak() && speechSynthesis.speaking;

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
