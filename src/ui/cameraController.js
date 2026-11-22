import { stepAutoShutter } from "../core/cameraHudLogic.js";
import { SHUTTER_COOLDOWN_MS } from "../core/constants.js";
import { createSmoothingState } from "../core/poseAlignment.js";
import { evaluatePose } from "../core/poseEvaluator.js";
import { cloneLandmarks, getMirroredCopy } from "../core/poseMath.js";
import {
  cancelSpeech,
  playParktronicBeep,
  playShutterSound,
  speakRussianHint
} from "../services/audioVoiceService.js";
import {
  captureVideoFrame,
  listVideoDevices,
  startCameraStream,
  stopCameraStream
} from "../services/cameraService.js";
import { detectPoseOnVideo } from "../services/mediapipeService.js";
import {
  addCapturedShot,
  getState,
  resetCameraRuntime,
  updateRuntime,
  updateSettings
} from "../state/store.js";
import { createPoseRecorder } from "./cameraPoseRecorder.js";
import { drawStageOverlay } from "./overlayRenderer.js";

/**
 * Контроллер видеопотока, автозатвора (800 ms), паузы/возобновления и записи позы 3 сек.
 * @param {ReturnType<import("./screens/cameraScreen.js").createCameraScreen>} cameraView
 */
export function createCameraController(cameraView) {
  const smoothing = createSmoothingState();
  /** @type {import("../core/types.js").JointPoint[] | null} */
  let userLandmarks = null;
  let lastVideoTime = -1;
  let lastTimestamp = 0;
  let lastFrameTime = performance.now();
  let lastScore = 0;

  let isActive = false;
  let rafId = 0;

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

  function clearOverlayCanvas() {
    const c = cameraView.overlayCanvas;
    const ctx = c.getContext("2d");
    if (ctx && c.width && c.height) {
      ctx.clearRect(0, 0, c.width, c.height);
    }
  }

  const recorder = createPoseRecorder({
    cameraView,
    isStreamReady: isVideoStreamReady,
    ensureConnect: () => {
      if (!connectPromise && !getState().runtime.cameraError) {
        connectCamera();
      }
    },
    getUserLandmarks: () => userLandmarks
  });

  /** @param {string} [deviceId] */
  function connectCamera(deviceId = getState().settings.activeDeviceId) {
    if (!isActive || getState().currentScreen !== "camera") return Promise.resolve();
    if (connectPromise && deviceId === connectingDeviceId) return connectPromise;
    connectingDeviceId = deviceId;

    const task = (async () => {
      cameraView.setCameraErrorInfo(null);
      const res = await startCameraStream(cameraView.video, deviceId);
      if (res.aborted || !isActive || getState().currentScreen !== "camera") {
        stopCameraStream(cameraView.video);
        return;
      }

      cameraView.setCameraErrorInfo(res.errorInfo || null);
      updateRuntime({ cameraReady: res.ok, cameraError: res.error });

      if (res.ok) {
        if (res.deviceId !== getState().settings.activeDeviceId) {
          updateSettings({ activeDeviceId: res.deviceId });
        }
        const cams = await listVideoDevices();
        if (isActive && getState().currentScreen === "camera") {
          cameraView.setCameraList(cams, getState().settings.activeDeviceId);
        }
      } else {
        recorder.clearPending();
        userLandmarks = null;
        clearOverlayCanvas();
        cameraView.updateHud(0, "Камера не активна", 0);
      }
    })().finally(() => {
      if (connectPromise === task) connectPromise = null;
    });

    connectPromise = task;
    return task;
  }

  /** @param {number} score */
  function takeShot(score) {
    if (!isVideoStreamReady()) return;
    const st = getState();
    if (!st.activeReference) return;

    const dataUrl = captureVideoFrame(cameraView.video, true, "image/jpeg", 0.92);
    if (!dataUrl) return;

    playShutterSound();
    cameraView.triggerFlash();
    const refLms = st.settings.mirrorRef
      ? getMirroredCopy(st.activeReference.landmarks)
      : cloneLandmarks(st.activeReference.landmarks);

    addCapturedShot({
      id: `shot-${Date.now()}`,
      referenceId: st.activeReference.id,
      imageDataUrl: dataUrl,
      score,
      userLandmarks: userLandmarks ? getMirroredCopy(userLandmarks) : null,
      refLandmarks: refLms,
      createdAt: Date.now()
    });
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

      const v = cameraView.video;
      const c = cameraView.overlayCanvas;
      if (
        v.videoWidth &&
        v.videoHeight &&
        (c.width !== v.videoWidth || c.height !== v.videoHeight)
      ) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }

      if (v.videoWidth > 0 && v.readyState >= 2 && v.currentTime !== lastVideoTime) {
        lastVideoTime = v.currentTime;
        lastTimestamp = Math.max(lastTimestamp + 1, Math.round(now));
        userLandmarks = detectPoseOnVideo(v, lastTimestamp);
      }

      const ref = st.activeReference;
      const refLms = ref
        ? st.settings.mirrorRef
          ? getMirroredCopy(ref.landmarks)
          : ref.landmarks
        : null;
      const ctx = c.getContext("2d");
      const streamReady = isVideoStreamReady();

      if (ctx && refLms && ref && streamReady) {
        if (userLandmarks) {
          const va = v.videoWidth / v.videoHeight;
          const ev = evaluatePose(userLandmarks, refLms, va, ref.aspect);
          lastScore = ev.totalScore;
          drawStageOverlay(
            ctx,
            c.width,
            c.height,
            userLandmarks,
            refLms,
            ref.aspect,
            st.settings.attachToBody,
            smoothing,
            ev
          );

          const shutterStep = stepAutoShutter(
            { holdMs: st.runtime.holdMs, cooldownMs: st.runtime.shutterCooldownMs },
            {
              dtMs: dt,
              hasPose: true,
              score: ev.totalScore,
              threshold: st.settings.threshold,
              isRecording: st.runtime.isRecordingPose,
              cameraReady: streamReady
            }
          );
          st.runtime.holdMs = shutterStep.holdMs;
          st.runtime.shutterCooldownMs = shutterStep.cooldownMs;

          if (shutterStep.shouldShoot) {
            takeShot(ev.totalScore);
          }

          const above = ev.totalScore >= st.settings.threshold;
          const hint = above
            ? st.runtime.shutterCooldownMs > 0
              ? "Снимок сохранён!"
              : "Удерживайте позу..."
            : ev.worstHint;
          cameraView.updateHud(ev.totalScore, hint, st.runtime.holdMs);
          playParktronicBeep(ev.totalScore, st.settings.threshold, st.settings.parktronic, now);
          if (!above && !st.runtime.isRecordingPose && st.runtime.shutterCooldownMs <= 0) {
            speakRussianHint(ev.worstHint, st.settings.voice, now);
          }
        } else {
          lastScore = 0;
          const resetStep = stepAutoShutter(
            { holdMs: st.runtime.holdMs, cooldownMs: st.runtime.shutterCooldownMs },
            {
              dtMs: dt,
              hasPose: false,
              score: 0,
              threshold: st.settings.threshold,
              isRecording: st.runtime.isRecordingPose,
              cameraReady: streamReady
            }
          );
          st.runtime.holdMs = resetStep.holdMs;
          st.runtime.shutterCooldownMs = resetStep.cooldownMs;

          drawStageOverlay(
            ctx,
            c.width,
            c.height,
            null,
            refLms,
            ref.aspect,
            st.settings.attachToBody,
            smoothing,
            null
          );
          cameraView.updateHud(0, "Встаньте в кадр", 0);
        }
      }
    }

    if (isActive) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function activate() {
    if (isActive) return;
    isActive = true;
    lastVideoTime = -1;
    lastScore = 0;
    userLandmarks = null;
    smoothing.initialized = false;
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
    userLandmarks = null;
    lastVideoTime = -1;
    lastScore = 0;
    clearOverlayCanvas();
    cameraView.updateHud(0, "Камера на паузе", 0);
    resetCameraRuntime();
  }

  function takeManualShot() {
    if (!isVideoStreamReady()) return;
    const st = getState();
    st.runtime.holdMs = 0;
    st.runtime.shutterCooldownMs = SHUTTER_COOLDOWN_MS;
    takeShot(lastScore);
    cameraView.updateHud(lastScore, "Снимок сохранён!", 0);
  }

  return {
    activate,
    deactivate,
    connectCamera,
    takeManualShot,
    recordPose3Sec: () => recorder.request(),
    cancelRecordPose: () => recorder.cancel(),
    resetSmoothing: () => {
      smoothing.initialized = false;
    }
  };
}
