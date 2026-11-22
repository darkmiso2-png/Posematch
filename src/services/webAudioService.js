import { clamp } from "../core/poseMath.js";

/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {typeof AudioContext | null} */
let lastAudioCtor = null;
let lastBeepTime = 0;

/**
 * Ленивая инициализация и разблокировка AudioContext после жеста пользователя.
 * @returns {AudioContext | null}
 */
export function ensureAudioContext() {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    /** @type {Window & { webkitAudioContext?: typeof AudioContext }} */ (window)
      .webkitAudioContext ||
    null;
  if (!Ctor) return null;
  if (!audioCtx || lastAudioCtor !== Ctor) {
    audioCtx = new Ctor();
    lastAudioCtor = Ctor;
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
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
 * Мягкий двухтоновый Web Audio сигнал для fallback-озвучки подсказки.
 * @returns {void}
 */
export function playVoiceFallbackTone() {
  const ctx = ensureAudioContext();
  if (!ctx || ctx.state !== "running") return;
  const start = ctx.currentTime;
  const tones = [
    { freq: 520, offset: 0, dur: 0.065 },
    { freq: 660, offset: 0.075, dur: 0.075 }
  ];
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(tone.freq, start + tone.offset);
    gain.gain.setValueAtTime(0.0001, start + tone.offset);
    gain.gain.exponentialRampToValueAtTime(0.055, start + tone.offset + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.offset + tone.dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start + tone.offset);
    osc.stop(start + tone.offset + tone.dur + 0.01);
  }
}
