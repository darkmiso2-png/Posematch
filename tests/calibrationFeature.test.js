import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canvasToNormalized,
  countActiveSegments,
  findNearestJoint,
  getHiddenJoints,
  isDragExceeded,
  mirrorCalibrationLandmarks,
  moveJoint,
  resetCalibrationLandmarks,
  restoreAllJoints,
  setJointVisibility,
  shouldTriggerDoubleTap,
  toggleJointVisibility,
  validateCalibrationSkeleton
} from "../src/core/calibrationLogic.js";
import { EDITABLE_JOINTS } from "../src/core/constants.js";
import { createDefaultSkeleton } from "../src/core/poseMath.js";
import {
  cancelCalibrationDraft,
  commitCalibrationDraft,
  deleteSavedCalibration,
  getState,
  navigateTo,
  openCalibrationDraft
} from "../src/state/store.js";

/**
 * @param {boolean} [throwQuota]
 */
function createMockStorage(throwQuota = false) {
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
      if (throwQuota) {
        const err = new Error("Quota exceeded");
        err.name = "QuotaExceededError";
        throw err;
      }
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

describe("calibrationLogic coordinates and drag/tap detection", () => {
  it("clamps canvas coordinates to normalized [0.01..0.99]", () => {
    expect(canvasToNormalized(-50, 999, 360, 480)).toEqual({ x: 0.01, y: 0.99 });
    expect(canvasToNormalized(180, 240, 360, 480)).toEqual({ x: 0.5, y: 0.5 });
    expect(canvasToNormalized(10, 10, 0, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("finds nearest editable joint within hit radius and moves it with clamp", () => {
    const skel = createDefaultSkeleton();
    const headX = skel[0].x * 360;
    const headY = skel[0].y * 480;
    expect(findNearestJoint(skel, headX + 8, headY - 8, 360, 480, 26)).toBe(0);
    expect(findNearestJoint(skel, 5, 5, 360, 480, 10)).toBe(-1);

    expect(moveJoint(skel, 0, 1.5, -0.2)).toBe(true);
    expect(skel[0].x).toBe(0.99);
    expect(skel[0].y).toBe(0.01);
    expect(skel[0].visibility).toBe(1);
    expect(moveJoint(skel, 999, 0.5, 0.5)).toBe(false);
  });

  it("separates drag threshold from double-tap detection", () => {
    expect(isDragExceeded({ x: 100, y: 100 }, { x: 103, y: 103 })).toBe(false);
    expect(isDragExceeded({ x: 100, y: 100 }, { x: 107, y: 100 })).toBe(true);

    const first = { idx: 11, x: 120, y: 140, time: 1000 };
    expect(shouldTriggerDoubleTap(first, { idx: 11, x: 128, y: 145, time: 1250 })).toBe(true);
    expect(shouldTriggerDoubleTap(first, { idx: 12, x: 120, y: 140, time: 1150 })).toBe(false);
    expect(shouldTriggerDoubleTap(first, { idx: 11, x: 120, y: 140, time: 1500 })).toBe(false);
    expect(shouldTriggerDoubleTap(first, { idx: 11, x: 170, y: 140, time: 1150 })).toBe(false);
  });
});

describe("calibrationLogic visibility, mirror, reset and validation", () => {
  it("toggles visibility, lists Russian hidden names and restores all joints", () => {
    const skel = createDefaultSkeleton();
    expect(getHiddenJoints(skel)).toEqual([]);

    expect(toggleJointVisibility(skel, 15)).toBe(false);
    expect(skel[15].visibility).toBe(0);
    expect(toggleJointVisibility(skel, 26)).toBe(false);

    const hidden = getHiddenJoints(skel);
    expect(hidden).toEqual([
      { index: 15, name: "Л. кисть" },
      { index: 26, name: "П. колено" }
    ]);

    expect(setJointVisibility(skel, 15, true)).toBe(true);
    expect(getHiddenJoints(skel)).toEqual([{ index: 26, name: "П. колено" }]);
    expect(restoreAllJoints(skel)).toBe(1);
    expect(getHiddenJoints(skel)).toEqual([]);
  });

  it("mirrors X coordinates and swaps left/right MediaPipe indices", () => {
    const skel = createDefaultSkeleton();
    skel[11].x = 0.25;
    skel[12].x = 0.72;
    skel[15].visibility = 0;

    const mirrored = mirrorCalibrationLandmarks(skel);
    expect(mirrored[11].x).toBeCloseTo(1 - 0.72, 5);
    expect(mirrored[12].x).toBeCloseTo(1 - 0.25, 5);
    expect(mirrored[16].visibility).toBe(0);
    expect(mirrored[15].visibility).toBe(1);

    const doubleMirrored = mirrorCalibrationLandmarks(mirrored);
    expect(doubleMirrored[11].x).toBeCloseTo(0.25, 5);
    expect(doubleMirrored[15].visibility).toBe(0);
  });

  it("resets landmarks to autoLandmarks including hidden joints", () => {
    const auto = createDefaultSkeleton();
    const edited = createDefaultSkeleton();
    moveJoint(edited, 0, 0.2, 0.8);
    toggleJointVisibility(edited, 11);
    toggleJointVisibility(edited, 24);

    const reset = resetCalibrationLandmarks(auto);
    expect(reset[0].x).toBe(auto[0].x);
    expect(reset[11].visibility).toBe(1);
    expect(reset[24].visibility).toBe(1);
  });

  it("blocks saving empty or insufficient skeleton (< 2 active segments)", () => {
    const skel = createDefaultSkeleton();
    expect(countActiveSegments(skel)).toBeGreaterThanOrEqual(2);
    expect(validateCalibrationSkeleton(skel).ok).toBe(true);

    for (const idx of EDITABLE_JOINTS) setJointVisibility(skel, idx, false);
    expect(countActiveSegments(skel)).toBe(0);
    expect(validateCalibrationSkeleton(skel).ok).toBe(false);

    setJointVisibility(skel, 11, true);
    setJointVisibility(skel, 12, true);
    expect(countActiveSegments(skel)).toBe(1);
    expect(validateCalibrationSkeleton(skel).ok).toBe(false);

    setJointVisibility(skel, 13, true);
    expect(countActiveSegments(skel)).toBe(2);
    expect(validateCalibrationSkeleton(skel).ok).toBe(true);
  });
});

describe("store calibration draft lifecycle (2A and return navigation)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage(false));
  });

  afterEach(() => {
    cancelCalibrationDraft();
    navigateTo("hub");
    vi.unstubAllGlobals();
  });

  it("cancels draft without saving and returns to previous screen (hub or camera)", () => {
    const preset = getState().presets[0];
    navigateTo("camera");
    openCalibrationDraft(preset);
    expect(getState().currentScreen).toBe("calibration");
    expect(getState().draftCalibration).not.toBeNull();

    const returned = cancelCalibrationDraft();
    expect(returned).toBe("camera");
    expect(getState().currentScreen).toBe("camera");
    expect(getState().draftCalibration).toBeNull();

    navigateTo("hub");
    openCalibrationDraft(preset);
    expect(cancelCalibrationDraft()).toBe("hub");
    expect(getState().currentScreen).toBe("hub");
  });

  it("creates new custom ID when saving preset and upserts existing custom pose", () => {
    const preset = getState().presets[0];
    openCalibrationDraft(preset);
    const draft = /** @type {import("../src/core/types.js").PoseReference} */ (
      getState().draftCalibration
    );

    const res = commitCalibrationDraft({ ...draft, name: "  Свой   пресет " }, true);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.ref.id).not.toBe(preset.id);
    expect(res.ref.source).toBe("custom");
    expect(res.ref.category).toBe("saved");
    expect(getState().currentScreen).toBe("camera");
    expect(getState().activeReference?.id).toBe(res.ref.id);

    openCalibrationDraft(res.ref);
    const editedDraft = /** @type {import("../src/core/types.js").PoseReference} */ (
      getState().draftCalibration
    );
    const upsertRes = commitCalibrationDraft({ ...editedDraft, name: "Обновленная" }, true);
    expect(upsertRes.ok).toBe(true);
    if (upsertRes.ok) {
      expect(upsertRes.ref.id).toBe(res.ref.id);
      const matches = getState().savedCalibrations.filter((c) => c.id === res.ref.id);
      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe("Обновленная");
    }

    deleteSavedCalibration(res.ref.id);
  });

  it("keeps draft open and stays on calibration when QuotaExceededError occurs", () => {
    vi.stubGlobal("localStorage", createMockStorage(true));
    const preset = getState().presets[0];
    openCalibrationDraft(preset);
    const draft = /** @type {import("../src/core/types.js").PoseReference} */ (
      getState().draftCalibration
    );

    const res = commitCalibrationDraft({ ...draft, name: "Не влезет" }, true);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.quotaExceeded).toBe(true);
    }
    expect(getState().currentScreen).toBe("calibration");
    expect(getState().draftCalibration).not.toBeNull();
  });
});
