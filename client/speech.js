import { spokenText, wordsOf } from '../shared/spoken';
import { hear, readAloud } from './api';

export { displayTokens, spokenText, wordsOf } from '../shared/spoken';

// Reading aloud and listening, behind two small doors. speak(text) says it and reports each word as it's reached:
// with this paude's own voice (ElevenLabs, through the server, timed word by word) when it has one, and the
// browser's otherwise. listen() hears a sentence and hands it back. Both say when they can't.

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

// Whether the server has a voice, and an ear: unknown until first asked, then remembered for the page
let serverVoice = null;
let serverEar = null;

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

// A line the browser refused to play because nothing on the page has been pressed yet (its rule for sound): kept,
// and said on the first press. One at a time: the queue waits on it, so the lines after it follow in order.
const PRESSES = ['pointerdown', 'keydown'];
let heldBack = null;

const onPress = () => {
	const held = heldBack;

	heldBack = null;
	for (const type of PRESSES) document.removeEventListener(type, onPress, true);
	held?.();
};

const sayOnFirstPress = replay => {
	if (!heldBack) for (const type of PRESSES) document.addEventListener(type, onPress, true);
	heldBack = replay;
};

const letGo = replay => {
	if (heldBack !== replay || !replay) return;
	heldBack = null;
	for (const type of PRESSES) document.removeEventListener(type, onPress, true);
};

const browserVoice = (spoken, words, { rate, onWord, onEnd }) => {
	if (!canSpeak()) {
		onEnd?.();

		return { stop() {} };
	}

	const utterance = new SpeechSynthesisUtterance(spoken);
	let ended = false;
	let replay = null;
	const finish = () => {
		if (ended) return;
		ended = true;
		onEnd?.();
	};
	const saying = {
		stop() {
			if (ended) return;
			letGo(replay);
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
	utterance.onerror = event => {
		if (event?.error !== 'not-allowed' || ended) return finish();
		replay = () => speechSynthesis.speak(utterance);
		sayOnFirstPress(replay);
	};
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
	let replay = null;
	const finish = () => {
		if (ended) return;
		ended = true;
		cancelAnimationFrame(frame);
		onEnd?.();
	};
	const saying = {
		stop() {
			if (ended) return;
			letGo(replay);
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

	const start = () => player.play().then(() => follow());

	start().catch(error => {
		if (error?.name !== 'NotAllowedError' || ended) return finish();
		replay = () => start().catch(finish);
		sayOnFirstPress(replay);
	});

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

const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
// Sound above this (RMS of the waveform) is someone talking; quiet this long after talking ends the recording, and
// nothing said at all gives up sooner
const TALKING = 0.02;
const QUIET_AFTER_MS = 1400;
const NOTHING_SAID_MS = 7000;
const LONGEST_MS = 20_000;

const canRecord = () =>
	typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

// The server's ear: the microphone recorded until the talking stops, then sent to be heard. onThinking() once the
// recording is on its way; onHeard(text, true) with what was said.
const recordAndHear = (session, { onHeard, onThinking, onEnd }) => {
	let recorder = null;
	let stream = null;
	let context = null;
	let ended = false;
	let spoke = false;
	const timers = [];
	const finish = reason => {
		if (ended) return;
		ended = true;
		for (const timer of timers) clearTimeout(timer);
		stream?.getTracks().forEach(track => track.stop());
		context?.close().catch(() => {});
		onEnd?.(reason);
	};
	const stopRecording = () => {
		if (recorder?.state === 'recording') recorder.stop();
		else finish('nothing');
	};

	navigator.mediaDevices
		.getUserMedia({ audio: true })
		.then(got => {
			if (ended) {
				got.getTracks().forEach(track => track.stop());

				return;
			}
			stream = got;

			const type = RECORDING_TYPES.find(candidate => MediaRecorder.isTypeSupported(candidate));
			const chunks = [];

			recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
			recorder.ondataavailable = event => event.data.size && chunks.push(event.data);
			recorder.onstop = async () => {
				if (ended) return;
				if (!spoke) return finish('nothing');
				onThinking?.();

				const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
				const { body, response } = await hear(session, blob).catch(() => ({}));

				if (response?.status === 404) serverEar = false;

				const text = response?.ok ? (body?.text ?? '') : '';
				const heardNothing = response?.ok || response?.status === 404;

				if (text) onHeard?.(text, true);
				if (text) finish('done');
				else finish(heardNothing ? 'nothing' : 'failed');
			};
			recorder.start(250);

			// Listening for the talking to stop
			context = new (window.AudioContext || window.webkitAudioContext)();

			const analyser = context.createAnalyser();
			const samples = new Uint8Array(1024);
			let quietSince = null;

			analyser.fftSize = samples.length;
			context.createMediaStreamSource(stream).connect(analyser);

			const watch = () => {
				if (ended || recorder.state !== 'recording') return;
				analyser.getByteTimeDomainData(samples);

				let energy = 0;

				for (const sample of samples) energy += ((sample - 128) / 128) ** 2;

				const now = performance.now();

				if (Math.sqrt(energy / samples.length) > TALKING) {
					spoke = true;
					quietSince = null;
				} else if (spoke) {
					quietSince ??= now;
					if (now - quietSince > QUIET_AFTER_MS) return recorder.stop();
				}
				requestAnimationFrame(watch);
			};

			watch();
			timers.push(setTimeout(() => !spoke && stopRecording(), NOTHING_SAID_MS));
			timers.push(setTimeout(stopRecording, LONGEST_MS));
		})
		.catch(error =>
			finish(error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? 'denied' : 'nothing'),
		);

	return { stop: stopRecording };
};

// The browser's own recognition, where it has one
const browserEar = ({ onHeard, onEnd }) => {
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

export const canListen = () =>
	typeof window !== 'undefined' && Boolean(canRecord() || window.SpeechRecognition || window.webkitSpeechRecognition);

// Hears one thing said. onHeard(text, final) as words come in (the browser's ear) or once with what was said (the
// server's); onThinking() while the server's ear works; onEnd(reason) when it stops: 'done', 'nothing' (silence),
// 'failed' (the ear couldn't), 'denied' (the microphone), or 'unsupported'. Returns { stop }. `session` names the
// session whose paude may have an ear; without it, or once it's known not to, the browser's own is used.
export const listen = ({ onHeard, onThinking, onEnd, session } = {}) => {
	if (session && serverEar !== false && canRecord()) return recordAndHear(session, { onHeard, onThinking, onEnd });

	return browserEar({ onHeard, onEnd });
};
