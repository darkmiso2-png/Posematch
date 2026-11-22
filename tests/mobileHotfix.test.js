import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inferFacingModeFromDevice } from "../src/core/cameraHudLogic.js";
import {
  cancelSpeech,
  primeSpeechSynthesis,
  setSpeechUnavailableHandler,
  speakRussianHint
} from "../src/services/audioVoiceService.js";
import {
  startCameraStream,
  stopCameraStream,
  stopStreamTracks
} from "../src/services/cameraService.js";

/**
 * @param {{ deviceId?: string, facingMode?: string, label?: string }} [opts]
 */
function createFakeStream(opts = {}) {
  const stop = vi.fn();
  const removeEventListener = vi.fn();
  const addEventListener = vi.fn();
  const track = {
    stop,
    label: opts.label ?? "Front Camera",
    onended: /** @type {(() => void) | null} */ (() => {}),
    addEventListener,
    removeEventListener,
    getSettings: () => ({
      deviceId: opts.deviceId ?? "dev-1",
      facingMode: opts.facingMode ?? "user"
    })
  };
  const stream = /** @type {unknown} */ ({
    getTracks: () => [track],
    getVideoTracks: () => [track]
  });
  return { stream: /** @type {MediaStream} */ (stream), track, stop, removeEventListener };
}

function createFakeVideo() {
  return /** @type {HTMLVideoElement} */ (
    /** @type {unknown} */ ({
      srcObject: null,
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined)
    })
  );
}

describe("BUG-M2 cameraService sensor release and facingMode fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopCameraStream();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("infers facingMode from deviceId or label", () => {
    expect(inferFacingModeFromDevice("cam-back-0", "")).toBe("environment");
    expect(inferFacingModeFromDevice("", "camera2 0, facing back")).toBe("environment");
    expect(inferFacingModeFromDevice("", "Тыловая камера")).toBe("environment");
    expect(inferFacingModeFromDevice("front_cam", "")).toBe("user");
    expect(inferFacingModeFromDevice("", "Front Camera")).toBe("user");
    expect(inferFacingModeFromDevice("abc-123", "USB Webcam")).toBeNull();
  });

  it("stops previous stream tracks, clears srcObject, removes ended listener and waits ~150ms", async () => {
    const first = createFakeStream({ deviceId: "front-1", facingMode: "user" });
    const second = createFakeStream({
      deviceId: "back-1",
      facingMode: "environment",
      label: "Rear Camera"
    });
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);

    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia,
        enumerateDevices: vi.fn().mockResolvedValue([])
      }
    });

    const video = createFakeVideo();
    const onTrackEnded = vi.fn();

    const p1 = startCameraStream(video, "front-1", onTrackEnded);
    await vi.advanceTimersByTimeAsync(150);
    const r1 = await p1;
    expect(r1.ok).toBe(true);
    expect(video.srcObject).toBe(first.stream);

    const p2 = startCameraStream(video, "back-1", onTrackEnded);
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(first.removeEventListener).toHaveBeenCalledWith("ended", expect.any(Function));
    expect(first.track.onended).toBeNull();
    expect(video.srcObject).toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(150);
    const r2 = await p2;
    expect(r2.ok).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(onTrackEnded).not.toHaveBeenCalled();

    stopStreamTracks(second.stream);
    expect(second.stop).toHaveBeenCalledTimes(1);
  });

  it("falls back to ideal facingMode on NotReadableError or OverconstrainedError", async () => {
    const rearStream = createFakeStream({
      deviceId: "rear-2",
      facingMode: "environment",
      label: "Back Camera"
    });
    const notReadableErr = Object.assign(new Error("Device busy"), { name: "NotReadableError" });
    const overconstrainedErr = Object.assign(new Error("Bad constraint"), {
      name: "OverconstrainedError"
    });

    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(notReadableErr)
      .mockResolvedValueOnce(rearStream.stream)
      .mockRejectedValueOnce(overconstrainedErr)
      .mockResolvedValueOnce(rearStream.stream);

    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia,
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: "videoinput", deviceId: "id-rear", label: "camera2 0, facing back" },
          { kind: "videoinput", deviceId: "id-front", label: "camera2 1, facing front" }
        ])
      }
    });

    const video = createFakeVideo();
    const p1 = startCameraStream(video, "id-rear");
    await vi.advanceTimersByTimeAsync(150);
    const r1 = await p1;
    expect(r1.ok).toBe(true);
    expect(getUserMedia.mock.calls[1][0]).toEqual({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: { ideal: "environment" }
      }
    });

    const p2 = startCameraStream(video, "id-front");
    await vi.advanceTimersByTimeAsync(150);
    const r2 = await p2;
    expect(r2.ok).toBe(true);
    expect(getUserMedia.mock.calls[3][0]).toEqual({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: "user" } }
    });
  });

  it("aborts stale request during 150ms sensor release pause", async () => {
    const stream = createFakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream.stream);
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) }
    });

    const video = createFakeVideo();
    const pending = startCameraStream(video, "front-1");
    stopCameraStream(video);
    await vi.advanceTimersByTimeAsync(150);
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(res.aborted).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe("BUG-M3 audioVoiceService Android TTS watchdog, queue and Web Audio fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    setSpeechUnavailableHandler(null);
    cancelSpeech();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function createFakeAudioCtx() {
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

  function installFakeTts(
    opts = { voices: /** @type {{ lang: string }[]} */ ([]), speaking: false }
  ) {
    const addEventListener = vi.fn();
    const speak = vi.fn();
    const cancel = vi.fn();
    const resume = vi.fn();
    const synth = {
      speaking: opts.speaking,
      pending: false,
      getVoices: vi.fn(() => opts.voices),
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

  it("primes via getVoices/resume and single voiceschanged listener without empty Utterance", () => {
    const { speak, resume, getVoices, addEventListener } = (() => {
      const t = installFakeTts({ voices: [{ lang: "en-US" }], speaking: false });
      return { ...t, getVoices: t.synth.getVoices };
    })();
    expect(primeSpeechSynthesis()).toEqual({ supported: true, missingRussianVoice: true });
    expect(primeSpeechSynthesis()).toEqual({ supported: true, missingRussianVoice: true });
    expect(getVoices).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledTimes(2);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith("voiceschanged", expect.any(Function), {
      once: true
    });
    expect(speak).not.toHaveBeenCalled();
  });

  it("returns busy when speaking < 4000ms without cancel, and resets stuck speaking >= 4000ms", () => {
    const ruVoice = { lang: "ru-RU", name: "Russian" };
    const { synth, speak, cancel } = installFakeTts({ voices: [ruVoice], speaking: false });

    expect(speakRussianHint("Поднимите локоть", true, 5000)).toEqual({ ok: true });
    expect(speak).toHaveBeenCalledTimes(1);
    const firstUtt = speak.mock.calls[0][0];
    firstUtt.onstart?.();

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

  it("triggers Web Audio fallback and handler on watchdog 1500ms timeout or onerror", async () => {
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

  it("uses Web Audio fallback and notifies UI when voices exist without ru", () => {
    const t = installFakeTts({ voices: [{ lang: "en-US" }], speaking: false });
    const onUnavailable = vi.fn();
    setSpeechUnavailableHandler(onUnavailable);

    expect(speakRussianHint("Поднимите руку", true, 5000)).toEqual({ ok: true, fallback: "tone" });
    expect(t.speak).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(t.oscillators).toHaveLength(2);
  });
});
