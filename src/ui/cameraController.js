import {
  AUTO_SHUTTER_HOLD_MS,
  POSE_RECORD_SECONDS,
  SHUTTER_COOLDOWN_MS
} from "../core/constants.js";
import { createSmoothingState } from "../core/poseAlignment.js";
import { evaluatePose } from "../core/poseEvaluator.js";
import { cloneLandmarks, getMirroredCopy } from "../core/poseMath.js";
import {
  playCountdownTick,
  playParktronicBeep,
  playShutterSound,
  speakRussianHint
} from "../services/audioVoiceService.js";
import {
  captureVideoFrame,
  listVideoDevices,
  startCameraStream
} from "../services/cameraService.js";
import { detectPoseOnVideo } from "../services/mediapipeService.js";
import {
  addCapturedShot,
  getState,
  openCalibrationDraft,
  updateRuntime,
  updateSettings
} from "../state/store.js";
import { drawStageOverlay } from "./overlayRenderer.js";

/**
 * Контроллер видеопотока, автоспуска (800 ms) и записи позы 3 сек.
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

  /** @type {Promise<void> | null} */
  let connectPromise = null;
  let connectingDeviceId = "";

  /** @param {string} [deviceId] */
  function connectCamera(deviceId = getState().settings.activeDeviceId) {
    if (connectPromise && deviceId === connectingDeviceId) return connectPromise;
    connectingDeviceId = deviceId;
    const task = (async () => {
      const res = await startCameraStream(cameraView.video, deviceId);
      if (res.aborted) return;
      updateRuntime({ cameraReady: res.ok, cameraError: res.error });
      if (res.ok) {
        if (res.deviceId) updateSettings({ activeDeviceId: res.deviceId });
        const cams = await listVideoDevices();
        cameraView.setCameraList(cams, getState().settings.activeDeviceId);
      }
    })().finally(() => {
      if (connectPromise === task) connectPromise = null;
    });
    connectPromise = task;
    return task;
  }

  /** @param {number} score */
  function takeShot(score) {
    const st = getState();
    const dataUrl = captureVideoFrame(cameraView.video, true, "image/jpeg", 0.92);
    if (!dataUrl || !st.activeReference) return;
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

  async function recordPose3Sec() {
    if (getState().runtime.isRecordingPose) return;
    if (!cameraView.video.videoWidth) {
      await connectCamera();
      for (let i = 0; i < 20 && !cameraView.video.videoWidth; i += 1) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    if (!cameraView.video.videoWidth) {
      updateRuntime({ cameraError: "Подключите камеру для записи позы." });
      return;
    }
    updateRuntime({ isRecordingPose: true, countdownSec: POSE_RECORD_SECONDS, holdMs: 0 });
    for (let sec = POSE_RECORD_SECONDS; sec >= 1; sec -= 1) {
      updateRuntime({ countdownSec: sec });
      playCountdownTick();
      await new Promise((r) => setTimeout(r, 1000));
    }
    updateRuntime({ isRecordingPose: false, countdownSec: 0 });
    if (!userLandmarks) {
      cameraView.updateHud(0, "Человек не найден — запись отменена", 0);
      return;
    }
    const mirrored = getState().settings.mirrorRef;
    const dataUrl = captureVideoFrame(cameraView.video, mirrored, "image/jpeg", 0.9);
    if (!dataUrl) return;
    playShutterSound();
    cameraView.triggerFlash();
    const captured = mirrored ? getMirroredCopy(userLandmarks) : cloneLandmarks(userLandmarks);
    openCalibrationDraft({
      id: `rec-${Date.now()}`,
      name: "Моя поза",
      source: "recorded",
      category: "saved",
      imageDataUrl: dataUrl,
      aspect: cameraView.video.videoWidth / cameraView.video.videoHeight,
      landmarks: captured,
      autoLandmarks: captured,
      autoDetected: true,
      createdAt: Date.now()
    });
  }

  /** @param {number} now */
  function tick(now) {
    const dt = Math.min(100, Math.max(0, now - lastFrameTime));
    lastFrameTime = now;
    const st = getState();
    if (st.runtime.shutterCooldownMs > 0) {
      st.runtime.shutterCooldownMs = Math.max(0, st.runtime.shutterCooldownMs - dt);
    }
    if (st.currentScreen === "camera") {
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
      if (ctx && refLms && ref) {
        if (userLandmarks) {
          const va = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
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
          const above = ev.totalScore >= st.settings.threshold;
          if (above && !st.runtime.isRecordingPose && st.runtime.shutterCooldownMs <= 0) {
            st.runtime.holdMs += dt;
            if (st.runtime.holdMs >= AUTO_SHUTTER_HOLD_MS) {
              st.runtime.holdMs = 0;
              st.runtime.shutterCooldownMs = SHUTTER_COOLDOWN_MS;
              takeShot(ev.totalScore);
            }
          } else {
            st.runtime.holdMs = Math.max(0, st.runtime.holdMs - dt * 2.5);
          }
          const hint = above
            ? st.runtime.shutterCooldownMs > 0
              ? "Снимок сохранён!"
              : "Удерживайте позу..."
            : ev.worstHint;
          cameraView.updateHud(ev.totalScore, hint, st.runtime.holdMs);
          playParktronicBeep(ev.totalScore, st.settings.threshold, st.settings.parktronic, now);
          if (!above && st.runtime.shutterCooldownMs <= 0)
            speakRussianHint(ev.worstHint, st.settings.voice, now);
        } else {
          lastScore = 0;
          st.runtime.holdMs = 0;
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
    requestAnimationFrame(tick);
  }

  return {
    connectCamera,
    takeManualShot: () => takeShot(lastScore),
    recordPose3Sec,
    resetSmoothing: () => {
      smoothing.initialized = false;
    },
    startLoop: () => requestAnimationFrame(tick)
  };
}
