import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelCountdown,
  classifyCameraError,
  computeShutterRingProgress,
  createIdleCountdown,
  resolveInitialReference,
  startCountdown,
  stepAutoShutter,
  stepCountdown
} from "../src/core/cameraHudLogic.js";
import { AUTO_SHUTTER_HOLD_MS, SHUTTER_COOLDOWN_MS } from "../src/core/constants.js";
import { createDefaultSkeleton } from "../src/core/poseMath.js";
import {
  loadLastActiveReferenceId,
  saveLastActiveReferenceId
} from "../src/services/storageService.js";
import {
  addCapturedShot,
  cancelCalibrationDraft,
  getState,
  navigateTo,
  openCalibrationDraft,
  resetCameraRuntime,
  setActiveReference
} from "../src/state/store.js";

function createMockStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    /** @param {string} k */
    getItem(k) {
      return map.has(k) ? /** @type {string} */ (map.get(k)) : null;
    },
    /**
     * @param {string} k
     * @param {string} v
     */
    setItem(k, v) {
      map.set(k, v);
    },
    /** @param {string} k */
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
    key() {
      return null;
    },
    get length() {
      return map.size;
    }
  };
}

/**
 * @param {string} id
 * @param {string} name
 * @returns {import("../src/core/types.js").PoseReference}
 */
function makeRef(id, name) {
  const skel = createDefaultSkeleton();
  return {
    id,
    name,
    source: "preset",
    category: "portrait",
    imageDataUrl: "data:image/png;base64,AAA",
    aspect: 0.75,
    landmarks: skel,
    autoLandmarks: skel,
    autoDetected: true,
    createdAt: 1000
  };
}

describe("cameraHudLogic auto-shutter 800 ms + cooldown", () => {
  it("fills holdMs over 800 ms, triggers shot once, resets holdMs and enforces cooldown", () => {
    let state = { holdMs: 0, cooldownMs: 0 };

    const s1 = stepAutoShutter(state, {
      dtMs: 300,
      hasPose: true,
      score: 85,
      threshold: 80,
      isRecording: false,
      cameraReady: true
    });
    expect(s1.shouldShoot).toBe(false);
    expect(s1.holdMs).toBe(100);
    expect(s1.progress).toBeCloseTo(100 / AUTO_SHUTTER_HOLD_MS, 4);

    state = { holdMs: s1.holdMs, cooldownMs: s1.cooldownMs };
    let shotCount = 0;
    for (let i = 0; i < 7; i += 1) {
      const next = stepAutoShutter(state, {
        dtMs: 100,
        hasPose: true,
        score: 90,
        threshold: 80,
        isRecording: false,
        cameraReady: true
      });
      state = { holdMs: next.holdMs, cooldownMs: next.cooldownMs };
      if (next.shouldShoot) shotCount += 1;
    }

    expect(shotCount).toBe(1);
    expect(state.holdMs).toBe(0);
    expect(state.cooldownMs).toBe(SHUTTER_COOLDOWN_MS);

    const duringCooldown = stepAutoShutter(state, {
      dtMs: 100,
      hasPose: true,
      score: 95,
      threshold: 80,
      isRecording: false,
      cameraReady: true
    });
    expect(duringCooldown.shouldShoot).toBe(false);
    expect(duringCooldown.holdMs).toBe(0);
    expect(duringCooldown.cooldownMs).toBe(SHUTTER_COOLDOWN_MS - 100);
  });

  it("decays holdMs below threshold and resets when camera not ready or pose lost", () => {
    const decayed = stepAutoShutter(
      { holdMs: 500, cooldownMs: 0 },
      {
        dtMs: 100,
        hasPose: true,
        score: 60,
        threshold: 80,
        isRecording: false,
        cameraReady: true
      }
    );
    expect(decayed.holdMs).toBe(250);
    expect(decayed.shouldShoot).toBe(false);

    const lost = stepAutoShutter(
      { holdMs: 400, cooldownMs: 0 },
      {
        dtMs: 50,
        hasPose: false,
        score: 90,
        threshold: 80,
        isRecording: false,
        cameraReady: true
      }
    );
    expect(lost.holdMs).toBe(0);

    const notReady = stepAutoShutter(
      { holdMs: 400, cooldownMs: 0 },
      {
        dtMs: 50,
        hasPose: true,
        score: 90,
        threshold: 80,
        isRecording: false,
        cameraReady: false
      }
    );
    expect(notReady.holdMs).toBe(0);

    describe("cameraHudLogic countdown 3-2-1 state machine", () => {
      it("counts down 3 -> 2 -> 1 -> completed and supports cancellation", () => {
        const idle = createIdleCountdown();
        expect(idle.status).toBe("idle");

        const cd = startCountdown(3);
        expect(cd.status).toBe("running");
        expect(cd.displaySec).toBe(3);

        const step1 = stepCountdown(cd, 950);
        expect(step1.tickChanged).toBe(false);
        expect(step1.state.displaySec).toBe(3);

        const step2 = stepCountdown(step1.state, 100);
        expect(step2.tickChanged).toBe(true);
        expect(step2.state.displaySec).toBe(2);

        const step3 = stepCountdown(step2.state, 1000);
        expect(step3.tickChanged).toBe(true);
        expect(step3.state.displaySec).toBe(1);

        const step4 = stepCountdown(step3.state, 1000);
        expect(step4.finished).toBe(true);
        expect(step4.state.status).toBe("completed");
        expect(step4.state.displaySec).toBe(0);

        const running = startCountdown(3);
        const cancelled = cancelCountdown(running);
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.displaySec).toBe(0);
        expect(stepCountdown(cancelled, 500).finished).toBe(false);
      });
    });

    describe("cameraHudLogic error classifier and initial reference", () => {
      it("classifies all camera access/hardware failure modes", () => {
        expect(classifyCameraError(null, true, false)).toMatchObject({
          code: "insecure",
          canRetry: false
        });
        expect(classifyCameraError(null, false, true)).toMatchObject({
          code: "unsupported",
          canRetry: false
        });
        expect(classifyCameraError({ name: "NotAllowedError" })).toMatchObject({
          code: "permission",
          canRetry: true
        });
        expect(classifyCameraError({ name: "NotFoundError" })).toMatchObject({
          code: "not_found",
          canRetry: true
        });
        expect(classifyCameraError({ name: "NotReadableError" })).toMatchObject({
          code: "busy",
          canRetry: true
        });
        expect(classifyCameraError({ name: "WeirdError", message: "boom" })).toMatchObject({
          code: "unknown",
          canRetry: true
        });
      });

      it("resolves initial reference from lastActiveId or falls back to presets[0]", () => {
        const p1 = makeRef("p1", "Пресет 1");
        const p2 = makeRef("p2", "Пресет 2");
        const c1 = makeRef("c1", "Моя поза");
        expect(resolveInitialReference([p1, p2], [c1], "c1")?.id).toBe("c1");
        expect(resolveInitialReference([p1, p2], [c1], "p2")?.id).toBe("p2");
        expect(resolveInitialReference([p1, p2], [c1], "missing")?.id).toBe("p1");
        expect(resolveInitialReference([], [], null)).toBeNull();
      });
    });

    describe("Camera-First v2 store and screen router lifecycle", () => {
      beforeEach(() => {
        vi.stubGlobal("localStorage", createMockStorage());
      });

      afterEach(() => {
        cancelCalibrationDraft();
        navigateTo("camera");
        vi.unstubAllGlobals();
      });

      it("starts on camera screen with activeReference and persists lastActiveReferenceId", () => {
        const st = getState();
        expect(st.currentScreen).toBe("camera");
        expect(st.activeReference).not.toBeNull();

        const secondPreset = st.presets[1];
        setActiveReference(secondPreset);
        expect(getState().activeReference?.id).toBe(secondPreset.id);
        expect(loadLastActiveReferenceId()).toBe(secondPreset.id);

        saveLastActiveReferenceId(null);
        expect(loadLastActiveReferenceId()).toBeNull();

        resetCameraRuntime();
        expect(getState().runtime.cameraReady).toBe(false);
        expect(getState().runtime.holdMs).toBe(0);
      });

      it("tracks shots count and returns from calibration back to camera", () => {
        navigateTo("camera");
        const ref = /** @type {import("../src/core/types.js").PoseReference} */ (
          getState().activeReference
        );
        const beforeShots = getState().shots.length;
        addCapturedShot({
          id: "shot-test-1",
          referenceId: ref.id,
          imageDataUrl: "data:image/jpeg;base64,AAA",
          score: 91,
          userLandmarks: null,
          refLandmarks: null,
          createdAt: Date.now()
        });
        expect(getState().shots.length).toBe(beforeShots + 1);

        openCalibrationDraft(ref);
        expect(getState().currentScreen).toBe("calibration");
        expect(cancelCalibrationDraft()).toBe("camera");
      });
    });
  });

  it("computes SVG strokeDashoffset from holdMs progress", () => {
    const empty = computeShutterRingProgress(0, 800, 28);
    expect(empty.progress).toBe(0);
    expect(empty.dashOffset).toBeCloseTo(empty.circumference, 4);

    const half = computeShutterRingProgress(400, 800, 28);
    expect(half.percent).toBe(50);
    expect(half.dashOffset).toBeCloseTo(half.circumference * 0.5, 4);

    const full = computeShutterRingProgress(1000, 800, 28);
    expect(full.percent).toBe(100);
    expect(full.dashOffset).toBeCloseTo(0, 4);
  });
});
