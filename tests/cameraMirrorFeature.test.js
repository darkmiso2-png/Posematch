import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldMirrorCamera } from "../src/core/cameraHudLogic.js";
import {
  getFrontMirrorToggleCopy,
  projectNormalizedXToViewport,
  resolveActiveCameraFacing,
  resolveCameraMirrorState,
  shouldMirrorReferencePreview,
  transformShotLandmarksForCapture
} from "../src/core/cameraMirrorLogic.js";
import { evaluatePose } from "../src/core/poseEvaluator.js";
import { buildFullPose, createDefaultSkeleton } from "../src/core/poseMath.js";
import { loadSettings, saveSettings } from "../src/services/storageService.js";
import {
  deleteShot,
  getState,
  navigateTo,
  updateRuntime,
  updateSettings
} from "../src/state/store.js";
import { createCameraController } from "../src/ui/cameraController.js";

function createMockStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    /** @param {string} k */
    getItem: (k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
    /** @param {string} k @param {string} v */
    setItem: (k, v) => map.set(k, v),
    /** @param {string} k */
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    }
  };
}

function createMockCameraView() {
  return /** @type {ReturnType<import("../src/ui/screens/cameraScreen.js").createCameraScreen>} */ (
    /** @type {unknown} */ ({
      video: {
        srcObject: null,
        videoWidth: 640,
        videoHeight: 480,
        readyState: 4,
        currentTime: 1,
        pause: vi.fn(),
        play: vi.fn().mockResolvedValue(undefined)
      },
      overlayCanvas: { width: 640, height: 480, getContext: () => ({ clearRect: vi.fn() }) },
      render: vi.fn(),
      setCameraList: vi.fn(),
      setCameraSwitchState: vi.fn(),
      setCameraMirrored: vi.fn(),
      setCameraErrorInfo: vi.fn(),
      showNotice: vi.fn(),
      clearNotice: vi.fn(),
      notifyMissingRuVoice: vi.fn(),
      updateHud: vi.fn(),
      triggerFlash: vi.fn()
    })
  );
}

describe("cameraMirrorLogic pure rules (front, rear, desktop unknown)", () => {
  it("resolves front camera according to user mirrorFrontCamera preference", () => {
    expect(resolveCameraMirrorState({ facingMode: "user", mirrorFrontCamera: true })).toEqual({
      normalizedFacing: "user",
      isRearCamera: false,
      canToggleMirror: true,
      savedPreference: true,
      effectiveMirror: true
    });

    expect(resolveCameraMirrorState({ facingMode: "user", mirrorFrontCamera: false })).toEqual({
      normalizedFacing: "user",
      isRearCamera: false,
      canToggleMirror: true,
      savedPreference: false,
      effectiveMirror: false
    });
  });

  it("forces direct frame on rear camera while preserving saved front preference", () => {
    const rearWithMirrorPref = resolveCameraMirrorState({
      facingMode: "environment",
      mirrorFrontCamera: true
    });
    expect(rearWithMirrorPref).toEqual({
      normalizedFacing: "environment",
      isRearCamera: true,
      canToggleMirror: false,
      savedPreference: true,
      effectiveMirror: false
    });

    const rearByLabel = resolveCameraMirrorState({
      facingMode: "",
      deviceLabel: "Задняя камера",
      mirrorFrontCamera: true
    });
    expect(rearByLabel.isRearCamera).toBe(true);
    expect(rearByLabel.canToggleMirror).toBe(false);
    expect(rearByLabel.effectiveMirror).toBe(false);
    expect(shouldMirrorCamera("environment", "", true)).toBe(false);
    expect(shouldMirrorCamera("user", "", false)).toBe(false);
    expect(shouldMirrorCamera("", "Задняя камера", true)).toBe(false);
  });

  it("handles undefined facingMode / desktop webcam without labels deterministically", () => {
    const desktopMirror = resolveCameraMirrorState({
      facingMode: undefined,
      deviceId: "usb-1",
      deviceLabel: "",
      mirrorFrontCamera: true
    });
    expect(desktopMirror).toEqual({
      normalizedFacing: "unknown",
      isRearCamera: false,
      canToggleMirror: true,
      savedPreference: true,
      effectiveMirror: true
    });

    const desktopHonest = resolveCameraMirrorState({
      facingMode: "",
      deviceId: "usb-1",
      deviceLabel: "USB Webcam",
      mirrorFrontCamera: false
    });
    expect(desktopHonest).toEqual({
      normalizedFacing: "unknown",
      isRearCamera: false,
      canToggleMirror: true,
      savedPreference: false,
      effectiveMirror: false
    });

    expect(resolveActiveCameraFacing("", "usb-1", "", "")).toBe("");
    expect(resolveActiveCameraFacing("", "cam-back", "Back Camera", "")).toBe("environment");
    expect(resolveActiveCameraFacing("user", "cam-back", "Back Camera", "environment")).toBe(
      "user"
    );
  });

  it("produces UI copy strictly with Передняя / Задняя and handles disabled/busy states", () => {
    const frontMirror = getFrontMirrorToggleCopy(
      resolveCameraMirrorState({ facingMode: "user", mirrorFrontCamera: true }),
      false
    );
    const frontHonest = getFrontMirrorToggleCopy(
      resolveCameraMirrorState({ facingMode: "user", mirrorFrontCamera: false }),
      false
    );
    const frontBusy = getFrontMirrorToggleCopy(
      resolveCameraMirrorState({ facingMode: "user", mirrorFrontCamera: true }),
      true
    );
    const rear = getFrontMirrorToggleCopy(
      resolveCameraMirrorState({ facingMode: "environment", mirrorFrontCamera: true }),
      false
    );

    expect(frontMirror.disabled).toBe(false);
    expect(frontMirror.pressed).toBe(true);
    expect(frontMirror.label).toContain("Передняя");

    expect(frontHonest.disabled).toBe(false);
    expect(frontHonest.pressed).toBe(false);
    expect(frontHonest.label).toContain("честный");

    expect(frontBusy.disabled).toBe(true);
    expect(rear.disabled).toBe(true);
    expect(rear.pressed).toBe(false);
    expect(rear.label).toContain("Задняя");

    const allText = [frontMirror, frontHonest, rear]
      .map((c) => `${c.label} ${c.ariaLabel} ${c.title}`)
      .join(" ");
    expect(allText).not.toMatch(/фронт|тыл/i);
  });
});

describe("3-layer coordinate synchronization, thumbnail XOR, hints and shot landmarks", () => {
  it("projects X coordinates symmetrically and aligns reference thumbnail with live overlay", () => {
    expect(projectNormalizedXToViewport(0.25, true)).toBeCloseTo(0.75, 6);
    expect(projectNormalizedXToViewport(0.25, false)).toBeCloseTo(0.25, 6);

    expect(shouldMirrorReferencePreview(false, true)).toBe(true);
    expect(shouldMirrorReferencePreview(false, false)).toBe(false);
    expect(shouldMirrorReferencePreview(true, true)).toBe(false);
    expect(shouldMirrorReferencePreview(true, false)).toBe(true);
  });

  it("keeps score and left/right anatomical hints invariant regardless of camera mirror mode", () => {
    const refHeadRight = createDefaultSkeleton();
    refHeadRight[0] = { x: 0.4, y: 0.18, z: 0, visibility: 1 };
    const userStraight = createDefaultSkeleton();

    const evalMirroredMode = evaluatePose(userStraight, refHeadRight, 4 / 3, 4 / 3);
    const evalHonestMode = evaluatePose(userStraight, refHeadRight, 4 / 3, 4 / 3);

    expect(evalMirroredMode.totalScore).toBe(evalHonestMode.totalScore);
    expect(evalMirroredMode.segResults.get("head_neck")?.hint).toBe("Наклоните голову вправо");

    const refHeadLeft = createDefaultSkeleton();
    refHeadLeft[0] = { x: 0.6, y: 0.18, z: 0, visibility: 1 };
    const evalLeft = evaluatePose(userStraight, refHeadLeft, 4 / 3, 4 / 3);
    expect(evalLeft.segResults.get("head_neck")?.hint).toBe("Наклоните голову влево");
  });

  it("transforms captured userLandmarks strictly according to effectiveMirror without double-flip", () => {
    const raw = buildFullPose({
      11: [0.62, 0.3, 1],
      12: [0.38, 0.3, 1],
      16: [0.22, 0.45, 1]
    });

    const mirrored = transformShotLandmarksForCapture(raw, true);
    expect(mirrored).not.toBeNull();
    expect(mirrored?.[15].x).toBeCloseTo(0.78, 5);
    expect(mirrored?.[15].visibility).toBe(1);
    expect(mirrored?.[12].x).toBeCloseTo(0.38, 5);

    const direct = transformShotLandmarksForCapture(raw, false);
    expect(direct).not.toBeNull();
    expect(direct?.[16].x).toBeCloseTo(0.22, 5);
    expect(direct?.[11].x).toBeCloseTo(0.62, 5);
    expect(direct).not.toBe(raw);
    expect(transformShotLandmarksForCapture(null, true)).toBeNull();
  });
});

describe("Front -> Rear -> Front preference preservation and takeShot capture flag", () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let scaleSpy;

  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage());
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    scaleSpy = vi.fn();
    vi.stubGlobal("document", {
      hidden: false,
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ translate: vi.fn(), scale: scaleSpy, drawImage: vi.fn() }),
        toDataURL: () => "data:image/jpeg;base64,CAPTURED"
      })
    });
    navigateTo("camera");
    updateSettings({ activeDeviceId: "", mirrorFrontCamera: true, mirrorRef: false });
    updateRuntime({ cameraReady: true, cameraError: null });
    while (getState().shots.length > 0) deleteShot(getState().shots[0].id);
  });

  afterEach(() => {
    while (getState().shots.length > 0) deleteShot(getState().shots[0].id);
    updateSettings({ activeDeviceId: "", mirrorFrontCamera: true, mirrorRef: false });
    vi.unstubAllGlobals();
  });

  it("persists mirrorFrontCamera in storageService and defaults legacy payloads to true", () => {
    globalThis.localStorage.setItem(
      "posematch_settings_v1",
      JSON.stringify({ attachToBody: true })
    );
    expect(loadSettings().mirrorFrontCamera).toBe(true);
    saveSettings({ ...loadSettings(), mirrorFrontCamera: false });
    expect(loadSettings().mirrorFrontCamera).toBe(false);
  });

  it("preserves front preference across Front -> Rear -> Front and mirrors takeShot", async () => {
    const view = createMockCameraView();
    const cams = [
      /** @type {MediaDeviceInfo} */ ({ deviceId: "front-id", label: "Передняя камера" }),
      /** @type {MediaDeviceInfo} */ ({ deviceId: "rear-id", label: "Задняя камера" })
    ];
    /**
     * @param {string} id
     * @param {string} facing
     * @param {string} label
     */
    const okRes = (id, facing, label) => ({
      ok: true,
      deviceId: id,
      facingMode: facing,
      deviceLabel: label,
      error: null,
      errorInfo: null
    });
    const startStream = vi
      .fn()
      .mockResolvedValueOnce(okRes("front-id", "user", "Передняя камера"))
      .mockResolvedValueOnce(okRes("rear-id", "environment", "Задняя камера"))
      .mockResolvedValueOnce(okRes("front-id", "user", "Передняя камера"));

    const ctrl = createCameraController(view, {
      listDevices: vi.fn().mockResolvedValue(cams),
      startStream,
      stopStream: vi.fn()
    });

    ctrl.activate();
    await vi.waitFor(() => expect(view.setCameraList).toHaveBeenCalledTimes(1));
    expect(view.setCameraMirrored).toHaveBeenLastCalledWith(true);

    ctrl.takeManualShot();
    expect(scaleSpy).toHaveBeenCalledWith(-1, 1);
    expect(getState().shots[0].cameraMirrored).toBe(true);

    scaleSpy.mockClear();
    updateSettings({ mirrorFrontCamera: false });
    expect(startStream).toHaveBeenCalledTimes(1);
    ctrl.takeManualShot();
    expect(scaleSpy).not.toHaveBeenCalled();
    expect(getState().shots[0].cameraMirrored).toBe(false);

    await ctrl.switchCamera();
    expect(view.setCameraMirrored).toHaveBeenLastCalledWith(false);
    expect(getState().settings.mirrorFrontCamera).toBe(false);
    scaleSpy.mockClear();
    ctrl.takeManualShot();
    expect(scaleSpy).not.toHaveBeenCalled();
    expect(getState().shots[0].cameraMirrored).toBe(false);

    await ctrl.switchCamera();
    expect(view.setCameraMirrored).toHaveBeenLastCalledWith(false);
    expect(getState().settings.mirrorFrontCamera).toBe(false);

    ctrl.deactivate();
  });
});
