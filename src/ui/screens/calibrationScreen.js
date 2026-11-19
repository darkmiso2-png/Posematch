import { EDITABLE_JOINTS, JOINT_NAMES } from "../../core/constants.js";
import { clamp, cloneLandmarks, getMirroredCopy, isJointActive } from "../../core/poseMath.js";
import { commitCalibrationDraft, getState, navigateTo } from "../../state/store.js";
import { drawCalibrationCanvas } from "../overlayRenderer.js";

/**
 * Экран 2: ручная калибровка суставов эталона на Canvas.
 * @param {HTMLElement} root
 * @returns {{ render: (state: import("../../core/types.js").AppState) => void }}
 */
export function createCalibrationScreen(root) {
  const banner = /** @type {HTMLElement} */ (root.querySelector("#calib-banner"));
  const canvas = /** @type {HTMLCanvasElement} */ (root.querySelector("#calib-canvas"));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const infoLabel = /** @type {HTMLElement} */ (root.querySelector("#calib-info-label"));
  const hiddenBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#calib-btn-restore"));
  const resetBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#calib-btn-reset"));
  const mirrorBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#calib-btn-mirror"));
  const saveChk = /** @type {HTMLInputElement} */ (root.querySelector("#calib-save-lib"));
  const cancelBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#calib-btn-cancel"));
  const confirmBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#calib-btn-confirm"));

  /** @type {HTMLImageElement | null} */
  let loadedImg = null;
  let loadedSrc = "";
  let draggingIdx = -1;
  let lastTapIdx = -1;
  let lastTapTime = 0;

  function draw() {
    const draft = getState().draftCalibration;
    if (!draft || !loadedImg) return;
    const hidden = drawCalibrationCanvas(
      ctx,
      loadedImg,
      canvas.width,
      canvas.height,
      draft.landmarks,
      draggingIdx
    );
    hiddenBtn.textContent = `Скрытые точки: ${hidden}`;
  }

  /** @param {{ clientX: number, clientY: number }} e */
  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height
    };
  }

  /**
   * @param {number} px
   * @param {number} py
   * @returns {number}
   */
  function findJoint(px, py) {
    const draft = getState().draftCalibration;
    if (!draft) return -1;
    let best = -1;
    let bestDist = 22;
    for (const idx of EDITABLE_JOINTS) {
      const p = draft.landmarks[idx];
      const d = Math.hypot(p.x * canvas.width - px, p.y * canvas.height - py);
      if (d <= bestDist) {
        bestDist = d;
        best = idx;
      }
    }
    return best;
  }

  /** @param {number} idx */
  function toggleJoint(idx) {
    const draft = getState().draftCalibration;
    if (!draft || idx < 0) return;
    const p = draft.landmarks[idx];
    p.visibility = isJointActive(p) ? 0 : 1;
    infoLabel.textContent = `${JOINT_NAMES[idx] || "Точка"}: ${p.visibility ? "вкл." : "выкл."}`;
    draw();
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    const pos = pointerPos(e);
    const idx = findJoint(pos.x, pos.y);
    if (idx < 0) return;
    const now = performance.now();
    if (idx === lastTapIdx && now - lastTapTime < 320) {
      toggleJoint(idx);
      lastTapTime = 0;
      return;
    }
    lastTapIdx = idx;
    lastTapTime = now;
    draggingIdx = idx;
    infoLabel.textContent = `${JOINT_NAMES[idx] || "Сустав"} (2×тап — выкл.)`;
    canvas.setPointerCapture(e.pointerId);
    draw();
  });

  canvas.addEventListener("pointermove", (e) => {
    const draft = getState().draftCalibration;
    if (!draft || draggingIdx < 0) return;
    const pos = pointerPos(e);
    const pt = draft.landmarks[draggingIdx];
    pt.x = clamp(pos.x / canvas.width, 0.01, 0.99);
    pt.y = clamp(pos.y / canvas.height, 0.01, 0.99);
    pt.visibility = 1;
    draw();
  });

  canvas.addEventListener("pointerup", () => {
    draggingIdx = -1;
    draw();
  });

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const pos = pointerPos(e);
    toggleJoint(findJoint(pos.x, pos.y));
  });

  hiddenBtn.addEventListener("click", () => {
    const draft = getState().draftCalibration;
    if (!draft) return;
    for (const idx of EDITABLE_JOINTS) draft.landmarks[idx].visibility = 1;
    draw();
  });

  resetBtn.addEventListener("click", () => {
    const draft = getState().draftCalibration;
    if (!draft) return;
    draft.landmarks = cloneLandmarks(draft.autoLandmarks);
    draw();
  });

  mirrorBtn.addEventListener("click", () => {
    const draft = getState().draftCalibration;
    if (!draft) return;
    draft.landmarks = getMirroredCopy(draft.landmarks);
    draw();
  });

  cancelBtn.addEventListener("click", () => navigateTo("hub"));
  confirmBtn.addEventListener("click", () => {
    const draft = getState().draftCalibration;
    if (draft) commitCalibrationDraft(draft, saveChk.checked);
  });

  /** @param {import("../../core/types.js").AppState} state */
  function render(state) {
    const draft = state.draftCalibration;
    if (!draft) return;
    banner.textContent = draft.autoDetected
      ? "Поза распознана автоматически"
      : "Человек не найден — выставлен стартовый скелет";

    if (loadedSrc !== draft.imageDataUrl) {
      loadedSrc = draft.imageDataUrl;
      const img = new Image();
      img.onload = () => {
        loadedImg = img;
        const scale = Math.min(1, 360 / (img.naturalWidth || 360));
        canvas.width = Math.round((img.naturalWidth || 360) * scale);
        canvas.height = Math.round((img.naturalHeight || 480) * scale);
        draw();
      };
      img.src = draft.imageDataUrl;
    } else {
      draw();
    }
  }

  return { render };
}
