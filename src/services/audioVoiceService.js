import { SPEECH_STUCK_MS, SPEECH_WATCHDOG_MS, VOICE_COOLDOWN_MS } from "../core/constants.js";
import {
  ensureAudioContext,
  playCountdownTick,
  playParktronicBeep,
  playShutterSound,
  playVoiceFallbackTone
} from "./webAudioService.js";

export { ensureAudioContext, playCountdownTick, playParktronicBeep, playShutterSound };

let unlockInstalled = false;
let lastVoiceTime = 0;
let speechSeq = 0;
let activeSpeechStartAt = 0;
let ttsRuntimeUnsupported = false;
/** @type {SpeechSynthesis | null} */
let lastSynthRef = null;
/** @type {SpeechSynthesisUtterance | null} */
let activeUtterance = null;
/** @type {WeakSet<object>} */
const voicesSubscribedSynths = new WeakSet();
/** @type {ReturnType<typeof setTimeout> | null} */
let watchdogTimerId = null;
/** @type {(() => void) | null} */
let speechUnavailableHandler = null;

function clearWatchdog() {
  if (watchdogTimerId !== null) {
    clearTimeout(watchdogTimerId);
    watchdogTimerId = null;
  }
}

/** @param {SpeechSynthesis} synth */
function syncSynthInstance(synth) {
  if (lastSynthRef === synth) return;
  lastSynthRef = synth;
  ttsRuntimeUnsupported = false;
  activeSpeechStartAt = 0;
  activeUtterance = null;
  lastVoiceTime = 0;
  clearWatchdog();
}

/**
 * Поиск русского голоса: приоритет локальному/сетевому `ru-RU`, затем любому `ru*`.
 * @param {SpeechSynthesis} synth
 * @returns {{ voices: SpeechSynthesisVoice[], ruVoice: SpeechSynthesisVoice | null }}
 */
function findRussianVoice(synth) {
  const voices = typeof synth.getVoices === "function" ? synth.getVoices() : [];
  const ruVoices = voices.filter((v) => {
    const lang = v.lang ? v.lang.trim().toLowerCase().replace("_", "-") : "";
    return lang === "ru" || lang.startsWith("ru-");
  });
  ruVoices.sort((a, b) => {
    const aNorm = (a.lang || "").trim().toLowerCase().replace("_", "-");
    const bNorm = (b.lang || "").trim().toLowerCase().replace("_", "-");
    const aScore = (aNorm === "ru-ru" ? 2 : 0) + (a.localService ? 1 : 0);
    const bScore = (bNorm === "ru-ru" ? 2 : 0) + (b.localService ? 1 : 0);
    return bScore - aScore;
  });
  return { voices, ruVoice: ruVoices[0] || null };
}

/** @param {SpeechSynthesis} synth */
function ensureVoicesChangedListener(synth) {
  if (voicesSubscribedSynths.has(synth)) return;
  if (typeof synth.addEventListener !== "function") return;
  voicesSubscribedSynths.add(synth);
  synth.addEventListener(
    "voiceschanged",
    () => {
      findRussianVoice(synth);
    },
    { once: true }
  );
}

function notifySpeechUnavailable() {
  if (speechUnavailableHandler) {
    speechUnavailableHandler();
  }
}

/**
 * Возвращает активный экземпляр SpeechSynthesisUtterance (удерживаемый от GC до завершения).
 * @returns {SpeechSynthesisUtterance | null}
 */
export function getActiveUtterance() {
  return activeUtterance;
}

/**
 * Регистрирует коллбэк уведомления UI о недоступности или отсутствии русского TTS.
 * @param {(() => void) | null} handler
 * @returns {void}
 */
export function setSpeechUnavailableHandler(handler) {
  speechUnavailableHandler = handler;
}

/**
 * Синхронно запускает реплику через SpeechSynthesis с защитой от GC,
 * явными параметрами и watchdog 1500 мс.
 * @param {SpeechSynthesis} synth
 * @param {string} text
 * @param {number} rate
 * @param {SpeechSynthesisVoice | null} ruVoice
 * @returns {void}
 */
function dispatchUtterance(synth, text, rate, ruVoice) {
  const seq = ++speechSeq;
  clearWatchdog();

  const utt = new SpeechSynthesisUtterance(text);
  utt.volume = 1;
  utt.rate = rate;
  utt.pitch = 1;
  utt.lang = ruVoice?.lang || "ru-RU";
  if (ruVoice) utt.voice = ruVoice;
  activeUtterance = utt;

  const triggerFallback = () => {
    ttsRuntimeUnsupported = true;
    activeSpeechStartAt = 0;
    activeUtterance = null;
    clearWatchdog();
    notifySpeechUnavailable();
    playVoiceFallbackTone();
  };

  utt.onstart = () => {
    if (seq !== speechSeq) return;
    clearWatchdog();
  };
  utt.onend = () => {
    if (seq !== speechSeq) return;
    clearWatchdog();
    activeSpeechStartAt = 0;
    activeUtterance = null;
  };
  utt.onerror = (ev) => {
    if (seq !== speechSeq) return;
    clearWatchdog();
    activeSpeechStartAt = 0;
    activeUtterance = null;
    const errCode = ev && "error" in ev ? String(ev.error || "") : "";
    if (errCode === "canceled" || errCode === "interrupted") return;
    triggerFallback();
  };

  watchdogTimerId = setTimeout(() => {
    watchdogTimerId = null;
    if (seq !== speechSeq) return;
    try {
      if (typeof synth.cancel === "function") synth.cancel();
    } catch {
      /* ignore cancel errors on unsupported engines */
    }
    triggerFallback();
  }, SPEECH_WATCHDOG_MS);

  if (typeof synth.resume === "function") synth.resume();
  synth.speak(utt);
}

/**
 * Разблокировка мобильного TTS-движка. При `speakTest: true` (внутри клика по кнопке «Голос»)
 * синхронно проигрывает короткую русскую фразу `"Голос включён"` для разблокировки Android Chrome TTS.
 * @param {{ speakTest?: boolean }} [options]
 * @returns {{ supported: boolean, missingRussianVoice: boolean }}
 */
export function primeSpeechSynthesis(options = {}) {
  const speakTest = Boolean(options.speakTest);
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance === "undefined"
  ) {
    if (speakTest) {
      notifySpeechUnavailable();
      playVoiceFallbackTone();
    }
    return { supported: false, missingRussianVoice: false };
  }
  const synth = window.speechSynthesis;
  syncSynthInstance(synth);
  try {
    ensureVoicesChangedListener(synth);
    const { voices, ruVoice } = findRussianVoice(synth);
    const missingRussianVoice = voices.length > 0 && !ruVoice;
    if (speakTest) {
      if (ttsRuntimeUnsupported || missingRussianVoice) {
        notifySpeechUnavailable();
        playVoiceFallbackTone();
        return { supported: !ttsRuntimeUnsupported, missingRussianVoice };
      }
      dispatchUtterance(synth, "Голос включён", 1, ruVoice);
      return { supported: true, missingRussianVoice: false };
    }
    if (typeof synth.resume === "function") synth.resume();
    return {
      supported: !ttsRuntimeUnsupported,
      missingRussianVoice
    };
  } catch (err) {
    console.warn("SpeechSynthesis prime skipped:", err);
    if (speakTest) {
      ttsRuntimeUnsupported = true;
      activeUtterance = null;
      clearWatchdog();
      notifySpeechUnavailable();
      playVoiceFallbackTone();
    }
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
 * @param {number} now
 * @param {number} intervalMs
 * @returns {SpeakHintResult}
 */
function runFallbackToneWithCooldown(now, intervalMs) {
  notifySpeechUnavailable();
  if (now - lastVoiceTime < intervalMs) {
    return { ok: false, reason: "cooldown" };
  }
  lastVoiceTime = now;
  playVoiceFallbackTone();
  return { ok: true, fallback: "tone" };
}

/**
 * @typedef {Object} SpeakHintResult
 * @property {boolean} ok
 * @property {"disabled" | "unsupported" | "cooldown" | "busy" | "no_russian_voice" | "error"} [reason]
 * @property {"tone"} [fallback]
 */

/**
 * Голосовая подсказка на русском языке: без пустых/перекрывающихся cancel(),
 * с watchdog 1500 мс и Web Audio fallback при недоступном TTS.
 * @param {string} text
 * @param {boolean} enabled
 * @param {number} now
 * @param {number} [intervalMs]
 * @returns {SpeakHintResult}
 */
export function speakRussianHint(text, enabled, now, intervalMs = VOICE_COOLDOWN_MS) {
  if (!enabled || !text) return { ok: false, reason: "disabled" };
  if (typeof window === "undefined") return { ok: false, reason: "unsupported" };

  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    return runFallbackToneWithCooldown(now, intervalMs);
  }

  const synth = window.speechSynthesis;
  syncSynthInstance(synth);
  try {
    ensureVoicesChangedListener(synth);
    const { voices, ruVoice } = findRussianVoice(synth);
    if (ttsRuntimeUnsupported || (voices.length > 0 && !ruVoice)) {
      return runFallbackToneWithCooldown(now, intervalMs);
    }

    if (now - lastVoiceTime < intervalMs) {
      return { ok: false, reason: "cooldown" };
    }

    if (synth.speaking || synth.pending) {
      if (activeSpeechStartAt === 0) {
        activeSpeechStartAt = now;
      }
      if (now - activeSpeechStartAt < SPEECH_STUCK_MS) {
        return { ok: false, reason: "busy" };
      }
      clearWatchdog();
      activeSpeechStartAt = 0;
      if (typeof synth.cancel === "function") synth.cancel();
    }

    lastVoiceTime = now;
    activeSpeechStartAt = now;
    dispatchUtterance(synth, text, 1.05, ruVoice);
    return { ok: true };
  } catch (err) {
    console.warn("SpeechSynthesis skipped:", err);
    ttsRuntimeUnsupported = true;
    activeSpeechStartAt = 0;
    activeUtterance = null;
    clearWatchdog();
    notifySpeechUnavailable();
    playVoiceFallbackTone();
    return { ok: true, fallback: "tone" };
  }
}

/**
 * Остановка текущей речи и очистка watchdog-таймера.
 * @returns {void}
 */
export function cancelSpeech() {
  speechSeq += 1;
  activeSpeechStartAt = 0;
  activeUtterance = null;
  clearWatchdog();
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}
