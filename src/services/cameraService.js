import { classifyCameraError, inferFacingModeFromDevice } from "../core/cameraHudLogic.js";
import { CAMERA_RELEASE_DELAY_MS } from "../core/constants.js";

/** @type {MediaStream | null} */
let activeStream = null;
/** @type {(() => void) | null} */
let activeTrackCleanup = null;
let streamRequestId = 0;
/** @type {Map<string, string>} */
const deviceLabels = new Map();

/**
 * Остановка всех треков переданного MediaStream.
 * @param {MediaStream | null | undefined} stream
 * @returns {void}
 */
export function stopStreamTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
}

/**
 * Асинхронная пауза.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Получение списка доступных видеокамер.
 * @returns {Promise<MediaDeviceInfo[]>}
 */
export async function listVideoDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videos = devices.filter((d) => d.kind === "videoinput");
  videos.forEach((d) => {
    if (d.deviceId && d.label) deviceLabels.set(d.deviceId, d.label);
  });
  return videos;
}

/**
 * @param {string} deviceId
 * @returns {Promise<string>}
 */
async function resolveDeviceLabel(deviceId) {
  if (!deviceId) return "";
  const cached = deviceLabels.get(deviceId);
  if (cached) return cached;
  const videos = await listVideoDevices().catch(() => /** @type {MediaDeviceInfo[]} */ ([]));
  return videos.find((d) => d.deviceId === deviceId)?.label || "";
}

/**
 * Остановка текущего видеопотока с инвалидацией незавершенных асинхронных запусков.
 * @param {HTMLVideoElement | null} [videoEl]
 * @returns {void}
 */
export function stopCameraStream(videoEl = null) {
  streamRequestId += 1;
  if (activeTrackCleanup) {
    activeTrackCleanup();
    activeTrackCleanup = null;
  }
  const prevStream = activeStream;
  stopStreamTracks(prevStream);
  activeStream = null;
  if (videoEl) {
    const attached = videoEl.srcObject;
    if (
      attached &&
      attached !== prevStream &&
      typeof attached === "object" &&
      "getTracks" in attached
    ) {
      stopStreamTracks(/** @type {MediaStream} */ (attached));
    }
    videoEl.pause();
    videoEl.srcObject = null;
  }
}

/**
 * @typedef {Object} StartCameraResult
 * @property {boolean} ok
 * @property {boolean} [aborted]
 * @property {string} deviceId
 * @property {string} facingMode
 * @property {string} deviceLabel
 * @property {string | null} error
 * @property {import("../core/cameraHudLogic.js").CameraErrorInfo | null} [errorInfo]
 */

/** @returns {StartCameraResult} */
function createAbortedResult() {
  return {
    ok: false,
    aborted: true,
    deviceId: "",
    facingMode: "",
    deviceLabel: "",
    error: null,
    errorInfo: null
  };
}

/**
 * Запуск камеры с освобождением предыдущего потока, паузой сенсора и fallback по facingMode.
 * @param {HTMLVideoElement} videoEl
 * @param {string} [deviceId]
 * @param {() => void} [onTrackEnded]
 * @param {"user" | "environment" | ""} [preferredFacingMode]
 * @returns {Promise<StartCameraResult>}
 */
export async function startCameraStream(
  videoEl,
  deviceId = "",
  onTrackEnded,
  preferredFacingMode = ""
) {
  stopCameraStream(videoEl);
  const reqId = ++streamRequestId;

  const isSecure = typeof window === "undefined" ? true : window.isSecureContext !== false;
  const hasMediaDevices = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if (!isSecure || !hasMediaDevices) {
    const info = classifyCameraError(null, hasMediaDevices, isSecure);
    return {
      ok: false,
      deviceId: "",
      facingMode: "",
      deviceLabel: "",
      error: info.message,
      errorInfo: info
    };
  }

  await delay(CAMERA_RELEASE_DELAY_MS);
  if (reqId !== streamRequestId) return createAbortedResult();

  /** @param {MediaTrackConstraints} videoConstraints */
  async function requestStream(videoConstraints) {
    return navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  }

  try {
    /** @type {MediaStream} */
    let stream;
    try {
      const primary = deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: preferredFacingMode ? { ideal: preferredFacingMode } : "user"
          };
      stream = await requestStream(primary);
    } catch (firstErr) {
      if (reqId !== streamRequestId) return createAbortedResult();
      const firstName = /** @type {{ name?: string }} */ (firstErr)?.name || "";
      const isConstraintErr =
        firstName === "OverconstrainedError" ||
        firstName === "NotFoundError" ||
        firstName === "ConstraintNotSatisfiedError";
      const isReadableErr = firstName === "NotReadableError";

      if (deviceId && (isReadableErr || isConstraintErr)) {
        const label = await resolveDeviceLabel(deviceId);
        if (reqId !== streamRequestId) return createAbortedResult();
        const inferredFacing =
          inferFacingModeFromDevice(deviceId, label) || preferredFacingMode || null;
        if (inferredFacing) {
          stream = await requestStream({
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: { ideal: inferredFacing }
          });
        } else if (isConstraintErr) {
          stream = await requestStream({
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user"
          });
        } else {
          throw firstErr;
        }
      } else if (!deviceId && preferredFacingMode && isConstraintErr) {
        stream = await requestStream({ width: { ideal: 1280 }, height: { ideal: 720 } });
      } else {
        throw firstErr;
      }
    }

    if (reqId !== streamRequestId) {
      stopStreamTracks(stream);
      return createAbortedResult();
    }

    activeStream = stream;
    const track = stream.getVideoTracks()[0];
    const trackSettings = track?.getSettings?.();
    const actualId = trackSettings?.deviceId || "";
    const facingMode =
      typeof trackSettings?.facingMode === "string" ? trackSettings.facingMode : "";
    const deviceLabel = track?.label || "";
    if (actualId && deviceLabel) deviceLabels.set(actualId, deviceLabel);

    if (track && onTrackEnded) {
      const handleEnded = () => {
        if (reqId !== streamRequestId || activeStream !== stream) return;
        activeTrackCleanup = null;
        activeStream = null;
        onTrackEnded();
      };
      track.addEventListener("ended", handleEnded, { once: true });
      activeTrackCleanup = () => {
        track.removeEventListener("ended", handleEnded);
        track.onended = null;
      };
    }

    videoEl.srcObject = stream;
    await videoEl.play();
    if (reqId !== streamRequestId) {
      if (activeTrackCleanup) {
        activeTrackCleanup();
        activeTrackCleanup = null;
      }
      stopStreamTracks(stream);
      if (activeStream === stream) activeStream = null;
      videoEl.srcObject = null;
      return createAbortedResult();
    }
    return {
      ok: true,
      deviceId: actualId,
      facingMode,
      deviceLabel,
      error: null,
      errorInfo: null
    };
  } catch (err) {
    if (reqId !== streamRequestId) return createAbortedResult();
    const info = classifyCameraError(err, hasMediaDevices, isSecure);
    return {
      ok: false,
      deviceId: "",
      facingMode: "",
      deviceLabel: "",
      error: info.message,
      errorInfo: info
    };
  }
}

/**
 * Захват чистого кадра видео без HUD и наложений.
 * @param {HTMLVideoElement} videoEl
 * @param {boolean} [mirrored]
 * @param {string} [mimeType]
 * @param {number} [quality]
 * @returns {string | null}
 */
export function captureVideoFrame(
  videoEl,
  mirrored = true,
  mimeType = "image/jpeg",
  quality = 0.92
) {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) return null;

  const off = document.createElement("canvas");
  off.width = vw;
  off.height = vh;
  const ctx = off.getContext("2d");
  if (!ctx) return null;

  if (mirrored) {
    ctx.translate(vw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(videoEl, 0, 0, vw, vh);
  return off.toDataURL(mimeType, quality);
}

/**
 * Загрузка HTMLImageElement и генерация компактного Data URL для хранения.
 * @param {Blob | File} fileOrBlob
 * @returns {Promise<{ img: HTMLImageElement, dataUrl: string, aspect: number }>}
 */
export function loadImageFile(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const iw = img.naturalWidth || img.width || 480;
      const ih = img.naturalHeight || img.height || 640;
      const maxDim = 960;
      const scale = Math.min(1, maxDim / Math.max(iw, ih));
      const c = document.createElement("canvas");
      c.width = Math.round(iw * scale);
      c.height = Math.round(ih * scale);
      const ctx = c.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL("image/jpeg", 0.86);
      resolve({ img, dataUrl, aspect: iw / ih });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };
    img.src = url;
  });
}
