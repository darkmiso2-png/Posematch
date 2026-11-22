import { getHiddenJoints } from "../../core/calibrationLogic.js";

/**
 * Однократно запекает отзеркаленное изображение эталона в JPEG Data URL.
 * @param {HTMLImageElement} img
 * @param {number} fallbackW
 * @param {number} fallbackH
 * @returns {string}
 */
export function bakeMirroredImageDataUrl(img, fallbackW, fallbackH) {
  const w = img.naturalWidth || fallbackW || 360;
  const h = img.naturalHeight || fallbackH || 480;
  const offscreen = document.createElement("canvas");
  offscreen.width = w;
  offscreen.height = h;
  const octx = offscreen.getContext("2d");
  if (!octx) return img.src;
  octx.translate(w, 0);
  octx.scale(-1, 1);
  octx.drawImage(img, 0, 0, w, h);
  return offscreen.toDataURL("image/jpeg", 0.9);
}

/**
 * Перевод clientX/clientY PointerEvent в логические координаты буфера Canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {{ clientX: number, clientY: number }} e
 * @returns {{ x: number, y: number }}
 */
export function getCanvasPointerPos(canvas, e) {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height || !canvas.width || !canvas.height) {
    return { x: 0, y: 0 };
  }
  return {
    x: ((e.clientX - r.left) / r.width) * canvas.width,
    y: ((e.clientY - r.top) / r.height) * canvas.height
  };
}

/**
 * Безопасный DOM-рендер блока скрытых точек через textContent.
 * @param {HTMLElement} chipsContainer
 * @param {HTMLElement} countEl
 * @param {HTMLButtonElement} restoreAllBtn
 * @param {import("../../core/types.js").JointPoint[]} landmarks
 * @returns {void}
 */
export function renderHiddenJointChips(chipsContainer, countEl, restoreAllBtn, landmarks) {
  const hidden = getHiddenJoints(landmarks);
  countEl.textContent = String(hidden.length);
  restoreAllBtn.hidden = hidden.length === 0;
  chipsContainer.replaceChildren();

  if (hidden.length === 0) {
    const empty = document.createElement("span");
    empty.className = "calib-hidden-empty";
    empty.textContent = "Нет скрытых точек. 2×тап или ПКМ по суставу скрывает его.";
    chipsContainer.appendChild(empty);
    return;
  }

  for (const item of hidden) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "calib-chip-btn";
    chip.dataset.jointIndex = String(item.index);
    chip.textContent = `+ ${item.name}`;
    chip.title = `Вернуть точку: ${item.name}`;
    chipsContainer.appendChild(chip);
  }
}
