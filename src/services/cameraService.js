import { classifyCameraError } from "../core/cameraHudLogic.js";

/** @type {MediaStream | null} */
let activeStream = null;
/** @type {(() => void) | null} */
let activeTrackCleanup = null;
let streamRequestId = 0;

/**
 * Получение списка доступных видеокамер.
 * @returns {Promise<MediaDeviceInfo[]>}
 */
export async function listVideoDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
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
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }
  if (videoEl) {
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

/**
 * Запуск камеры с корректным освобождением предыдущего потока и защитой от гонок.
 * При устаревшем deviceId (OverconstrainedError/NotFoundError) автоматически пробует камеру по умолчанию.
 * @param {HTMLVideoElement} videoEl
 * @param {string} [deviceId]
 * @param {() => void} [onTrackEnded]
 * @returns {Promise<StartCameraResult>}
 */
export async function startCameraStream(videoEl, deviceId = "", onTrackEnded) {
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

  /** @param {string} targetId */
  async function requestStream(targetId) {
    /** @type {MediaStreamConstraints} */
    const constraints = {
      audio: false,
      video: targetId
        ? { deviceId: { exact: targetId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
    };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  try {
    /** @type {MediaStream} */
    let stream;
    try {
      stream = await requestStream(deviceId);
    } catch (firstErr) {
      const firstName = /** @type {{ name?: string }} */ (firstErr)?.name || "";
      if (
        deviceId &&
        (firstName === "OverconstrainedError" ||
          firstName === "NotFoundError" ||
          firstName === "ConstraintNotSatisfiedError")
      ) {
        stream = await requestStream("");
      } else {
        throw firstErr;
      }
    }

    if (reqId !== streamRequestId) {
      stream.getTracks().forEach((t) => t.stop());
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

    activeStream = stream;
    const track = stream.getVideoTracks()[0];
    const trackSettings = track?.getSettings?.();
    const actualId = trackSettings?.deviceId || "";
    const facingMode =
      typeof trackSettings?.facingMode === "string" ? trackSettings.facingMode : "";
    const deviceLabel = track?.label || "";

    if (track && onTrackEnded) {
      const handleEnded = () => {
        if (reqId !== streamRequestId || activeStream !== stream) return;
        activeTrackCleanup = null;
        activeStream = null;
        onTrackEnded();
      };
      track.addEventListener("ended", handleEnded, { once: true });
      activeTrackCleanup = () => track.removeEventListener("ended", handleEnded);
    }

    videoEl.srcObject = stream;
    await videoEl.play();
    if (reqId !== streamRequestId) {
      stream.getTracks().forEach((t) => t.stop());
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
    return {
      ok: true,
      deviceId: actualId,
      facingMode,
      deviceLabel,
      error: null,
      errorInfo: null
    };
  } catch (err) {
    if (reqId !== streamRequestId) {
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
