import {
  canvasToNormalized,
  findNearestJoint,
  isDragExceeded,
  mirrorCalibrationLandmarks,
  moveJoint,
  resetCalibrationLandmarks,
  restoreAllJoints,
  setJointVisibility,
  shouldTriggerDoubleTap,
  toggleJointVisibility,
  validateCalibrationSkeleton
} from "../../core/calibrationLogic.js";
import { JOINT_NAMES } from "../../core/constants.js";
import { cancelCalibrationDraft, commitCalibrationDraft, getState } from "../../state/store.js";
import { drawCalibrationCanvas } from "../overlayRenderer.js";
import {
  bakeMirroredImageDataUrl,
  getCanvasPointerPos,
  renderHiddenJointChips
} from "./calibrationViewHelpers.js";

/**
 * Экран 2: ручная калибровка суставов эталона на Canvas.
 * @param {HTMLElement} root
 * @returns {{ render: (state: import("../../core/types.js").AppState) => void }}
 */
export function createCalibrationScreen(root) {
  const noticeEl = /** @type {HTMLElement} */ (root.querySelector("#calib-notice"));
  const noticeText = /** @type {HTMLElement} */ (root.querySelector("#calib-notice-text"));
  const noticeClose = /** @type {HTMLButtonElement} */ (root.querySelector("#calib-notice-close"));
  const banner = /** @type {HTMLElement} */ (root.querySelector("#calib-banner"));
  const canvas = /** @type {HTMLCanvasElement} */ (root.querySelector("#calib-canvas"));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const infoLabel = /** @type {HTMLElement} */ (root.querySelector("#calib-info-label"));
  const hiddenCountEl = /** @type {HTMLElement} */ (root.querySelector("#calib-hidden-count"));
  const restoreAllBtn = /** @type {HTMLButtonElement} */ (
    root.querySelector("#calib-btn-restore-all")
  );
  const hiddenChipsEl = /** @type {HTMLElement} */ (root.querySelector("#calib-hidden-chips"));
  const mirrorBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#calib-btn-mirror"));
  const resetBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#calib-btn-reset"));
  const nameInput = /** @type {HTMLInputElement} */ (root.querySelector("#calib-name-input"));
  const cancelBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#calib-btn-cancel"));
  const confirmBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#calib-btn-confirm"));

  /** @type {HTMLImageElement | null} */
  let loadedImg = null;
  let loadedSrc = "";
  let imageLoadSeq = 0;
  /** @type {import("../../core/types.js").PoseReference | null} */
  let activeDraftObj = null;
  let isMirrored = false;

  /** @type {number | null} */
  let activePointerId = null;
  let pressedJointIdx = -1;
  let pressStartPos = { x: 0, y: 0 };
  let isDragging = false;
  /** @type {import("../../core/calibrationLogic.js").TapRecord | null} */
  let lastTap = null;

  /**
   * @param {string} text
   * @param {"error" | "info" | "success"} [tone]
   */
  function showNotice(text, tone = "error") {
    noticeEl.className = `app-notice app-notice--${tone}`;
    noticeText.textContent = text;
    noticeEl.hidden = false;
  }

  function clearNotice() {
    noticeEl.hidden = true;
    noticeText.textContent = "";
  }

  function resetPointerState() {
    activePointerId = null;
    pressedJointIdx = -1;
    isDragging = false;
    lastTap = null;
  }

  /** @param {number} pointerId */
  function releasePointer(pointerId) {
    if (canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
    activePointerId = null;
    pressedJointIdx = -1;
    isDragging = false;
  }

  function draw() {
    const draft = getState().draftCalibration;
    if (!draft) return;
    mirrorBtn.classList.toggle("active-cyan", isMirrored);
    renderHiddenJointChips(hiddenChipsEl, hiddenCountEl, restoreAllBtn, draft.landmarks);
    if (!loadedImg) return;
    drawCalibrationCanvas(
      ctx,
      loadedImg,
      canvas.width,
      canvas.height,
      draft.landmarks,
      isDragging ? pressedJointIdx : -1,
      isMirrored
    );
  }

  /** @param {number} idx */
  function toggleJoint(idx) {
    const draft = getState().draftCalibration;
    if (!draft || idx < 0) return;
    const nextState = toggleJointVisibility(draft.landmarks, idx);
    if (nextState === null) return;
    clearNotice();
    infoLabel.textContent = `${JOINT_NAMES[idx] || "Точка"}: ${nextState ? "вкл." : "выкл."}`;
    draw();
  }

  noticeClose.addEventListener("click", clearNotice);

  canvas.addEventListener("pointerdown", (e) => {
    if (activePointerId !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const draft = getState().draftCalibration;
    if (!draft) return;
    const pos = getCanvasPointerPos(canvas, e);
    const idx = findNearestJoint(draft.landmarks, pos.x, pos.y, canvas.width, canvas.height);
    if (idx < 0) {
      lastTap = null;
      return;
    }
    activePointerId = e.pointerId;
    pressedJointIdx = idx;
    pressStartPos = pos;
    isDragging = false;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Игнорируем отказ capture на некоторых мобильных браузерах
    }
    draw();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activePointerId || pressedJointIdx < 0) return;
    const draft = getState().draftCalibration;
    if (!draft) return;
    const pos = getCanvasPointerPos(canvas, e);
    if (!isDragging && isDragExceeded(pressStartPos, pos)) {
      isDragging = true;
      lastTap = null;
      clearNotice();
      infoLabel.textContent = `Перемещение: ${JOINT_NAMES[pressedJointIdx] || "Сустав"}`;
    }
    if (isDragging) {
      const norm = canvasToNormalized(pos.x, pos.y, canvas.width, canvas.height);
      moveJoint(draft.landmarks, pressedJointIdx, norm.x, norm.y);
      draw();
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerId !== activePointerId) return;
    const pos = getCanvasPointerPos(canvas, e);
    const releasedIdx = pressedJointIdx;
    const wasDragging = isDragging;
    releasePointer(e.pointerId);

    if (!wasDragging && releasedIdx >= 0) {
      const nextTap = { idx: releasedIdx, x: pos.x, y: pos.y, time: performance.now() };
      if (shouldTriggerDoubleTap(lastTap, nextTap)) {
        lastTap = null;
        toggleJoint(releasedIdx);
      } else {
        lastTap = nextTap;
        infoLabel.textContent = `${JOINT_NAMES[releasedIdx] || "Сустав"} (2×тап или ПКМ — выкл.)`;
        draw();
      }
      return;
    }
    draw();
  });

  canvas.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== activePointerId) return;
    releasePointer(e.pointerId);
    draw();
  });

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const draft = getState().draftCalibration;
    if (!draft) return;
    const pos = getCanvasPointerPos(canvas, e);
    const idx = findNearestJoint(draft.landmarks, pos.x, pos.y, canvas.width, canvas.height);
    if (idx >= 0) {
      lastTap = null;
      toggleJoint(idx);
    }
  });

  hiddenChipsEl.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    const chip = target?.closest("[data-joint-index]");
    if (!chip) return;
    const draft = getState().draftCalibration;
    if (!draft) return;
    const idx = Number(/** @type {HTMLElement} */ (chip).dataset.jointIndex);
    if (setJointVisibility(draft.landmarks, idx, true)) {
      clearNotice();
      infoLabel.textContent = `${JOINT_NAMES[idx] || "Точка"}: вкл.`;
      draw();
    }
  });

  restoreAllBtn.addEventListener("click", () => {
    const draft = getState().draftCalibration;
    if (!draft) return;
    const count = restoreAllJoints(draft.landmarks);
    clearNotice();
    if (count > 0) {
      infoLabel.textContent = `Восстановлено точек: ${count}`;
    }
    draw();
  });

  mirrorBtn.addEventListener("click", () => {
    const draft = getState().draftCalibration;
    if (!draft) return;
    isMirrored = !isMirrored;
    draft.landmarks = mirrorCalibrationLandmarks(draft.landmarks);
    clearNotice();
    infoLabel.textContent = isMirrored ? "Поза отзеркалена" : "Исходная ориентация";
    draw();
  });

  resetBtn.addEventListener("click", () => {
    const draft = getState().draftCalibration;
    if (!draft) return;
    draft.landmarks = resetCalibrationLandmarks(draft.autoLandmarks);
    isMirrored = false;
    clearNotice();
    infoLabel.textContent = "Точки и ориентация сброшены к исходному снимку";
    draw();
  });

  cancelBtn.addEventListener("click", () => {
    resetPointerState();
    clearNotice();
    cancelCalibrationDraft();
  });

  confirmBtn.addEventListener("click", () => {
    const draft = getState().draftCalibration;
    if (!draft) return;

    const skelCheck = validateCalibrationSkeleton(draft.landmarks);
    if (!skelCheck.ok) {
      showNotice(skelCheck.error, "error");
      return;
    }

    const bakedImage =
      isMirrored && loadedImg
        ? bakeMirroredImageDataUrl(loadedImg, canvas.width, canvas.height)
        : draft.imageDataUrl;
    const bakedAutoLandmarks = isMirrored
      ? mirrorCalibrationLandmarks(draft.autoLandmarks)
      : draft.autoLandmarks;

    const payload = {
      ...draft,
      name: nameInput.value,
      imageDataUrl: bakedImage,
      autoLandmarks: bakedAutoLandmarks
    };

    const res = commitCalibrationDraft(payload, true);
    if (!res.ok) {
      showNotice(res.error, "error");
      if (res.error.toLowerCase().includes("название")) {
        nameInput.focus();
      }
      return;
    }

    resetPointerState();
    isMirrored = false;
    clearNotice();
  });

  /** @param {import("../../core/types.js").AppState} state */
  function render(state) {
    const draft = state.draftCalibration;
    if (!draft) return;

    if (draft !== activeDraftObj) {
      activeDraftObj = draft;
      isMirrored = false;
      nameInput.value = draft.name || "";
      clearNotice();
      resetPointerState();
      infoLabel.textContent = "Перетащите сустав или 2×тап (ПКМ) для вкл/выкл";
    }

    banner.textContent = draft.autoDetected
      ? "Поза распознана автоматически"
      : "Человек не найден — выставлен стартовый скелет";

    if (loadedSrc !== draft.imageDataUrl) {
      loadedSrc = draft.imageDataUrl;
      loadedImg = null;
      const seq = ++imageLoadSeq;
      const img = new Image();
      img.onload = () => {
        if (seq !== imageLoadSeq) return;
        loadedImg = img;
        const nw = img.naturalWidth || 360;
        const nh = img.naturalHeight || 480;
        const scale = Math.min(1, 360 / nw, 460 / nh);
        canvas.width = Math.round(nw * scale);
        canvas.height = Math.round(nh * scale);
        draw();
      };
      img.onerror = () => {
        if (seq !== imageLoadSeq) return;
        loadedSrc = "";
        loadedImg = null;
        showNotice("Не удалось загрузить изображение эталона для калибровки.", "error");
      };
      img.src = draft.imageDataUrl;
    } else {
      draw();
    }
  }

  return { render };
}
