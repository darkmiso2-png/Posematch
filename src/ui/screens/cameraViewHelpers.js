import { computeShutterRingProgress } from "../../core/cameraHudLogic.js";
import { shouldMirrorReferencePreview } from "../../core/cameraMirrorLogic.js";
import { formatCameraOptionLabel } from "../../core/cameraSwitchLogic.js";
import { AUTO_SHUTTER_HOLD_MS } from "../../core/constants.js";
import { getMirroredCopy } from "../../core/poseMath.js";
import { drawStaticSkeleton } from "../overlayRenderer.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Идемпотентно монтирует SVG-кольцо автозатвора и ядро кнопки спуска.
 * @param {HTMLButtonElement} btnShutter
 * @returns {SVGCircleElement}
 */
export function mountShutterRing(btnShutter) {
  const existing = /** @type {SVGCircleElement | null} */ (
    btnShutter.querySelector("#shutter-ring-progress")
  );
  if (existing && btnShutter.querySelector(".shutter-ring-core")) {
    return existing;
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "shutter-ring-svg");
  svg.setAttribute("viewBox", "0 0 68 68");
  svg.setAttribute("aria-hidden", "true");

  const track = document.createElementNS(SVG_NS, "circle");
  track.setAttribute("class", "shutter-ring-track");
  track.setAttribute("cx", "34");
  track.setAttribute("cy", "34");
  track.setAttribute("r", "28");

  const progress = document.createElementNS(SVG_NS, "circle");
  progress.setAttribute("id", "shutter-ring-progress");
  progress.setAttribute("class", "shutter-ring-progress");
  progress.setAttribute("cx", "34");
  progress.setAttribute("cy", "34");
  progress.setAttribute("r", "28");

  svg.append(track, progress);

  const core = document.createElement("span");
  core.className = "shutter-ring-core";
  core.textContent = "АВТО";

  btnShutter.replaceChildren(svg, core);
  return progress;
}

/**
 * Идемпотентно монтирует содержимое оверлея обратного отсчета 3-2-1.
 * @param {HTMLElement} countdownEl
 * @returns {{ countdownNum: HTMLElement, btnCancelRecord: HTMLButtonElement }}
 */
export function mountCountdownOverlay(countdownEl) {
  let countdownNum = /** @type {HTMLElement | null} */ (
    countdownEl.querySelector("#countdown-num")
  );
  let btnCancelRecord = /** @type {HTMLButtonElement | null} */ (
    countdownEl.querySelector("#btn-cancel-record")
  );
  if (countdownNum && btnCancelRecord) {
    return { countdownNum, btnCancelRecord };
  }

  countdownNum = document.createElement("span");
  countdownNum.id = "countdown-num";
  countdownNum.className = "countdown-num";
  countdownNum.textContent = "3";

  const sub = document.createElement("span");
  sub.className = "countdown-sub";
  sub.textContent = "Приготовьте позу...";

  btnCancelRecord = document.createElement("button");
  btnCancelRecord.id = "btn-cancel-record";
  btnCancelRecord.className = "btn";
  btnCancelRecord.type = "button";
  btnCancelRecord.textContent = "Отмена";

  countdownEl.replaceChildren(countdownNum, sub, btnCancelRecord);
  return { countdownNum, btnCancelRecord };
}

/**
 * Идемпотентно монтирует карточку ошибки/повтора доступа к камере.
 * @param {HTMLElement} camFallback
 * @returns {{
 *   camErrTitle: HTMLElement,
 *   camErrText: HTMLElement,
 *   btnRetryCam: HTMLButtonElement,
 *   btnFallbackHub: HTMLButtonElement
 * }}
 */
export function mountCameraFallback(camFallback) {
  let camErrTitle = /** @type {HTMLElement | null} */ (
    camFallback.querySelector("#camera-error-title")
  );
  let camErrText = /** @type {HTMLElement | null} */ (
    camFallback.querySelector("#camera-error-msg")
  );
  let btnRetryCam = /** @type {HTMLButtonElement | null} */ (
    camFallback.querySelector("#btn-retry-cam")
  );
  let btnFallbackHub = /** @type {HTMLButtonElement | null} */ (
    camFallback.querySelector("#btn-fallback-hub")
  );

  if (camErrTitle && camErrText && btnRetryCam && btnFallbackHub) {
    return { camErrTitle, camErrText, btnRetryCam, btnFallbackHub };
  }

  camErrTitle = document.createElement("strong");
  camErrTitle.id = "camera-error-title";
  camErrTitle.className = "cam-fallback-title";
  camErrTitle.textContent = "Камера недоступна";

  camErrText = document.createElement("span");
  camErrText.id = "camera-error-msg";
  camErrText.className = "cam-fallback-msg";
  camErrText.textContent = "Камера не активна";

  const actionsWrap = document.createElement("div");
  actionsWrap.className = "cam-fallback-actions";

  btnRetryCam = document.createElement("button");
  btnRetryCam.id = "btn-retry-cam";
  btnRetryCam.className = "btn btn-primary";
  btnRetryCam.type = "button";
  btnRetryCam.textContent = "Повторить доступ к камере";

  btnFallbackHub = document.createElement("button");
  btnFallbackHub.id = "btn-fallback-hub";
  btnFallbackHub.className = "btn";
  btnFallbackHub.type = "button";
  btnFallbackHub.textContent = "Библиотека поз";

  actionsWrap.append(btnRetryCam, btnFallbackHub);
  camFallback.replaceChildren(camErrTitle, camErrText, actionsWrap);
  return { camErrTitle, camErrText, btnRetryCam, btnFallbackHub };
}

/**
 * Создает рендерер плавающей миниатюры «Эталон» с защитой от гонок декодирования.
 * Ориентация миниатюры синхронизируется с живым оверлеем через mirrorRef и effectiveCameraMirror.
 * @param {HTMLCanvasElement} miniCanvas
 * @param {HTMLElement} miniNameEl
 * @returns {(state: import("../../core/types.js").AppState, effectiveCameraMirror?: boolean) => void}
 */
export function createThumbnailRenderer(miniCanvas, miniNameEl) {
  const miniCtx = /** @type {CanvasRenderingContext2D} */ (miniCanvas.getContext("2d"));
  /** @type {import("../../core/types.js").PoseReference | null} */
  let lastThumbRef = null;
  /** @type {boolean | null} */
  let lastThumbMirrored = null;
  let thumbLoadSeq = 0;

  return function renderThumbnail(state, effectiveCameraMirror = true) {
    const ref = state.activeReference;
    if (!ref) {
      lastThumbRef = null;
      lastThumbMirrored = null;
      thumbLoadSeq += 1;
      miniNameEl.textContent = "Нет эталона";
      miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
      return;
    }

    miniNameEl.textContent = ref.name;
    const mirrorMini = shouldMirrorReferencePreview(
      state.settings.mirrorRef,
      effectiveCameraMirror
    );
    if (ref === lastThumbRef && mirrorMini === lastThumbMirrored) return;

    lastThumbRef = ref;
    lastThumbMirrored = mirrorMini;
    const seq = ++thumbLoadSeq;

    const img = new Image();
    img.onload = () => {
      if (seq !== thumbLoadSeq) return;
      const { width: W, height: H } = miniCanvas;
      miniCtx.clearRect(0, 0, W, H);
      miniCtx.save();
      if (mirrorMini) {
        miniCtx.translate(W, 0);
        miniCtx.scale(-1, 1);
      }
      miniCtx.drawImage(img, 0, 0, W, H);
      miniCtx.restore();
      const lms = mirrorMini ? getMirroredCopy(ref.landmarks) : ref.landmarks;
      drawStaticSkeleton(miniCtx, W, H, lms);
    };
    img.onerror = () => {
      if (seq !== thumbLoadSeq) return;
      lastThumbRef = null;
      miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    };
    img.src = ref.imageDataUrl;
  };
}

/**
 * Заполняет `<select>` доступных камер с терминологией «Передняя / Задняя».
 * @param {HTMLSelectElement} camSelect
 * @param {MediaDeviceInfo[]} cams
 * @param {string} activeId
 * @param {string} activeFacingMode
 */
export function renderCameraSelectOptions(camSelect, cams, activeId, activeFacingMode) {
  if (cams.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Камеры не найдены";
    camSelect.replaceChildren(opt);
    return;
  }

  const opts = cams.map((cam, i) => {
    const opt = document.createElement("option");
    opt.value = cam.deviceId;
    opt.textContent = formatCameraOptionLabel(cam, i, activeId, activeFacingMode);
    opt.selected = cam.deviceId === activeId;
    return opt;
  });
  camSelect.replaceChildren(...opts);
  if (activeId) camSelect.value = activeId;
}

/**
 * Обновляет HUD совпадения позы и прогресс SVG-кольца автозатвора 800 ms.
 * @param {{
 *   hudScore: HTMLElement,
 *   hudHint: HTMLElement,
 *   holdBar: HTMLElement,
 *   ringProgress: SVGCircleElement,
 *   btnShutter: HTMLButtonElement
 * }} els
 * @param {number} score
 * @param {string} hint
 * @param {number} holdMs
 * @param {number} ringRadius
 */
export function updateShutterHud(els, score, hint, holdMs, ringRadius) {
  els.hudScore.textContent = `${score}%`;
  els.hudHint.textContent = hint;
  const ring = computeShutterRingProgress(holdMs, AUTO_SHUTTER_HOLD_MS, ringRadius);
  els.holdBar.style.width = `${ring.percent}%`;
  els.ringProgress.style.strokeDashoffset = `${ring.dashOffset.toFixed(2)}`;
  els.btnShutter.classList.toggle("is-holding", ring.progress > 0.02);
}
