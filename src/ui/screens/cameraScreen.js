import { AUTO_SHUTTER_HOLD_MS } from "../../core/constants.js";
import { clamp, getMirroredCopy } from "../../core/poseMath.js";
import { cancelSpeech, ensureAudioContext } from "../../services/audioVoiceService.js";
import { getState, navigateTo, openCalibrationDraft, updateSettings } from "../../state/store.js";
import { drawStaticSkeleton } from "../overlayRenderer.js";

/**
 * Экран 3: видоискатель, переключатели 2x2, автоспуск и запись позы 3 сек.
 * @param {HTMLElement} root
 * @param {{
 *   onSelectCamera: (id: string) => void,
 *   onRetryCamera: () => void,
 *   onManualShutter: () => void,
 *   onRecordPose: () => void,
 *   onResetSmoothing: () => void
 * }} actions
 */
export function createCameraScreen(root, actions) {
  const video = /** @type {HTMLVideoElement} */ (root.querySelector("#webcam"));
  const overlayCanvas = /** @type {HTMLCanvasElement} */ (root.querySelector("#overlay-canvas"));
  const miniCanvas = /** @type {HTMLCanvasElement} */ (root.querySelector("#ref-mini-canvas"));
  const miniCtx = /** @type {CanvasRenderingContext2D} */ (miniCanvas.getContext("2d"));
  const hudScore = /** @type {HTMLElement} */ (root.querySelector("#hud-score"));
  const hudHint = /** @type {HTMLElement} */ (root.querySelector("#hud-hint"));
  const holdBar = /** @type {HTMLElement} */ (root.querySelector("#hud-hold-fill"));
  const countdownEl = /** @type {HTMLElement} */ (root.querySelector("#countdown-overlay"));
  const flashEl = /** @type {HTMLElement} */ (root.querySelector("#shutter-flash"));
  const camFallback = /** @type {HTMLElement} */ (root.querySelector("#camera-fallback"));
  const camErrText = /** @type {HTMLElement} */ (root.querySelector("#camera-error-msg"));
  const camSelect = /** @type {HTMLSelectElement} */ (root.querySelector("#camera-select"));
  const slider = /** @type {HTMLInputElement} */ (root.querySelector("#threshold-slider"));
  const sliderVal = /** @type {HTMLElement} */ (root.querySelector("#threshold-value"));
  const galleryBadge = /** @type {HTMLElement} */ (root.querySelector("#cam-gallery-count"));
  const btnAttach = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-attach"));
  const btnMirror = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-mirror"));
  const btnPark = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-parktronic"));
  const btnVoice = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-voice"));
  let lastThumbKey = "";

  /** @param {import("../../core/types.js").AppState} state */
  function renderThumbnail(state) {
    const ref = state.activeReference;
    if (!ref) return;
    const key = `${ref.id}-${state.settings.mirrorRef}-${ref.landmarks[0]?.x}`;
    if (key === lastThumbKey) return;
    lastThumbKey = key;
    const img = new Image();
    img.onload = () => {
      const { width: W, height: H } = miniCanvas;
      miniCtx.clearRect(0, 0, W, H);
      miniCtx.save();
      if (state.settings.mirrorRef) {
        miniCtx.translate(W, 0);
        miniCtx.scale(-1, 1);
      }
      miniCtx.drawImage(img, 0, 0, W, H);
      miniCtx.restore();
      const lms = state.settings.mirrorRef ? getMirroredCopy(ref.landmarks) : ref.landmarks;
      drawStaticSkeleton(miniCtx, W, H, lms);
    };
    img.src = ref.imageDataUrl;
  }

  root.querySelector("#cam-btn-hub")?.addEventListener("click", () => navigateTo("hub"));
  root.querySelector("#cam-btn-calib")?.addEventListener("click", () => {
    const active = getState().activeReference;
    if (active) openCalibrationDraft(active);
  });
  root.querySelector("#cam-btn-gallery")?.addEventListener("click", () => navigateTo("gallery"));
  root.querySelector("#btn-retry-cam")?.addEventListener("click", () => actions.onRetryCamera());
  root.querySelector("#btn-manual-shutter")?.addEventListener("click", () => {
    ensureAudioContext();
    actions.onManualShutter();
  });
  root.querySelector("#btn-record-pose")?.addEventListener("click", () => {
    ensureAudioContext();
    actions.onRecordPose();
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
    camSelect.innerHTML = "";
    if (cams.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Камеры не найдены";
      camSelect.appendChild(opt);
      return;
    }
    cams.forEach((cam, i) => {
      const opt = document.createElement("option");
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Камера ${i + 1}`;
      opt.selected = cam.deviceId === activeId;
      camSelect.appendChild(opt);
    });
  }

  /**
   * @param {number} score
   * @param {string} hint
   * @param {number} holdMs
   */
  function updateHud(score, hint, holdMs) {
    hudScore.textContent = `${score}%`;
    hudHint.textContent = hint;
    holdBar.style.width = `${clamp((holdMs / AUTO_SHUTTER_HOLD_MS) * 100, 0, 100).toFixed(1)}%`;
  }

  function triggerFlash() {
    flashEl.classList.add("flash");
    requestAnimationFrame(() => requestAnimationFrame(() => flashEl.classList.remove("flash")));
  }

  /** @param {import("../../core/types.js").AppState} state */
  function render(state) {
    const s = state.settings;
    btnAttach.classList.toggle("active-green", s.attachToBody);
    btnMirror.classList.toggle("active-cyan", s.mirrorRef);
    btnPark.classList.toggle("active-cyan", s.parktronic);
    btnVoice.classList.toggle("active-cyan", s.voice);
    slider.value = String(s.threshold);
    sliderVal.textContent = `${s.threshold}%`;
    galleryBadge.textContent = String(state.shots.length);
    camFallback.hidden = !state.runtime.cameraError;
    if (state.runtime.cameraError) camErrText.textContent = state.runtime.cameraError;
    countdownEl.classList.toggle("active", state.runtime.isRecordingPose);
    countdownEl.textContent =
      state.runtime.countdownSec > 0 ? String(state.runtime.countdownSec) : "";
    renderThumbnail(state);
  }

  return { video, overlayCanvas, render, setCameraList, updateHud, triggerFlash };
}
