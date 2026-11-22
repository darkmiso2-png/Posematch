import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inferFacingModeFromDevice } from "../src/core/cameraHudLogic.js";
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
