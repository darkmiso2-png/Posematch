import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inferFacingModeFromDevice } from "../src/core/cameraHudLogic.js";
import {
  formatCameraOptionLabel,
  formatCameraSwitchError,
  getSwitchCameraCopy,
  resolveNextCameraTarget
} from "../src/core/cameraSwitchLogic.js";
import { startCameraStream, stopCameraStream } from "../src/services/cameraService.js";
import { getState, navigateTo, updateSettings } from "../src/state/store.js";
import { createCameraController } from "../src/ui/cameraController.js";

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
      overlayCanvas: {
        width: 640,
        height: 480,
        getContext: () => ({ clearRect: vi.fn() })
      },
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

describe("cameraSwitchLogic pure helpers and terminology", () => {
  it("returns null when fewer than 2 videoinput devices exist", () => {
    expect(resolveNextCameraTarget([], "", "user")).toBeNull();
    expect(
      resolveNextCameraTarget([{ deviceId: "cam-1", label: "Front" }], "cam-1", "user")
    ).toBeNull();
  });

  it("picks opposite camera by label or Russian wording and falls back cyclically on empty labels", () => {
    const labeled = [
      { deviceId: "id-front", label: "Передняя камера" },
      { deviceId: "id-back", label: "Задняя камера" }
    ];
    expect(resolveNextCameraTarget(labeled, "id-front", "user")).toEqual({
      deviceId: "id-back",
      targetFacing: "environment"
    });
    expect(resolveNextCameraTarget(labeled, "id-back", "environment")).toEqual({
      deviceId: "id-front",
      targetFacing: "user"
    });

    const unlabeled = [
      { deviceId: "dev-a", label: "" },
      { deviceId: "dev-b", label: "" }
    ];
    expect(resolveNextCameraTarget(unlabeled, "dev-a", "user")).toEqual({
      deviceId: "dev-b",
      targetFacing: "environment"
    });
    expect(resolveNextCameraTarget(unlabeled, "dev-b", "environment")).toEqual({
      deviceId: "dev-a",
      targetFacing: "user"
    });
  });

  it("uses Передняя / Задняя without Фронт / Тыл across copy, option labels and errors", () => {
    expect(inferFacingModeFromDevice("", "Передняя камера")).toBe("user");
    const toRear = getSwitchCameraCopy("user", true, false);
    const toFront = getSwitchCameraCopy("environment", true, false);
    expect(toRear.title).toContain("Задняя");
    expect(toRear.ariaLabel).toContain("Задняя");
    expect(toFront.title).toContain("Передняя");
    expect(toFront.ariaLabel).toContain("Передняя");
    expect(`${toRear.title} ${toRear.ariaLabel} ${toFront.title} ${toFront.ariaLabel}`).not.toMatch(
      /фронт|тыл/i
    );

    const optRear = formatCameraOptionLabel({ deviceId: "x2", label: "" }, 1, "x2", "environment");
    const optFront = formatCameraOptionLabel({ deviceId: "x1", label: "" }, 0, "x1", "user");
    expect(optRear).toContain("Задняя");
    expect(optFront).toContain("Передняя");
    expect(`${optRear} ${optFront}`).not.toMatch(/фронт|тыл/i);

    const errMsg = formatCameraSwitchError("environment", "busy");
    expect(errMsg).toContain("Задняя");
    expect(errMsg).not.toMatch(/фронт|тыл/i);
  });
});

describe("cameraService preferredFacingMode fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopCameraStream();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses preferredFacingMode when device has empty label and exact deviceId fails", async () => {
    const track = {
      stop: vi.fn(),
      label: "",
      onended: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSettings: () => ({ deviceId: "rear-actual", facingMode: "environment" })
    };
    const stream = /** @type {MediaStream} */ (
      /** @type {unknown} */ ({ getTracks: () => [track], getVideoTracks: () => [track] })
    );
    const overErr = Object.assign(new Error("Overconstrained"), { name: "OverconstrainedError" });
    const getUserMedia = vi.fn().mockRejectedValueOnce(overErr).mockResolvedValueOnce(stream);

    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) }
    });

    const video = /** @type {HTMLVideoElement} */ (
      /** @type {unknown} */ ({
        srcObject: null,
        pause: vi.fn(),
        play: vi.fn().mockResolvedValue(undefined)
      })
    );
    const p = startCameraStream(video, "opaque-id-2", undefined, "environment");
    await vi.advanceTimersByTimeAsync(150);
    const res = await p;

    expect(res.ok).toBe(true);
    expect(res.deviceId).toBe("rear-actual");
    expect(getUserMedia.mock.calls[1][0]).toEqual({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: { ideal: "environment" }
      }
    });
  });
});

describe("cameraController switchCamera, double-click lock, sync and error cleanup", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    navigateTo("camera");
    updateSettings({ activeDeviceId: "front-id" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hides/disables switch button on single-camera device and prevents double-click during switch", async () => {
    const view = createMockCameraView();
    const singleCam = [/** @type {MediaDeviceInfo} */ ({ deviceId: "only-1", label: "Cam 1" })];
    const startStream = vi.fn().mockResolvedValue({
      ok: true,
      deviceId: "only-1",
      facingMode: "user",
      deviceLabel: "Cam 1",
      error: null,
      errorInfo: null
    });
    const ctrl = createCameraController(view, {
      listDevices: vi.fn().mockResolvedValue(singleCam),
      startStream,
      stopStream: vi.fn()
    });

    ctrl.activate();
    await vi.waitFor(() => expect(view.setCameraList).toHaveBeenCalled());
    expect(view.setCameraSwitchState).toHaveBeenLastCalledWith({
      canSwitch: false,
      currentFacing: "user",
      isSwitching: false
    });
    ctrl.deactivate();

    const dualView = createMockCameraView();
    const dualCams = [
      /** @type {MediaDeviceInfo} */ ({ deviceId: "front-id", label: "" }),
      /** @type {MediaDeviceInfo} */ ({ deviceId: "back-id", label: "" })
    ];
    /** @type {(v: unknown) => void} */
    let resolveSwitch = () => {};
    const dualStart = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        deviceId: "front-id",
        facingMode: "user",
        deviceLabel: "",
        error: null,
        errorInfo: null
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSwitch = resolve;
          })
      );

    const dualCtrl = createCameraController(dualView, {
      listDevices: vi.fn().mockResolvedValue(dualCams),
      startStream: dualStart,
      stopStream: vi.fn()
    });

    dualCtrl.activate();
    await vi.waitFor(() => expect(dualView.setCameraList).toHaveBeenCalled());

    const p1 = dualCtrl.switchCamera();
    const p2 = dualCtrl.switchCamera();
    expect(dualStart).toHaveBeenCalledTimes(2);
    expect(dualView.setCameraSwitchState).toHaveBeenCalledWith({ isSwitching: true });

    resolveSwitch({
      ok: true,
      deviceId: "back-id",
      facingMode: "environment",
      deviceLabel: "",
      error: null,
      errorInfo: null
    });
    await Promise.all([p1, p2]);

    expect(getState().settings.activeDeviceId).toBe("back-id");
    expect(dualView.setCameraList).toHaveBeenLastCalledWith(dualCams, "back-id", "environment");
    expect(dualView.setCameraSwitchState).toHaveBeenLastCalledWith({
      canSwitch: true,
      currentFacing: "environment",
      isSwitching: false
    });
    dualCtrl.deactivate();
  });

  it("clears lock/overlay and emits error notice on switch failure, and stops stream if deactivated mid-switch", async () => {
    const view = createMockCameraView();
    const dualCams = [
      /** @type {MediaDeviceInfo} */ ({ deviceId: "front-id", label: "Передняя" }),
      /** @type {MediaDeviceInfo} */ ({ deviceId: "back-id", label: "Задняя" })
    ];
    const stopStream = vi.fn();
    /** @type {(v: unknown) => void} */
    let resolveDelayed = () => {};
    const startStream = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        deviceId: "front-id",
        facingMode: "user",
        deviceLabel: "Передняя",
        error: null,
        errorInfo: null
      })
      .mockResolvedValueOnce({
        ok: false,
        deviceId: "",
        facingMode: "",
        deviceLabel: "",
        error: "Камера занята",
        errorInfo: {
          code: "busy",
          title: "Камера занята",
          message: "Камера занята",
          canRetry: true
        }
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDelayed = resolve;
          })
      );

    const ctrl = createCameraController(view, {
      listDevices: vi.fn().mockResolvedValue(dualCams),
      startStream,
      stopStream
    });

    ctrl.activate();
    await vi.waitFor(() => expect(view.setCameraList).toHaveBeenCalled());

    await ctrl.switchCamera();
    expect(view.showNotice).toHaveBeenCalledWith(expect.stringContaining("Задняя"), "error");
    expect(view.setCameraSwitchState).toHaveBeenLastCalledWith({
      canSwitch: true,
      currentFacing: "user",
      isSwitching: false
    });

    const pendingSelect = ctrl.selectCamera("back-id");
    ctrl.deactivate();
    resolveDelayed({
      ok: true,
      deviceId: "back-id",
      facingMode: "environment",
      deviceLabel: "Задняя",
      error: null,
      errorInfo: null
    });
    await pendingSelect;
    expect(stopStream).toHaveBeenCalledTimes(2);
  });
});
