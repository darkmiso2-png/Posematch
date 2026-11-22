import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelSpeech,
  getActiveUtterance,
  primeSpeechSynthesis,
  setSpeechUnavailableHandler,
  speakRussianHint
} from "../src/services/audioVoiceService.js";

function createFakeAudioCtx() {
  /** @type {unknown[]} */
  const oscillators = [];
  class FakeAudioContext {
    constructor() {
      this.state = "running";
      this.currentTime = 0;
      this.destination = {};
    }
    resume() {
      return Promise.resolve();
    }
    createOscillator() {
      const osc = {
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn()
      };
      oscillators.push(osc);
      return osc;
    }
    createGain() {
      return {
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn()
      };
    }
  }
  return { FakeAudioContext, oscillators };
}

/**
 * @param {{
 *   voices?: { lang: string, name?: string, localService?: boolean }[],
 *   speaking?: boolean
 * }} [opts]
 */
function installFakeTts(opts = {}) {
  const voices = opts.voices ?? [];
  const addEventListener = vi.fn();
  const speak = vi.fn();
  const cancel = vi.fn();
  const resume = vi.fn();
  const synth = {
    speaking: opts.speaking ?? false,
    pending: false,
    getVoices: vi.fn(() => voices),
    addEventListener,
    speak,
    cancel,
    resume
  };
  class FakeUtterance {
    /** @param {string} text */
    constructor(text) {
      this.text = text;
      this.lang = "";
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      /** @type {unknown} */
      this.voice = null;
      /** @type {(() => void) | null} */
      this.onstart = null;
      /** @type {(() => void) | null} */
      this.onend = null;
      /** @type {((ev: { error?: string }) => void) | null} */
      this.onerror = null;
    }
  }
  const { FakeAudioContext, oscillators } = createFakeAudioCtx();
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("window", { speechSynthesis: synth, AudioContext: FakeAudioContext });
  return { synth, speak, cancel, resume, addEventListener, oscillators };
}

describe("BUG-M3 audioVoiceService Android TTS GC-guard, gesture priming and fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    setSpeechUnavailableHandler(null);
    cancelSpeech();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("primes silently on pointerdown without speaking", () => {
    const { synth, speak, resume, addEventListener } = installFakeTts({
      voices: [{ lang: "en-US" }],
      speaking: false
    });
    expect(primeSpeechSynthesis()).toEqual({ supported: true, missingRussianVoice: true });
    expect(primeSpeechSynthesis()).toEqual({ supported: true, missingRussianVoice: true });
    expect(synth.getVoices).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledTimes(2);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith("voiceschanged", expect.any(Function), {
      once: true
    });
    expect(speak).not.toHaveBeenCalled();
    expect(getActiveUtterance()).toBeNull();
  });

  it("speaks 'Голос включён' synchronously on primeSpeechSynthesis({ speakTest: true })", () => {
    const ruGeneric = { lang: "ru", name: "Generic RU", localService: false };
    const ruRuVoice = { lang: "ru-RU", name: "Russian Local", localService: true };
    const { speak, resume } = installFakeTts({
      voices: [{ lang: "en-US" }, ruGeneric, ruRuVoice],
      speaking: false
    });

    expect(primeSpeechSynthesis({ speakTest: true })).toEqual({
      supported: true,
      missingRussianVoice: false
    });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledTimes(1);

    const utt = speak.mock.calls[0][0];
    expect(utt.text).toBe("Голос включён");
    expect(utt.volume).toBe(1);
    expect(utt.rate).toBe(1);
    expect(utt.pitch).toBe(1);
    expect(utt.lang).toBe("ru-RU");
    expect(utt.voice).toBe(ruRuVoice);
    expect(getActiveUtterance()).toBe(utt);

    utt.onstart?.();
    expect(getActiveUtterance()).toBe(utt);

    utt.onend?.();
    expect(getActiveUtterance()).toBeNull();
  });

  it("triggers Web Audio fallback and handler when primeSpeechSynthesis({ speakTest: true }) hits watchdog or missing ru voice", async () => {
    const t1 = installFakeTts({ voices: [], speaking: false });
    const onUnavailable = vi.fn();
    setSpeechUnavailableHandler(onUnavailable);

    expect(primeSpeechSynthesis({ speakTest: true })).toEqual({
      supported: true,
      missingRussianVoice: false
    });
    expect(getActiveUtterance()).toBe(t1.speak.mock.calls[0][0]);

    await vi.advanceTimersByTimeAsync(1500);
    expect(getActiveUtterance()).toBeNull();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(t1.cancel).toHaveBeenCalledTimes(1);
    expect(t1.oscillators).toHaveLength(2);

    const t2 = installFakeTts({ voices: [{ lang: "en-US" }], speaking: false });
    const onMissing = vi.fn();
    setSpeechUnavailableHandler(onMissing);
    expect(primeSpeechSynthesis({ speakTest: true })).toEqual({
      supported: true,
      missingRussianVoice: true
    });
    expect(t2.speak).not.toHaveBeenCalled();
    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(t2.oscillators).toHaveLength(2);
  });

  it("retains activeUtterance until onend/onerror/cancelSpeech and sets explicit hint params", () => {
    const ruVoice = { lang: "ru-RU", name: "Russian", localService: true };
    const { speak } = installFakeTts({ voices: [ruVoice], speaking: false });

    expect(speakRussianHint("Поднимите локоть", true, 5000)).toEqual({ ok: true });
    const utt = speak.mock.calls[0][0];
    expect(utt.volume).toBe(1);
    expect(utt.rate).toBe(1.05);
    expect(utt.pitch).toBe(1);
    expect(utt.lang).toBe("ru-RU");
    expect(utt.voice).toBe(ruVoice);

    expect(getActiveUtterance()).toBe(utt);
    utt.onstart?.();
    expect(getActiveUtterance()).toBe(utt);

    cancelSpeech();
    expect(getActiveUtterance()).toBeNull();

    expect(speakRussianHint("Снизьте плечо", true, 9000)).toEqual({ ok: true });
    const utt2 = speak.mock.calls[1][0];
    expect(getActiveUtterance()).toBe(utt2);
    utt2.onerror?.({ error: "canceled" });
    expect(getActiveUtterance()).toBeNull();
  });

  it("returns busy when speaking < 4000ms without cancel, and resets stuck speaking >= 4000ms", () => {
    const ruVoice = { lang: "ru-RU", name: "Russian" };
    const { synth, speak, cancel } = installFakeTts({ voices: [ruVoice], speaking: false });

    expect(speakRussianHint("Поднимите локоть", true, 5000)).toEqual({ ok: true });
    expect(speak).toHaveBeenCalledTimes(1);
    speak.mock.calls[0][0].onstart?.();

    synth.speaking = true;
    expect(speakRussianHint("Ниже плечи", true, 8500)).toEqual({ ok: false, reason: "busy" });
    expect(cancel).not.toHaveBeenCalled();

    expect(speakRussianHint("Ниже плечи", true, 9200)).toEqual({ ok: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledTimes(2);

    synth.speaking = false;
    speak.mock.calls[1][0].onend?.();
    expect(speakRussianHint("Отлично", true, 13000)).toEqual({ ok: true });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("triggers Web Audio fallback on speakRussianHint watchdog 1500ms or onerror", async () => {
    const t1 = installFakeTts({ voices: [], speaking: false });
    const onUnavailable = vi.fn();
    setSpeechUnavailableHandler(onUnavailable);

    expect(speakRussianHint("Выровняйте корпус", true, 5000)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(1500);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(t1.cancel).toHaveBeenCalledTimes(1);
    expect(t1.oscillators).toHaveLength(2);
    expect(primeSpeechSynthesis().supported).toBe(false);
    expect(speakRussianHint("Повтор", true, 9000)).toEqual({ ok: true, fallback: "tone" });
    expect(t1.oscillators).toHaveLength(4);

    const t2 = installFakeTts({ voices: [{ lang: "ru-RU" }], speaking: false });
    const onErrUnavailable = vi.fn();
    setSpeechUnavailableHandler(onErrUnavailable);
    expect(speakRussianHint("Поднимите руку", true, 5000)).toEqual({ ok: true });
    t2.speak.mock.calls[0][0].onerror?.({ error: "synthesis-unavailable" });
    expect(onErrUnavailable).toHaveBeenCalledTimes(1);
    expect(t2.oscillators).toHaveLength(2);
  });
});
