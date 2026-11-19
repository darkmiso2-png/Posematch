/** @type {MediaStream | null} */
let activeStream = null;
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
 * Остановка текущего видеопотока.
 * @returns {void}
 */
function stopCameraStream() {
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }
}

/**
 * Запуск камеры с корректным освобождением предыдущего потока.
 * @param {HTMLVideoElement} videoEl
 * @param {string} [deviceId]
 * @returns {Promise<{ ok: boolean, aborted?: boolean, deviceId: string, error: string | null }>}
 */
export async function startCameraStream(videoEl, deviceId = "") {
  const reqId = ++streamRequestId;
  stopCameraStream();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return {
      ok: false,
      deviceId: "",
      error: "Браузер не поддерживает доступ к веб-камере (требуется localhost или HTTPS)."
    };
  }

  try {
    /** @type {MediaStreamConstraints} */
    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (reqId !== streamRequestId) {
      stream.getTracks().forEach((t) => t.stop());
      return { ok: false, aborted: true, deviceId: "", error: null };
    }
    activeStream = stream;
    const track = stream.getVideoTracks()[0];
    const actualId = track?.getSettings?.().deviceId || deviceId;

    videoEl.srcObject = stream;
    await videoEl.play();
    if (reqId !== streamRequestId) {
      return { ok: false, aborted: true, deviceId: "", error: null };
    }
    return { ok: true, deviceId: actualId, error: null };
  } catch (err) {
    if (reqId !== streamRequestId) {
      return { ok: false, aborted: true, deviceId: "", error: null };
    }
    const e = /** @type {Error} */ (err);
    return {
      ok: false,
      deviceId: "",
      error: `Не удалось запустить камеру: ${e.message || e.name || "Нет доступа"}`
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
