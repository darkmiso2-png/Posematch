import { drawStaticSkeleton } from "../overlayRenderer.js";

/**
 * Конвертация Data URL в Blob для надежного скачивания на мобильных браузерах.
 * @param {string} dataUrl
 * @returns {Blob | null}
 */
export function dataUrlToBlob(dataUrl) {
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
 * Отрисовка изображения и скелета с сохранением исходных пропорций внутри холста.
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} img
 * @param {import("../../core/types.js").JointPoint[] | null} lms
 * @param {boolean} mirrorImg
 * @param {boolean} showSkeleton
 * @param {string} color
 */
function paintImageAndSkeleton(canvas, ctx, img, lms, mirrorImg, showSkeleton, color) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const iw = img.naturalWidth || img.width || canvas.width;
  const ih = img.naturalHeight || img.height || canvas.height;
  const scale = Math.min(canvas.width / iw, canvas.height / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (canvas.width - dw) * 0.5;
  const dy = (canvas.height - dh) * 0.5;

  ctx.save();
  ctx.translate(dx, dy);
  if (mirrorImg) {
    ctx.translate(dw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, 0, 0, dw, dh);
  ctx.restore();

  if (showSkeleton && lms && lms.length > 0) {
    ctx.save();
    ctx.translate(dx, dy);
    drawStaticSkeleton(ctx, dw, dh, lms, color);
    ctx.restore();
  }
}

/**
 * Создает рендерер панелей сравнения с кэшем HTMLImageElement и защитой от гонок.
 */
export function createGalleryPaneRenderer() {
  /** @type {{ ref: { src: string, img: HTMLImageElement | null, seq: number }, shot: { src: string, img: HTMLImageElement | null, seq: number } }} */
  const paneCache = {
    ref: { src: "", img: null, seq: 0 },
    shot: { src: "", img: null, seq: 0 }
  };

  /**
   * @param {"ref" | "shot"} slot
   * @param {HTMLCanvasElement} canvas
   * @param {CanvasRenderingContext2D} ctx
   * @param {string | null} src
   * @param {import("../../core/types.js").JointPoint[] | null} lms
   * @param {boolean} mirrorImg
   * @param {boolean} showSkeleton
   * @param {string} color
   */
  return function drawPane(slot, canvas, ctx, src, lms, mirrorImg, showSkeleton, color) {
    const cache = paneCache[slot];
    cache.seq += 1;
    const seq = cache.seq;

    if (!src) {
      cache.src = "";
      cache.img = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    if (cache.src === src && cache.img && cache.img.complete && cache.img.naturalWidth > 0) {
      paintImageAndSkeleton(canvas, ctx, cache.img, lms, mirrorImg, showSkeleton, color);
      return;
    }

    const img = new Image();
    img.onload = () => {
      if (cache.seq !== seq) return;
      cache.src = src;
      cache.img = img;
      paintImageAndSkeleton(canvas, ctx, img, lms, mirrorImg, showSkeleton, color);
    };
    img.onerror = () => {
      if (cache.seq !== seq) return;
      cache.src = "";
      cache.img = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    img.src = src;
  };
}

/**
 * Идемпотентно монтирует содержимое Empty State Экрана 4.
 * @param {HTMLElement} emptyBox
 * @returns {HTMLButtonElement}
 */
export function mountGalleryEmptyState(emptyBox) {
  const existing = /** @type {HTMLButtonElement | null} */ (
    emptyBox.querySelector("#gal-empty-camera")
  );
  if (existing && emptyBox.querySelector(".gal-empty-title")) {
    return existing;
  }

  const title = document.createElement("strong");
  title.className = "gal-empty-title";
  title.textContent = "В этой сессии пока нет снимков";

  const desc = document.createElement("p");
  desc.className = "gal-empty-desc";
  desc.textContent =
    "Сделайте фото по эталону вручную или через автоспуск — дубли появятся здесь для сравнения Side-by-Side.";

  const btnCamera = document.createElement("button");
  btnCamera.id = "gal-empty-camera";
  btnCamera.className = "btn btn-primary";
  btnCamera.type = "button";
  btnCamera.textContent = "← К камере";

  emptyBox.replaceChildren(title, desc, btnCamera);
  return btnCamera;
}
