import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { MODEL_URL, WASM_URL } from "../core/constants.js";
import { cloneLandmarks } from "../core/poseMath.js";

/** @type {PoseLandmarker | null} */
let landmarker = null;
let isAnalyzingImage = false;

/**
 * Инициализация MediaPipe PoseLandmarker с GPU -> CPU fallback.
 * @param {(status: "loading" | "gpu" | "cpu" | "error", msg: string) => void} onStatus
 * @returns {Promise<PoseLandmarker | null>}
 */
export async function initPoseLandmarker(onStatus) {
  onStatus("loading", "Загрузка ИИ...");
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    try {
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      onStatus("gpu", "GPU активен • Lite f16");
    } catch (gpuErr) {
      console.warn("GPU delegate fallback to CPU:", gpuErr);
      const cpuVision = await FilesetResolver.forVisionTasks(WASM_URL);
      landmarker = await PoseLandmarker.createFromOptions(cpuVision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        runningMode: "VIDEO",
        numPoses: 1
      });
      onStatus("cpu", "CPU режим • Lite f16");
    }
    return landmarker;
  } catch (err) {
    console.error("MediaPipe init error:", err);
    landmarker = null;
    onStatus("error", "Ошибка загрузки модели");
    return null;
  }
}

/**
 * Детекция позы на статическом изображении (с временным переключением в IMAGE mode).
 * @param {HTMLImageElement} img
 * @returns {Promise<import("../core/types.js").JointPoint[] | null>}
 */
export async function detectPoseOnImage(img) {
  if (!landmarker) return null;
  isAnalyzingImage = true;
  try {
    await landmarker.setOptions({ runningMode: "IMAGE" });
    const res = landmarker.detect(img);
    if (res && res.landmarks && res.landmarks.length > 0) {
      return cloneLandmarks(res.landmarks[0]);
    }
    return null;
  } catch (err) {
    console.warn("Image pose detection error:", err);
    return null;
  } finally {
    try {
      await landmarker.setOptions({ runningMode: "VIDEO" });
    } catch (e) {
      console.warn("Restore VIDEO mode error:", e);
    }
    isAnalyzingImage = false;
  }
}

/**
 * Детекция позы на текущем кадре видеопотока.
 * @param {HTMLVideoElement} video
 * @param {number} timestampMs
 * @returns {import("../core/types.js").JointPoint[] | null}
 */
export function detectPoseOnVideo(video, timestampMs) {
  if (!landmarker || isAnalyzingImage || video.readyState < 2 || !video.videoWidth) return null;
  try {
    const res = landmarker.detectForVideo(video, timestampMs);
    if (res && res.landmarks && res.landmarks.length > 0) {
      return cloneLandmarks(res.landmarks[0]);
    }
  } catch (err) {
    console.warn("Video pose detection error:", err);
  }
  return null;
}
