import { computeShutterRingProgress } from "../../core/cameraHudLogic.js";
import { AUTO_SHUTTER_HOLD_MS } from "../../core/constants.js";
import { getMirroredCopy } from "../../core/poseMath.js";
import { cancelSpeech, ensureAudioContext } from "../../services/audioVoiceService.js";
import { getState, navigateTo, openCalibrationDraft, updateSettings } from "../../state/store.js";
import { drawStaticSkeleton } from "../overlayRenderer.js";

const SHUTTER_RING_RADIUS = 28;

/**
 * Экран 3: Камера HUD, плавающая миниатюра «Эталон», кольцо автозатвора 800 ms,
 * сетка 2x2 переключателей, Camera Fallback State и запись позы 3 сек.
 * @param {HTMLElement} root
 * @param {{
 *   onSelectCamera: (id: string) => void,
 *   onRetryCamera: () => void,
 *   onManualShutter: () => void,
 *   onRecordPose: () => void,
 *   onCancelRecordPose: () => void,
 *   onResetSmoothing: () => void
 * }} actions
 */
export function createCameraScreen(root, actions) {
  const video = /** @type {HTMLVideoElement} */ (root.querySelector("#webcam"));
  const overlayCanvas = /** @type {HTMLCanvasElement} */ (root.querySelector("#overlay-canvas"));
  const noticeEl = /** @type {HTMLElement} */ (root.querySelector("#cam-notice"));
  const noticeText = /** @type {HTMLElement} */ (root.querySelector("#cam-notice-text"));
  const noticeClose = /** @type {HTMLButtonElement} */ (root.querySelector("#cam-notice-close"));
  const refMiniBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#ref-mini-btn"));
  const miniCanvas = /** @type {HTMLCanvasElement} */ (root.querySelector("#ref-mini-canvas"));
  const miniCtx = /** @type {CanvasRenderingContext2D} */ (miniCanvas.getContext("2d"));
  const miniNameEl = /** @type {HTMLElement} */ (root.querySelector("#ref-mini-name"));
  const hudScore = /** @type {HTMLElement} */ (root.querySelector("#hud-score"));
  const hudHint = /** @type {HTMLElement} */ (root.querySelector("#hud-hint"));
  const holdBar = /** @type {HTMLElement} */ (root.querySelector("#hud-hold-fill"));
  const countdownEl = /** @type {HTMLElement} */ (root.querySelector("#countdown-overlay"));
  const countdownNum = /** @type {HTMLElement} */ (root.querySelector("#countdown-num"));
  const flashEl = /** @type {HTMLElement} */ (root.querySelector("#shutter-flash"));
  const camFallback = /** @type {HTMLElement} */ (root.querySelector("#camera-fallback"));
  const camErrTitle = /** @type {HTMLElement} */ (root.querySelector("#camera-error-title"));
  const camErrText = /** @type {HTMLElement} */ (root.querySelector("#camera-error-msg"));
  const btnRetryCam = /** @type {HTMLButtonElement} */ (root.querySelector("#btn-retry-cam"));
  const btnFallbackHub = /** @type {HTMLButtonElement} */ (root.querySelector("#btn-fallback-hub"));
  const camSelect = /** @type {HTMLSelectElement} */ (root.querySelector("#camera-select"));
  const slider = /** @type {HTMLInputElement} */ (root.querySelector("#threshold-slider"));
  const sliderVal = /** @type {HTMLElement} */ (root.querySelector("#threshold-value"));
  const galleryBadge = /** @type {HTMLElement} */ (root.querySelector("#cam-gallery-count"));
  const btnShutter = /** @type {HTMLButtonElement} */ (root.querySelector("#btn-manual-shutter"));
  const ringProgress = /** @type {SVGCircleElement} */ (
    /** @type {unknown} */ (root.querySelector("#shutter-ring-progress"))
  );
  const btnRecord = /** @type {HTMLButtonElement} */ (root.querySelector("#btn-record-pose"));
  const btnCalib = /** @type {HTMLButtonElement} */ (root.querySelector("#cam-btn-calib"));
  const btnAttach = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-attach"));
  const btnMirror = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-mirror"));
  const btnPark = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-parktronic"));
  const btnVoice = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-voice"));

  const ringBase = computeShutterRingProgress(0, AUTO_SHUTTER_HOLD_MS, SHUTTER_RING_RADIUS);
  ringProgress.style.strokeDasharray = `${ringBase.circumference.toFixed(2)}`;
  ringProgress.style.strokeDashoffset = `${ringBase.dashOffset.toFixed(2)}`;

  /** @type {import("../../core/types.js").PoseReference | null} */
  let lastThumbRef = null;
  /** @type {boolean | null} */
  let lastThumbMirrored = null;
  let thumbLoadSeq = 0;
  /** @type {import("../../core/cameraHudLogic.js").CameraErrorInfo | null} */
  let cameraErrorInfo = null;

  /**
   * @param {string} text
   * @param {"info" | "error"} [tone]
   */
  function showNotice(text, tone = "info") {
    noticeEl.className = `cam-notice${tone === "error" ? " cam-notice--error" : ""}`;
    noticeText.textContent = text;
    noticeEl.hidden = false;
  }

  function clearNotice() {
    noticeEl.hidden = true;
    noticeText.textContent = "";
  }

  /** @param {boolean} mirrored */
  function setCameraMirrored(mirrored) {
    video.classList.toggle("is-mirrored", mirrored);
    overlayCanvas.classList.toggle("is-mirrored", mirrored);
  }

  /** @param {import("../../core/types.js").AppState} state */
  function renderThumbnail(state) {
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
    const mirrorRef = state.settings.mirrorRef;
    if (ref === lastThumbRef && mirrorRef === lastThumbMirrored) return;
    lastThumbRef = ref;
    lastThumbMirrored = mirrorRef;
    const seq = ++thumbLoadSeq;

    const img = new Image();
    img.onload = () => {
      if (seq !== thumbLoadSeq) return;
      const { width: W, height: H } = miniCanvas;
      miniCtx.clearRect(0, 0, W, H);
      miniCtx.save();
      if (mirrorRef) {
        miniCtx.translate(W, 0);
        miniCtx.scale(-1, 1);
      }
      miniCtx.drawImage(img, 0, 0, W, H);
      miniCtx.restore();
      const lms = mirrorRef ? getMirroredCopy(ref.landmarks) : ref.landmarks;
      drawStaticSkeleton(miniCtx, W, H, lms);
    };
    img.onerror = () => {
      if (seq !== thumbLoadSeq) return;
      lastThumbRef = null;
      miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    };
    img.src = ref.imageDataUrl;
  }

  function openHub() {
    clearNotice();
    navigateTo("hub");
  }

  noticeClose.addEventListener("click", clearNotice);
  refMiniBtn.addEventListener("click", openHub);
  root.querySelector("#cam-btn-hub")?.addEventListener("click", openHub);
  btnFallbackHub.addEventListener("click", openHub);

  btnCalib.addEventListener("click", () => {
    const active = getState().activeReference;
    if (active) openCalibrationDraft(active);
  });
  root.querySelector("#cam-btn-gallery")?.addEventListener("click", () => navigateTo("gallery"));
  btnRetryCam.addEventListener("click", () => actions.onRetryCamera());
  btnShutter.addEventListener("click", () => {
    ensureAudioContext();
    actions.onManualShutter();
  });
  btnRecord.addEventListener("click", () => {
    ensureAudioContext();
    clearNotice();
    actions.onRecordPose();
  });
  root.querySelector("#btn-cancel-record")?.addEventListener("click", () => {
    actions.onCancelRecordPose();
  });
  camSelect.addEventListener("change", () => actions.onSelectCamera(camSelect.value));
  slider.addEventListener("input", () => updateSettings({ threshold: Number(slider.value) }));

  btnAttach.addEventListener("click", () => {
    ensureAudioContext();
    actions.onResetSmoothing();
    updateSettings({ attachToBody: !getState().settings.attachToBody });
  });
  btnMirror.addEventListener("click", () => {
    ensureAudioContext();
    updateSettings({ mirrorRef: !getState().settings.mirrorRef });
  });
  btnPark.addEventListener("click", () => {
    ensureAudioContext();
    updateSettings({ parktronic: !getState().settings.parktronic });
  });
  btnVoice.addEventListener("click", () => {
    ensureAudioContext();
    const next = !getState().settings.voice;
    if (!next) cancelSpeech();
    updateSettings({ voice: next });
  });

  /**
   * @param {MediaDeviceInfo[]} cams
   * @param {string} activeId
   */
  function setCameraList(cams, activeId) {
    if (cams.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Камеры не найдены";
      camSelect.replaceChildren(opt);
      camSelect.disabled = true;
      return;
    }
    const opts = cams.map((cam, i) => {
      const opt = document.createElement("option");
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Камера ${i + 1}`;
      opt.selected = cam.deviceId === activeId;
      return opt;
    });
    camSelect.replaceChildren(...opts);
    camSelect.disabled = false;
  }

  /** @param {import("../../core/cameraHudLogic.js").CameraErrorInfo | null} info */
  function setCameraErrorInfo(info) {
    cameraErrorInfo = info;
  }

  /**
   * @param {number} score
   * @param {string} hint
   * @param {number} holdMs
   */
  function updateHud(score, hint, holdMs) {
    hudScore.textContent = `${score}%`;
    hudHint.textContent = hint;
    const ring = computeShutterRingProgress(holdMs, AUTO_SHUTTER_HOLD_MS, SHUTTER_RING_RADIUS);
    holdBar.style.width = `${ring.percent}%`;
    ringProgress.style.strokeDashoffset = `${ring.dashOffset.toFixed(2)}`;
    btnShutter.classList.toggle("is-holding", ring.progress > 0.02);
  }

  function triggerFlash() {
    flashEl.classList.add("flash");
    requestAnimationFrame(() => requestAnimationFrame(() => flashEl.classList.remove("flash")));
  }

  /** @param {import("../../core/types.js").AppState} state */
  function render(state) {
    const s = state.settings;
    const r = state.runtime;

    btnAttach.classList.toggle("active-green", s.attachToBody);
    btnMirror.classList.toggle("active-cyan", s.mirrorRef);
    btnPark.classList.toggle("active-cyan", s.parktronic);
    btnVoice.classList.toggle("active-cyan", s.voice);
    slider.value = String(s.threshold);
    sliderVal.textContent = `${s.threshold}%`;
    galleryBadge.textContent = String(state.shots.length);

    const streamReady = r.cameraReady && !r.cameraError;
    btnShutter.disabled = !streamReady || r.isRecordingPose || !state.activeReference;
    btnRecord.disabled = !streamReady || r.isRecordingPose;
    btnCalib.disabled = !state.activeReference || r.isRecordingPose;

    camFallback.hidden = !r.cameraError;
    if (r.cameraError) {
      camErrTitle.textContent = cameraErrorInfo?.title || "Камера недоступна";
      camErrText.textContent = r.cameraError;
      btnRetryCam.hidden = cameraErrorInfo ? !cameraErrorInfo.canRetry : false;
    }

    countdownEl.classList.toggle("active", r.isRecordingPose);
    countdownNum.textContent = r.countdownSec > 0 ? String(r.countdownSec) : "";
    renderThumbnail(state);
  }

  return {
    video,
    overlayCanvas,
    render,
    setCameraList,
    setCameraMirrored,
    setCameraErrorInfo,
    showNotice,
    clearNotice,
    updateHud,
    triggerFlash
  };
}
