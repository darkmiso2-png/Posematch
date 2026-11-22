import { SPEECH_CANCEL_DELAY_MS, VOICE_COOLDOWN_MS } from "../core/constants.js";
import { clamp } from "../core/poseMath.js";

/** @type {AudioContext | null} */
let audioCtx = null;
let unlockInstalled = false;
let lastBeepTime = 0;
let lastVoiceTime = 0;
let speechSeq = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let speechTimerId = null;

/**
 * Ленивая инициализация и разблокировка AudioContext после жеста пользователя.
 * @returns {AudioContext | null}
 */
export function ensureAudioContext() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      /** @type {Window & { webkitAudioContext?: typeof AudioContext }} */ (window)
        .webkitAudioContext;
    if (Ctor) audioCtx = new Ctor();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * @param {SpeechSynthesis} synth
 * @returns {{ voices: SpeechSynthesisVoice[], ruVoice: SpeechSynthesisVoice | null }}
 */
function findRussianVoice(synth) {
  const voices = typeof synth.getVoices === "function" ? synth.getVoices() : [];
  const ruVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("ru")) || null;
  return { voices, ruVoice };
}

/**
 * Разблокировка мобильного TTS-движка (SpeechSynthesis) внутри пользовательского жеста.
 * @returns {{ supported: boolean, missingRussianVoice: boolean }}
 */
export function primeSpeechSynthesis() {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance === "undefined"
  ) {
    return { supported: false, missingRussianVoice: false };
  }
  const synth = window.speechSynthesis;
  try {
    const { voices, ruVoice } = findRussianVoice(synth);
    if (typeof synth.resume === "function") synth.resume();
    const blank = new SpeechSynthesisUtterance("");
    blank.lang = "ru-RU";
    if (ruVoice) blank.voice = ruVoice;
    blank.volume = 0;
    synth.speak(blank);
    return {
      supported: true,
      missingRussianVoice: voices.length > 0 && !ruVoice
    };
  } catch (err) {
    console.warn("SpeechSynthesis prime skipped:", err);
    return { supported: false, missingRussianVoice: false };
  }
}

/**
 * Одноразовая разблокировка AudioContext и SpeechSynthesis по первому жесту pointerdown.
 * @returns {void}
 */
export function installAudioUnlockListener() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  window.addEventListener(
    "pointerdown",
    () => {
      ensureAudioContext();
      primeSpeechSynthesis();
    },
    { once: true, passive: true }
  );
}

/**
 * Звуковой «Парктроник»: частота и частота пиков растут с ростом процента совпадения.
 * Не создает и не разблокирует AudioContext без жеста пользователя.
 * @param {number} score
 * @param {number} threshold
 * @param {boolean} enabled
 * @param {number} now
 * @returns {void}
 */
export function playParktronicBeep(score, threshold, enabled, now) {
  if (!enabled || score < 35) return;
  if (!audioCtx || audioCtx.state !== "running") return;
  const t = clamp((score - 35) / 65, 0, 1);
  const interval = 950 - t * 830;
  if (now - lastBeepTime < interval) return;
  lastBeepTime = now;

  const ctx = audioCtx;

  const freq = 380 + t * 770;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = score >= threshold ? "triangle" : "sine";
  osc.frequency.setValueAtTime(freq, ctx.currentTime);

  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.11, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.075);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.08);
}

/**
 * Синтез звука щелчка затвора камеры.
 * @returns {void}
 */
export function playShutterSound() {
  const ctx = ensureAudioContext();
  if (!ctx || ctx.state !== "running") return;

  const bufferSize = Math.floor(ctx.sampleRate * 0.09);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1900, ctx.currentTime);
  filter.Q.setValueAtTime(1.2, ctx.currentTime);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.38, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(ctx.currentTime);

  const clickOsc = ctx.createOscillator();
  const clickGain = ctx.createGain();
  clickOsc.type = "triangle";
  clickOsc.frequency.setValueAtTime(240, ctx.currentTime);
  clickOsc.frequency.exponentialRampToValueAtTime(75, ctx.currentTime + 0.05);
  clickGain.gain.setValueAtTime(0.25, ctx.currentTime);
  clickGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.055);
  clickOsc.connect(clickGain);
  clickGain.connect(ctx.destination);
  clickOsc.start(ctx.currentTime);
  clickOsc.stop(ctx.currentTime + 0.06);
}

/**
 * Короткий пик обратного отсчета (3..2..1).
 * @returns {void}
 */
export function playCountdownTick() {
  const ctx = ensureAudioContext();
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(660, ctx.currentTime);
  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.11);
}

/**
 * @typedef {Object} SpeakHintResult
 * @property {boolean} ok
 * @property {"disabled" | "unsupported" | "cooldown" | "no_russian_voice" | "error"} [reason]
 */

/**
 * Голосовая подсказка на русском языке с защитой от гонки cancel()+speak() на Android.
 * @param {string} text
 * @param {boolean} enabled
 * @param {number} now
 * @param {number} [intervalMs]
 * @returns {SpeakHintResult}
 */
export function speakRussianHint(text, enabled, now, intervalMs = VOICE_COOLDOWN_MS) {
  if (!enabled || !text) return { ok: false, reason: "disabled" };
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance === "undefined"
  ) {
    return { ok: false, reason: "unsupported" };
  }

  const synth = window.speechSynthesis;
  try {
    const { voices, ruVoice } = findRussianVoice(synth);
    if (voices.length > 0 && !ruVoice) {
      return { ok: false, reason: "no_russian_voice" };
    }
    if (now - lastVoiceTime < intervalMs) {
      return { ok: false, reason: "cooldown" };
    }

    lastVoiceTime = now;
    const seq = ++speechSeq;
    if (speechTimerId !== null) {
      clearTimeout(speechTimerId);
      speechTimerId = null;
    }

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "ru-RU";
    utt.rate = 1.05;
    if (ruVoice) utt.voice = ruVoice;

    const dispatchSpeak = () => {
      if (seq !== speechSeq) return;
      if (typeof synth.resume === "function") synth.resume();
      synth.speak(utt);
    };

    if (synth.speaking || synth.pending) {
      synth.cancel();
      speechTimerId = setTimeout(() => {
        speechTimerId = null;
        dispatchSpeak();
      }, SPEECH_CANCEL_DELAY_MS);
    } else {
      dispatchSpeak();
    }
    return { ok: true };
  } catch (err) {
    console.warn("SpeechSynthesis skipped:", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Остановка текущей речи и отмена отложенной реплики.
 * @returns {void}
 */
export function cancelSpeech() {
  speechSeq += 1;
  if (speechTimerId !== null) {
    clearTimeout(speechTimerId);
    speechTimerId = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
