import { resolveActiveCameraFacing, resolveCameraMirrorState } from "../core/cameraMirrorLogic.js";
import {
  formatCameraSwitchError,
  resolveDeviceFacing,
  resolveNextCameraTarget
} from "../core/cameraSwitchLogic.js";
import { SHUTTER_COOLDOWN_MS } from "../core/constants.js";
import { cancelSpeech } from "../services/audioVoiceService.js";
import {
  listVideoDevices,
  startCameraStream,
  stopCameraStream
} from "../services/cameraService.js";
import { getState, resetCameraRuntime, updateRuntime, updateSettings } from "../state/store.js";
import { createCameraFrameProcessor } from "./cameraFrameProcessor.js";
import { createPoseRecorder } from "./cameraPoseRecorder.js";

/**
 * Контроллер видеопотока, жизненного цикла камеры и координации записи позы 3 сек.
 * @param {ReturnType<import("./screens/cameraScreen.js").createCameraScreen>} cameraView
 * @param {{
 *   listDevices?: typeof listVideoDevices,
 *   startStream?: typeof startCameraStream,
 *   stopStream?: typeof stopCameraStream
 * }} [deps]
 */
export function createCameraController(cameraView, deps = {}) {
  const listDevices = deps.listDevices || listVideoDevices;
  const startStream = deps.startStream || startCameraStream;
  const stopStream = deps.stopStream || stopCameraStream;

  const frameProcessor = createCameraFrameProcessor(cameraView);
  let lastFrameTime = performance.now();
  let isActive = false;
  let rafId = 0;
  /** @type {"user" | "environment" | ""} */
  let activeFacingMode = "";
  let activeDeviceLabel = "";
  let isSwitchingCamera = false;
  let sessionToken = 0;
  /** @type {MediaDeviceInfo[]} */
  let cachedDevices = [];

  /** @type {Promise<void> | null} */
  let connectPromise = null;
  let connectingDeviceId = "";

  function getEffectiveMirrorCamera() {
    const st = getState();
    return resolveCameraMirrorState({
      facingMode: activeFacingMode,
      deviceId: st.settings.activeDeviceId,
      deviceLabel: activeDeviceLabel,
      mirrorFrontCamera: st.settings.mirrorFrontCamera
    }).effectiveMirror;
  }

  function isVideoStreamReady() {
    const v = cameraView.video;
    const st = getState();
    return Boolean(
      isActive &&
      !isSwitchingCamera &&
      st.currentScreen === "camera" &&
      st.runtime.cameraReady &&
      !st.runtime.cameraError &&
      v.videoWidth > 0 &&
      v.videoHeight > 0
    );
  }

  const recorder = createPoseRecorder({
    cameraView,
    isStreamReady: isVideoStreamReady,
    isCameraMirrored: getEffectiveMirrorCamera,
    ensureConnect: () => {
      if (!connectPromise && !isSwitchingCamera && !getState().runtime.cameraError) {
        connectCamera();
      }
    },
    getUserLandmarks: frameProcessor.getUserLandmarks
  });

  function handleTrackEnded() {
    if (!isActive || isSwitchingCamera || getState().currentScreen !== "camera") return;
    frameProcessor.clearDetectionState();
    if (typeof document !== "undefined" && document.hidden) {
      deactivate();
      return;
    }
    updateRuntime({ cameraReady: false, cameraError: null });
    void connectCamera();
  }

  /**
   * @param {string} deviceId
   * @param {"user" | "environment" | ""} preferredFacingMode
   * @param {boolean} isSwitch
   * @param {"user" | "environment" | ""} targetFacing
   */
  function runConnect(deviceId, preferredFacingMode, isSwitch, targetFacing) {
    if (!isActive || getState().currentScreen !== "camera") return Promise.resolve();
    if (!isSwitch && connectPromise && deviceId === connectingDeviceId) return connectPromise;
    connectingDeviceId = deviceId;
    const mySession = sessionToken;

    const task = (async () => {
      cameraView.setCameraErrorInfo(null);
      const res = await startStream(
        cameraView.video,
        deviceId,
        handleTrackEnded,
        preferredFacingMode
      );
      if (res.aborted) return;
      if (!isActive || mySession !== sessionToken || getState().currentScreen !== "camera") {
        stopStream(cameraView.video);
        return;
      }

      cameraView.setCameraErrorInfo(res.errorInfo || null);
      updateRuntime({ cameraReady: res.ok, cameraError: res.error });

      if (res.ok) {
        activeDeviceLabel = res.deviceLabel || "";
        activeFacingMode = resolveActiveCameraFacing(
          res.facingMode,
          res.deviceId,
          activeDeviceLabel,
          preferredFacingMode
        );

        if (res.deviceId && res.deviceId !== getState().settings.activeDeviceId) {
          updateSettings({ activeDeviceId: res.deviceId });
        }
        cameraView.setCameraMirrored(getEffectiveMirrorCamera());

        const cams = await listDevices().catch(() => cachedDevices);
        if (!isActive || mySession !== sessionToken || getState().currentScreen !== "camera") {
          return;
        }
        cachedDevices = cams;
        cameraView.setCameraList(cams, getState().settings.activeDeviceId, activeFacingMode);
        cameraView.setCameraSwitchState({
          canSwitch: cams.length >= 2,
          currentFacing: activeFacingMode || "user",
          isSwitching: isSwitchingCamera
        });
      } else {
        recorder.clearPending();
        frameProcessor.clearDetectionState();
        cameraView.updateHud(0, "Камера не активна", 0);
        if (isSwitch) {
          cameraView.showNotice(
            formatCameraSwitchError(targetFacing || preferredFacingMode || "user", res.error),
            "error"
          );
        }
      }
    })().finally(() => {
      if (connectPromise === task) {
        connectPromise = null;
        connectingDeviceId = "";
      }
    });

    connectPromise = task;
    return task;
  }

  /** @param {string} [deviceId] */
  function connectCamera(deviceId = getState().settings.activeDeviceId) {
    return runConnect(deviceId, "", false, "");
  }

  /** @param {string} deviceId */
  async function selectCamera(deviceId) {
    if (!isActive || getState().currentScreen !== "camera") return;
    if (isSwitchingCamera) {
      cameraView.setCameraList(cachedDevices, getState().settings.activeDeviceId, activeFacingMode);
      return;
    }

    const mySession = sessionToken;
    const selectedDev = cachedDevices.find((d) => d.deviceId === deviceId);
    const preferredFacing = resolveDeviceFacing(selectedDev, "", "") || "";
    const targetFacing =
      preferredFacing || (activeFacingMode === "environment" ? "user" : "environment");

    isSwitchingCamera = true;
    cameraView.setCameraSwitchState({ isSwitching: true });
    cameraView.clearNotice();
    frameProcessor.clearDetectionState();
    cameraView.updateHud(0, "Переключение камеры...", 0);

    try {
      await runConnect(deviceId, preferredFacing, true, targetFacing);
    } finally {
      if (mySession === sessionToken) {
        isSwitchingCamera = false;
        cameraView.setCameraSwitchState({
          canSwitch: cachedDevices.length >= 2,
          currentFacing: activeFacingMode || "user",
          isSwitching: false
        });
      }
    }
  }

  async function switchCamera() {
    if (!isActive || isSwitchingCamera || getState().currentScreen !== "camera") return;
    const mySession = sessionToken;
    isSwitchingCamera = true;
    cameraView.setCameraSwitchState({ isSwitching: true });

    try {
      if (cachedDevices.length < 2) {
        const fresh = await listDevices().catch(() => cachedDevices);
        if (!isActive || mySession !== sessionToken || getState().currentScreen !== "camera") {
          return;
        }
        cachedDevices = fresh;
      }

      const target = resolveNextCameraTarget(
        cachedDevices,
        getState().settings.activeDeviceId,
        activeFacingMode
      );
      if (!target) return;

      cameraView.clearNotice();
      frameProcessor.clearDetectionState();
      cameraView.updateHud(0, "Переключение камеры...", 0);
      await runConnect(target.deviceId, target.targetFacing, true, target.targetFacing);
    } finally {
      if (mySession === sessionToken) {
        isSwitchingCamera = false;
        cameraView.setCameraSwitchState({
          canSwitch: cachedDevices.length >= 2,
          currentFacing: activeFacingMode || "user",
          isSwitching: false
        });
      }
    }
  }

  /** @param {number} now */
  function tick(now) {
    if (!isActive) return;

    const dt = Math.min(100, Math.max(0, now - lastFrameTime));
    lastFrameTime = now;
    const st = getState();

    if (st.currentScreen === "camera" && !isSwitchingCamera) {
      recorder.step(dt);
      if (!isActive) return;
      frameProcessor.processFrame(dt, now, isVideoStreamReady(), getEffectiveMirrorCamera());
    }

    if (isActive) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function activate() {
    if (isActive) return;
    isActive = true;
    sessionToken += 1;
    isSwitchingCamera = false;
    cameraView.setCameraSwitchState({ isSwitching: false });
    frameProcessor.resetForSession();
    lastFrameTime = performance.now();
    cameraView.updateHud(0, "Встаньте в кадр", 0);
    connectCamera();
    rafId = requestAnimationFrame(tick);
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    sessionToken += 1;
    isSwitchingCamera = false;
    cameraView.setCameraSwitchState({ isSwitching: false });
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    recorder.cancel();
    cancelSpeech();
    stopStream(cameraView.video);
    frameProcessor.resetForSession();
    frameProcessor.clearOverlay();
    cameraView.updateHud(0, "Камера на паузе", 0);
    resetCameraRuntime();
  }

  function takeManualShot() {
    if (!isVideoStreamReady()) return;
    const st = getState();
    st.runtime.holdMs = 0;
    st.runtime.shutterCooldownMs = SHUTTER_COOLDOWN_MS;
    const score = frameProcessor.getLastScore();
    frameProcessor.takeShot(score, getEffectiveMirrorCamera());
    cameraView.updateHud(score, "Снимок сохранён!", 0);
  }

  return {
    activate,
    deactivate,
    connectCamera,
    selectCamera,
    switchCamera,
    takeManualShot,
    recordPose3Sec: () => recorder.request(),
    cancelRecordPose: () => recorder.cancel(),
    resetSmoothing: frameProcessor.resetSmoothing
  };
}
