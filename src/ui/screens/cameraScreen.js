import { computeShutterRingProgress } from "../../core/cameraHudLogic.js";
import { resolveCameraMirrorState } from "../../core/cameraMirrorLogic.js";
import { getSwitchCameraCopy } from "../../core/cameraSwitchLogic.js";
import { AUTO_SHUTTER_HOLD_MS } from "../../core/constants.js";
import { ensureAudioContext } from "../../services/audioVoiceService.js";
import { getState, navigateTo, openCalibrationDraft } from "../../state/store.js";
import { createScreenNotice } from "../screenNotice.js";
import { createCameraControls } from "./cameraControls.js";
import {
  createThumbnailRenderer,
  mountCameraFallback,
  mountCountdownOverlay,
  mountShutterRing,
  renderCameraSelectOptions,
  updateShutterHud
} from "./cameraViewHelpers.js";

const SHUTTER_RING_RADIUS = 28;

/**
 * Экран 3: Камера HUD, плавающая миниатюра «Эталон», кольцо автозатвора 800 ms,
 * сетка 2x2 переключателей, Camera Fallback State и запись позы 3 сек.
 * @param {HTMLElement} root
 * @param {{
 *   onSelectCamera: (id: string) => void,
 *   onSwitchCamera: () => void,
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
  const viewportBox = /** @type {HTMLElement | null} */ (root.querySelector(".viewport-box"));
  const hudBar = /** @type {HTMLElement | null} */ (root.querySelector(".hud-bar"));
  const { show: showNotice, clear: clearNotice } = createScreenNotice(root, "cam", {
    defaultTone: "info"
  });
  const refMiniBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#ref-mini-btn"));
  const miniCanvas = /** @type {HTMLCanvasElement} */ (root.querySelector("#ref-mini-canvas"));
  const miniNameEl = /** @type {HTMLElement} */ (root.querySelector("#ref-mini-name"));
  const hudScore = /** @type {HTMLElement} */ (root.querySelector("#hud-score"));
  const hudHint = /** @type {HTMLElement} */ (root.querySelector("#hud-hint"));
  const holdBar = /** @type {HTMLElement} */ (root.querySelector("#hud-hold-fill"));
  const countdownEl = /** @type {HTMLElement} */ (root.querySelector("#countdown-overlay"));
  const { countdownNum, btnCancelRecord } = mountCountdownOverlay(countdownEl);
  const flashEl = /** @type {HTMLElement} */ (root.querySelector("#shutter-flash"));
  const camFallback = /** @type {HTMLElement} */ (root.querySelector("#camera-fallback"));
  const { camErrTitle, camErrText, btnRetryCam, btnFallbackHub } = mountCameraFallback(camFallback);
  const camSelect = /** @type {HTMLSelectElement} */ (root.querySelector("#camera-select"));
  const galleryBadge = /** @type {HTMLElement} */ (root.querySelector("#cam-gallery-count"));
  const btnShutter = /** @type {HTMLButtonElement} */ (root.querySelector("#btn-manual-shutter"));
  const ringProgress = mountShutterRing(btnShutter);
  const btnRecord = /** @type {HTMLButtonElement} */ (root.querySelector("#btn-record-pose"));
  const btnSwitchCam = /** @type {HTMLButtonElement} */ (root.querySelector("#btn-switch-camera"));
  const btnCalib = /** @type {HTMLButtonElement} */ (root.querySelector("#cam-btn-calib"));
  const controls = createCameraControls(root, {
    onResetSmoothing: actions.onResetSmoothing,
    showNotice
  });

  const ringBase = computeShutterRingProgress(0, AUTO_SHUTTER_HOLD_MS, SHUTTER_RING_RADIUS);
  ringProgress.style.strokeDasharray = `${ringBase.circumference.toFixed(2)}`;
  ringProgress.style.strokeDashoffset = `${ringBase.dashOffset.toFixed(2)}`;
  const renderThumbnail = createThumbnailRenderer(miniCanvas, miniNameEl);
  /** @type {import("../../core/cameraHudLogic.js").CameraErrorInfo | null} */
  let cameraErrorInfo = null;
  let hasCameras = false;
  let canSwitchCamera = false;
  let isSwitchingCamera = false;
  /** @type {"user" | "environment" | ""} */
  let activeFacingMode = "";
  let activeDeviceLabel = "";

  function syncSwitchControl() {
    const r = getState().runtime;
    const copy = getSwitchCameraCopy(activeFacingMode, canSwitchCamera, isSwitchingCamera);
    btnSwitchCam.hidden = !canSwitchCamera;
    btnSwitchCam.disabled = !canSwitchCamera || isSwitchingCamera || r.isRecordingPose;
    btnSwitchCam.classList.toggle("is-switching", isSwitchingCamera);
    btnSwitchCam.setAttribute("aria-label", copy.ariaLabel);
    btnSwitchCam.title = copy.title;
    camSelect.disabled = !hasCameras || isSwitchingCamera || r.isRecordingPose;
  }

  /** @param {boolean} mirrored */
  function setCameraMirrored(mirrored) {
    video.classList.toggle("is-mirrored", mirrored);
    overlayCanvas.classList.toggle("is-mirrored", mirrored);
  }

  /** @param {import("../../core/types.js").AppState} [state] */
  function syncMirrorControl(state = getState()) {
    const mirrorState = resolveCameraMirrorState({
      facingMode: activeFacingMode,
      deviceId: state.settings.activeDeviceId,
      deviceLabel: activeDeviceLabel,
      mirrorFrontCamera: state.settings.mirrorFrontCamera
    });
    const isBusy = isSwitchingCamera || state.runtime.isRecordingPose;
    setCameraMirrored(mirrorState.effectiveMirror);
    controls.renderSettings(state.settings, mirrorState, isBusy);
    renderThumbnail(state, mirrorState.effectiveMirror);
  }

  syncSwitchControl();
  syncMirrorControl();

  function openHub() {
    clearNotice();
    navigateTo("hub");
  }

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
  btnCancelRecord.addEventListener("click", () => {
    actions.onCancelRecordPose();
  });
  camSelect.addEventListener("change", () => actions.onSelectCamera(camSelect.value));
  btnSwitchCam.addEventListener("click", () => {
    if (!btnSwitchCam.disabled) actions.onSwitchCamera();
  });

  /**
   * @param {MediaDeviceInfo[]} cams
   * @param {string} activeId
   * @param {string} [facingMode]
   */
  function setCameraList(cams, activeId, facingMode = "") {
    hasCameras = cams.length > 0;
    canSwitchCamera = cams.length >= 2;
    if (facingMode === "user" || facingMode === "environment" || facingMode === "") {
      activeFacingMode = facingMode;
    }
    activeDeviceLabel = cams.find((c) => c.deviceId === activeId)?.label || "";
    renderCameraSelectOptions(camSelect, cams, activeId, activeFacingMode);
    syncSwitchControl();
    syncMirrorControl();
  }

  /** @param {{ canSwitch?: boolean, currentFacing?: string, isSwitching: boolean }} next */
  function setCameraSwitchState(next) {
    if (typeof next.canSwitch === "boolean") canSwitchCamera = next.canSwitch;
    if (
      next.currentFacing === "user" ||
      next.currentFacing === "environment" ||
      next.currentFacing === ""
    ) {
      activeFacingMode = next.currentFacing;
    }
    isSwitchingCamera = next.isSwitching;
    viewportBox?.classList.toggle("is-switching-camera", isSwitchingCamera);
    syncSwitchControl();
    syncMirrorControl();
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
    updateShutterHud(
      { hudScore, hudHint, holdBar, ringProgress, btnShutter },
      score,
      hint,
      holdMs,
      SHUTTER_RING_RADIUS
    );
  }

  function triggerFlash() {
    flashEl.classList.add("flash");
    requestAnimationFrame(() => requestAnimationFrame(() => flashEl.classList.remove("flash")));
  }

  /** @param {import("../../core/types.js").AppState} state */
  function render(state) {
    const r = state.runtime;

    syncMirrorControl(state);
    galleryBadge.textContent = String(state.shots.length);

    const streamReady = r.cameraReady && !r.cameraError;
    btnShutter.disabled = !streamReady || r.isRecordingPose || !state.activeReference;
    btnRecord.disabled = !streamReady || r.isRecordingPose;
    btnCalib.disabled = !state.activeReference || r.isRecordingPose;
    syncSwitchControl();

    const hasCameraError = Boolean(r.cameraError);
    camFallback.hidden = !hasCameraError;
    if (hudBar) hudBar.hidden = hasCameraError;
    viewportBox?.classList.toggle("has-camera-error", hasCameraError);
    if (r.cameraError) {
      camErrTitle.textContent = cameraErrorInfo?.title || "Камера недоступна";
      camErrText.textContent = r.cameraError;
      btnRetryCam.hidden = cameraErrorInfo ? !cameraErrorInfo.canRetry : false;
    }

    countdownEl.classList.toggle("active", r.isRecordingPose);
    countdownNum.textContent = r.countdownSec > 0 ? String(r.countdownSec) : "";
  }

  return {
    video,
    overlayCanvas,
    render,
    setCameraList,
    setCameraSwitchState,
    setCameraMirrored,
    setCameraErrorInfo,
    showNotice,
    clearNotice,
    notifyMissingRuVoice: controls.notifyMissingRuVoice,
    updateHud,
    triggerFlash
  };
}
