import {
  cancelCountdown,
  createIdleCountdown,
  startCountdown,
  stepCountdown
} from "../core/cameraHudLogic.js";
import { transformShotLandmarksForCapture } from "../core/cameraMirrorLogic.js";
import { POSE_RECORD_SECONDS } from "../core/constants.js";
import { cloneLandmarks } from "../core/poseMath.js";
import { playCountdownTick, playShutterSound } from "../services/audioVoiceService.js";
import { captureVideoFrame } from "../services/cameraService.js";
import { openCalibrationDraft, updateRuntime } from "../state/store.js";

/**
 * Контроллер 3-секундной записи эталонной позы с камеры.
 * @param {{
 *   cameraView: ReturnType<import("./screens/cameraScreen.js").createCameraScreen>,
 *   isStreamReady: () => boolean,
 *   isCameraMirrored: () => boolean,
 *   ensureConnect: () => void,
 *   getUserLandmarks: () => import("../core/types.js").JointPoint[] | null
 * }} deps
 */
export function createPoseRecorder(deps) {
  let countdownState = createIdleCountdown();
  let pendingRequest = false;

  function startNow() {
    if (countdownState.status === "running") return;
    if (!deps.isStreamReady()) {
      pendingRequest = false;
      deps.cameraView.showNotice("Подключите камеру перед записью позы.", "error");
      return;
    }

    pendingRequest = false;
    deps.cameraView.clearNotice();
    countdownState = startCountdown(POSE_RECORD_SECONDS);
    updateRuntime({
      isRecordingPose: true,
      countdownSec: countdownState.displaySec,
      holdMs: 0
    });
    playCountdownTick();
  }

  function finish() {
    updateRuntime({ isRecordingPose: false, countdownSec: 0 });
    if (!deps.isStreamReady()) {
      deps.cameraView.showNotice("Камера не готова — запись позы отменена.", "error");
      return;
    }

    const userLms = deps.getUserLandmarks();
    if (!userLms) {
      deps.cameraView.showNotice("Человек не найден в кадре — запись позы отменена.", "error");
      deps.cameraView.updateHud(0, "Встаньте в кадр полностью и повторите запись", 0);
      return;
    }

    const { video } = deps.cameraView;
    const mirrored = deps.isCameraMirrored();
    const dataUrl = captureVideoFrame(video, mirrored, "image/jpeg", 0.9);
    if (!dataUrl) return;

    playShutterSound();
    deps.cameraView.triggerFlash();
    const captured = transformShotLandmarksForCapture(userLms, mirrored);
    if (!captured) return;
    openCalibrationDraft({
      id: `rec-${Date.now()}`,
      name: "Моя поза",
      source: "recorded",
      category: "saved",
      imageDataUrl: dataUrl,
      aspect: video.videoWidth / video.videoHeight,
      landmarks: captured,
      autoLandmarks: cloneLandmarks(captured),
      autoDetected: true,
      createdAt: Date.now()
    });
  }

  return {
    request() {
      if (countdownState.status === "running") return;
      if (deps.isStreamReady()) {
        startNow();
        return;
      }
      pendingRequest = true;
      deps.ensureConnect();
    },

    cancel() {
      pendingRequest = false;
      if (countdownState.status === "running") {
        countdownState = cancelCountdown(countdownState);
        countdownState = createIdleCountdown();
        updateRuntime({ isRecordingPose: false, countdownSec: 0 });
      }
    },

    clearPending() {
      pendingRequest = false;
    },

    /** @param {number} dtMs */
    step(dtMs) {
      if (pendingRequest && deps.isStreamReady()) {
        startNow();
      }
      if (countdownState.status !== "running") return;

      const nextCd = stepCountdown(countdownState, dtMs);
      countdownState = nextCd.state;
      if (nextCd.tickChanged) {
        updateRuntime({ countdownSec: countdownState.displaySec });
        playCountdownTick();
      }
      if (nextCd.finished) {
        countdownState = createIdleCountdown();
        finish();
      }
    }
  };
}
