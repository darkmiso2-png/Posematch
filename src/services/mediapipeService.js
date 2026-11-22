import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  HEAVY_MODEL_URL,
  IMAGE_POSE_CONFIDENCE,
  IMAGE_PREPROCESS_PAD_RATIO,
  MODEL_URL,
  WASM_URL
} from "../core/constants.js";
import { cloneLandmarks, remapPaddedLandmarks } from "../core/poseMath.js";

/** @type {PoseLandmarker | null} */
let landmarker = null;
/** @type {PoseLandmarker | null} */
let heavyImageLandmarker = null;
/** @type {Promise<PoseLandmarker | null> | null} */
let heavyLandmarkerPromise = null;
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
 * Ленивая загрузка и кэширование Heavy-модели для статичных фото.
 * При ошибке сбрасывает кэш промиса для возможности повтора при восстановлении сети.
 * @returns {Promise<PoseLandmarker | null>}
 */
async function getHeavyImageLandmarker() {
  if (heavyImageLandmarker) return heavyImageLandmarker;
  if (!heavyLandmarkerPromise) {
    heavyLandmarkerPromise = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        try {
          heavyImageLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HEAVY_MODEL_URL, delegate: "GPU" },
            runningMode: "IMAGE",
            numPoses: 1,
            minPoseDetectionConfidence: IMAGE_POSE_CONFIDENCE,
            minPosePresenceConfidence: IMAGE_POSE_CONFIDENCE
          });
        } catch (gpuErr) {
          console.warn("Heavy GPU delegate fallback to CPU:", gpuErr);
          const cpuVision = await FilesetResolver.forVisionTasks(WASM_URL);
          heavyImageLandmarker = await PoseLandmarker.createFromOptions(cpuVision, {
            baseOptions: { modelAssetPath: HEAVY_MODEL_URL, delegate: "CPU" },
            runningMode: "IMAGE",
            numPoses: 1,
            minPoseDetectionConfidence: IMAGE_POSE_CONFIDENCE,
            minPosePresenceConfidence: IMAGE_POSE_CONFIDENCE
          });
        }
        return heavyImageLandmarker;
      } catch (err) {
        console.warn("Heavy PoseLandmarker load error:", err);
        heavyImageLandmarker = null;
        heavyLandmarkerPromise = null;
        return null;
      }
    })();
  }
  return heavyLandmarkerPromise;
}

/**
 * Рисует копию изображения на нейтральном сером фоне с отступами 15% и мягким фильтром.
 * @param {HTMLImageElement} img
 * @returns {{ canvas: HTMLCanvasElement, layout: import("../core/poseMath.js").PaddedCanvasLayout } | null}
 */
function buildPreprocessedPaddedCanvas(img) {
  if (typeof document === "undefined") return null;
  const srcW = img.naturalWidth || img.width || 480;
  const srcH = img.naturalHeight || img.height || 640;
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const imgW = Math.max(1, Math.round(srcW * scale));
  const imgH = Math.max(1, Math.round(srcH * scale));
  const padX = Math.round(imgW * IMAGE_PREPROCESS_PAD_RATIO);
  const padY = Math.round(imgH * IMAGE_PREPROCESS_PAD_RATIO);
  const canvasW = imgW + padX * 2;
  const canvasH = imgH + padY * 2;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.save();
  ctx.filter = "contrast(1.18) brightness(1.15) blur(1px)";
  ctx.drawImage(img, padX, padY, imgW, imgH);
  ctx.restore();

  return {
    canvas,
    layout: { imgX: padX, imgY: padY, imgW, imgH, canvasW, canvasH }
  };
}

/**
 * Попытка 1: быстрый Lite IMAGE-детектор с порогом 0.2 и возвратом в VIDEO 0.5.
 * @param {HTMLImageElement} img
 * @returns {Promise<import("../core/types.js").JointPoint[] | null>}
 */
async function detectWithLiteImage(img) {
  if (!landmarker) return null;
  isAnalyzingImage = true;
  try {
    await landmarker.setOptions({
      runningMode: "IMAGE",
      minPoseDetectionConfidence: IMAGE_POSE_CONFIDENCE,
      minPosePresenceConfidence: IMAGE_POSE_CONFIDENCE
    });
    const res = landmarker.detect(img);
    if (res && res.landmarks && res.landmarks.length > 0) {
      return cloneLandmarks(res.landmarks[0]);
    }
    return null;
  } catch (err) {
    console.warn("Lite image pose detection error:", err);
    return null;
  } finally {
    try {
      await landmarker.setOptions({
        runningMode: "VIDEO",
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5
      });
    } catch (e) {
      console.warn("Restore VIDEO mode error:", e);
    }
    isAnalyzingImage = false;
  }
}

/**
 * Каскадная детекция позы на статичном фото:
 * 1) Lite (0.2) -> 2) Heavy (0.2) -> 3) Heavy на padded-холсте с предобработкой.
 * @param {HTMLImageElement} img
 * @returns {Promise<import("../core/types.js").JointPoint[] | null>}
 */
export async function detectPoseOnImage(img) {
  try {
    const liteDetected = await detectWithLiteImage(img);
    if (liteDetected) return liteDetected;

    const heavy = await getHeavyImageLandmarker();
    if (!heavy) return null;

    const heavyOrig = heavy.detect(img);
    if (heavyOrig && heavyOrig.landmarks && heavyOrig.landmarks.length > 0) {
      return cloneLandmarks(heavyOrig.landmarks[0]);
    }

    const prep = buildPreprocessedPaddedCanvas(img);
    if (!prep) return null;

    const heavyPadded = heavy.detect(prep.canvas);
    if (heavyPadded && heavyPadded.landmarks && heavyPadded.landmarks.length > 0) {
      return remapPaddedLandmarks(
        cloneLandmarks(heavyPadded.landmarks[0]),
        IMAGE_PREPROCESS_PAD_RATIO,
        prep.layout
      );
    }
    return null;
  } catch (err) {
    console.warn("Image pose cascade error:", err);
    return null;
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
