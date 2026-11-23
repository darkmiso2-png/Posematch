/**
 * Конвертация Data URL в Blob для надежного скачивания и обратной совместимости.
 * @param {string} dataUrl
 * @returns {Blob | null}
 */
function dataUrlToBlob(dataUrl) {
  const commaIdx = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIdx < 0) return null;
  const header = dataUrl.slice(5, commaIdx);
  const payload = dataUrl.slice(commaIdx + 1);
  if (!payload) return null;

  const mime = header.split(";")[0] || "image/jpeg";
  if (!header.includes(";base64")) {
    try {
      return new Blob([decodeURIComponent(payload)], { type: mime });
    } catch {
      return null;
    }
  }

  try {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Освобождает ObjectURL (только blob:), привязанный к снимку.
 * @param {import("../core/types.js").CapturedShot | null | undefined} shot
 * @returns {void}
 */
export function revokeShotObjectUrl(shot) {
  const url = shot?.imageUrl;
  if (!url || !url.startsWith("blob:")) return;
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

/**
 * Освобождает ObjectURL для списка вытесненных или удаляемых снимков.
 * @param {import("../core/types.js").CapturedShot[] | null | undefined} shots
 * @returns {void}
 */
export function revokeShotsObjectUrls(shots) {
  if (!Array.isArray(shots)) return;
  for (const shot of shots) {
    revokeShotObjectUrl(shot);
  }
}

/**
 * Конвертирует HTMLCanvasElement в Blob через canvas.toBlob.
 * @param {HTMLCanvasElement} canvas
 * @param {string} mimeType
 * @param {number} quality
 * @returns {Promise<Blob | null>}
 */
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob || null), mimeType, quality);
  });
}

/**
 * Асинхронный захват чистого кадра видео в Blob + ObjectURL (с безопасным fallback на Data URL).
 * @param {HTMLVideoElement} videoEl
 * @param {boolean} [mirrored]
 * @param {string} [mimeType]
 * @param {number} [quality]
 * @returns {Promise<{ imageBlob: Blob | null, imageUrl: string, imageDataUrl?: string } | null>}
 */
export async function captureVideoFrameBlob(
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

  const blob = await canvasToBlob(off, mimeType, quality);
  if (blob && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return {
      imageBlob: blob,
      imageUrl: URL.createObjectURL(blob)
    };
  }

  if (typeof off.toDataURL === "function") {
    const dataUrl = off.toDataURL(mimeType, quality);
    if (dataUrl) {
      return {
        imageBlob: blob,
        imageUrl: "",
        imageDataUrl: dataUrl
      };
    }
  }

  return null;
}

/**
 * Создает изолированный временный ObjectURL для скачивания снимка, не связанный с URL отображения.
 * @param {import("../core/types.js").CapturedShot | null | undefined} shot
 * @returns {{ href: string, isObjectUrl: boolean } | null}
 */
export function createShotDownloadUrl(shot) {
  if (!shot) return null;
  const blob =
    shot.imageBlob instanceof Blob
      ? shot.imageBlob
      : typeof shot.imageDataUrl === "string" && shot.imageDataUrl
        ? dataUrlToBlob(shot.imageDataUrl)
        : null;

  if (blob && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return {
      href: URL.createObjectURL(blob),
      isObjectUrl: true
    };
  }

  if (typeof shot.imageDataUrl === "string" && shot.imageDataUrl.startsWith("data:image/")) {
    return {
      href: shot.imageDataUrl,
      isObjectUrl: false
    };
  }

  if (typeof shot.imageUrl === "string" && shot.imageUrl) {
    return {
      href: shot.imageUrl,
      isObjectUrl: false
    };
  }

  return null;
}
