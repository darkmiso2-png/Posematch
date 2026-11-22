import { shouldMirrorCamera } from "../core/cameraHudLogic.js";
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
 */
export function createCameraController(cameraView) {
  const frameProcessor = createCameraFrameProcessor(cameraView);
  let lastFrameTime = performance.now();
  let isActive = false;
  let rafId = 0;
  let mirrorCamera = true;

  /** @type {Promise<void> | null} */
  let connectPromise = null;
  let connectingDeviceId = "";

  function isVideoStreamReady() {
    const v = cameraView.video;
    const st = getState();
    return Boolean(
      isActive &&
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
    isCameraMirrored: () => mirrorCamera,
    ensureConnect: () => {
      if (!connectPromise && !getState().runtime.cameraError) {
        connectCamera();
      }
    },
    getUserLandmarks: frameProcessor.getUserLandmarks
  });

  function handleTrackEnded() {
    if (!isActive || getState().currentScreen !== "camera") return;
    frameProcessor.clearDetectionState();
    if (typeof document !== "undefined" && document.hidden) {
      deactivate();
      return;
    }
    updateRuntime({ cameraReady: false, cameraError: null });
    void connectCamera();
  }

  /** @param {string} [deviceId] */
  function connectCamera(deviceId = getState().settings.activeDeviceId) {
    if (!isActive || getState().currentScreen !== "camera") return Promise.resolve();
    if (connectPromise && deviceId === connectingDeviceId) return connectPromise;
    connectingDeviceId = deviceId;

    const task = (async () => {
      cameraView.setCameraErrorInfo(null);
      const res = await startCameraStream(cameraView.video, deviceId, handleTrackEnded);
      if (res.aborted) return;
      if (!isActive || getState().currentScreen !== "camera") {
        stopCameraStream(cameraView.video);
        return;
      }

      cameraView.setCameraErrorInfo(res.errorInfo || null);
      updateRuntime({ cameraReady: res.ok, cameraError: res.error });

      if (res.ok) {
        mirrorCamera = shouldMirrorCamera(res.facingMode, res.deviceLabel);
        cameraView.setCameraMirrored(mirrorCamera);
        if (res.deviceId !== getState().settings.activeDeviceId) {
          updateSettings({ activeDeviceId: res.deviceId });
        }
        const cams = await listVideoDevices();
        if (isActive && getState().currentScreen === "camera") {
          cameraView.setCameraList(cams, getState().settings.activeDeviceId);
        }
      } else {
        recorder.clearPending();
        frameProcessor.clearDetectionState();
        cameraView.updateHud(0, "Камера не активна", 0);
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

  /** @param {number} now */
  function tick(now) {
    if (!isActive) return;

    const dt = Math.min(100, Math.max(0, now - lastFrameTime));
    lastFrameTime = now;
    const st = getState();

    if (st.currentScreen === "camera") {
      recorder.step(dt);
      if (!isActive) return;
      frameProcessor.processFrame(dt, now, isVideoStreamReady(), mirrorCamera);
    }

    if (isActive) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function activate() {
    if (isActive) return;
    isActive = true;
    frameProcessor.resetForSession();
    lastFrameTime = performance.now();
    cameraView.updateHud(0, "Встаньте в кадр", 0);
    connectCamera();
    rafId = requestAnimationFrame(tick);
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    recorder.cancel();
    cancelSpeech();
    stopCameraStream(cameraView.video);
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
    frameProcessor.takeShot(score, mirrorCamera);
    cameraView.updateHud(score, "Снимок сохранён!", 0);
  }

  return {
    activate,
    deactivate,
    connectCamera,
    takeManualShot,
    recordPose3Sec: () => recorder.request(),
    cancelRecordPose: () => recorder.cancel(),
    resetSmoothing: frameProcessor.resetSmoothing
  };
}
