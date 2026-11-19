import { VOICE_COOLDOWN_MS } from "../core/constants.js";
import { clamp } from "../core/poseMath.js";

/** @type {AudioContext | null} */
let audioCtx = null;
let lastBeepTime = 0;
let lastVoiceTime = 0;

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
 * Звуковой «Парктроник»: частота и частота пиков растут с ростом процента совпадения.
 * @param {number} score
 * @param {number} threshold
 * @param {boolean} enabled
 * @param {number} now
 * @returns {void}
 */
export function playParktronicBeep(score, threshold, enabled, now) {
  if (!enabled || score < 35) return;
  const t = clamp((score - 35) / 65, 0, 1);
  const interval = 950 - t * 830;
  if (now - lastBeepTime < interval) return;
  lastBeepTime = now;

  const ctx = ensureAudioContext();
  if (!ctx || ctx.state !== "running") return;

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
 * Голосовая подсказка на русском языке с защитой от наложения.
 * @param {string} text
 * @param {boolean} enabled
 * @param {number} now
 * @param {number} [intervalMs]
 * @returns {void}
 */
export function speakRussianHint(text, enabled, now, intervalMs = VOICE_COOLDOWN_MS) {
  if (!enabled || !text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (now - lastVoiceTime < intervalMs) return;
  if (window.speechSynthesis.speaking) return;

  lastVoiceTime = now;
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "ru-RU";
  utt.rate = 1.05;
  const voices = window.speechSynthesis.getVoices();
  const ruVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("ru"));
  if (ruVoice) utt.voice = ruVoice;
  window.speechSynthesis.speak(utt);
}

/**
 * Остановка текущей речи.
 * @returns {void}
 */
export function cancelSpeech() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
