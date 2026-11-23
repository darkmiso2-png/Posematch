import { stepAutoShutter } from "../core/cameraHudLogic.js";
import { transformShotLandmarksForCapture } from "../core/cameraMirrorLogic.js";
import { createSmoothingState } from "../core/poseAlignment.js";
import { evaluatePose } from "../core/poseEvaluator.js";
import { cloneLandmarks, getMirroredCopy } from "../core/poseMath.js";
import {
  playParktronicBeep,
  playShutterSound,
  speakRussianHint
} from "../services/audioVoiceService.js";
import { captureVideoFrame } from "../services/cameraService.js";
import { detectPoseOnVideo } from "../services/mediapipeService.js";
import { addCapturedShot, getState } from "../state/store.js";
import { drawStageOverlay } from "./overlayRenderer.js";

/**
 * Процессор покадрового анализа позы, автозатвора (800 ms) и захвата снимка.
 * @param {ReturnType<import("./screens/cameraScreen.js").createCameraScreen>} cameraView
 */
export function createCameraFrameProcessor(cameraView) {
  const smoothing = createSmoothingState();
  /** @type {import("../core/types.js").JointPoint[] | null} */
  let userLandmarks = null;
  let lastVideoTime = -1;
  let lastTimestamp = 0;
  let lastScore = 0;

  function clearOverlay() {
    const c = cameraView.overlayCanvas;
    const ctx = c.getContext("2d");
    if (ctx && c.width && c.height) {
      ctx.clearRect(0, 0, c.width, c.height);
    }
  }

  function clearDetectionState() {
    userLandmarks = null;
    lastVideoTime = -1;
    clearOverlay();
  }

  function resetForSession() {
    userLandmarks = null;
    lastVideoTime = -1;
    lastScore = 0;
    smoothing.initialized = false;
  }

  /**
   * Захватывает текущий кадр видео и сохраняет снимок в Store.
   * @param {number} score
   * @param {boolean} mirrorCamera
   */
  function takeShot(score, mirrorCamera) {
    const st = getState();
    if (!st.activeReference) return;

    const dataUrl = captureVideoFrame(cameraView.video, mirrorCamera, "image/jpeg", 0.92);
    if (!dataUrl) return;

    playShutterSound();
    cameraView.triggerFlash();
    const refLms = st.settings.mirrorRef
      ? getMirroredCopy(st.activeReference.landmarks)
      : cloneLandmarks(st.activeReference.landmarks);

    addCapturedShot({
      id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      referenceId: st.activeReference.id,
      referenceName: st.activeReference.name,
      referenceImageDataUrl: st.activeReference.imageDataUrl,
      refMirrored: st.settings.mirrorRef,
      cameraMirrored: mirrorCamera,
      imageDataUrl: dataUrl,
      score,
      userLandmarks: transformShotLandmarksForCapture(userLandmarks, mirrorCamera),
      refLandmarks: refLms,
      createdAt: Date.now()
    });
  }

  /**
   * Выполняет один шаг детекции позы, отрисовки оверлея, автозатвора и аудио-обратной связи.
   * @param {number} dtMs
   * @param {number} now
   * @param {boolean} streamReady
   * @param {boolean} mirrorCamera
   */
  function processFrame(dtMs, now, streamReady, mirrorCamera) {
    const st = getState();
    const v = cameraView.video;
    const c = cameraView.overlayCanvas;

    if (v.videoWidth && v.videoHeight && (c.width !== v.videoWidth || c.height !== v.videoHeight)) {
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

    if (!ctx || !refLms || !ref || !streamReady) return;

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
          dtMs,
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
        takeShot(ev.totalScore, mirrorCamera);
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
        const voiceRes = speakRussianHint(ev.worstHint, st.settings.voice, now);
        if (voiceRes.reason === "no_russian_voice") {
          cameraView.notifyMissingRuVoice();
        }
      }
      return;
    }

    lastScore = 0;
    const resetStep = stepAutoShutter(
      { holdMs: st.runtime.holdMs, cooldownMs: st.runtime.shutterCooldownMs },
      {
        dtMs,
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

  return {
    processFrame,
    takeShot,
    clearOverlay,
    clearDetectionState,
    resetForSession,
    resetSmoothing: () => {
      smoothing.initialized = false;
    },
    getUserLandmarks: () => userLandmarks,
    getLastScore: () => lastScore
  };
}
