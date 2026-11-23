import { getFrontMirrorToggleCopy } from "../../core/cameraMirrorLogic.js";
import {
  cancelSpeech,
  ensureAudioContext,
  primeSpeechSynthesis,
  setSpeechUnavailableHandler
} from "../../services/audioVoiceService.js";
import { getState, updateSettings } from "../../state/store.js";

/**
 * Подсистема панели настроек 2x2, режима зеркалирования передней камеры и слайдера порога Экрана 3.
 * @param {HTMLElement} root
 * @param {{
 *   onResetSmoothing: () => void,
 *   showNotice: (text: string, tone?: "info" | "error" | "success") => void
 * }} deps
 * @returns {{
 *   renderSettings: (
 *     settings: import("../../core/types.js").AppSettings,
 *     mirrorState: import("../../core/cameraMirrorLogic.js").CameraMirrorState,
 *     isBusy?: boolean
 *   ) => void,
 *   notifyMissingRuVoice: () => void
 * }}
 */
export function createCameraControls(root, deps) {
  const slider = /** @type {HTMLInputElement} */ (root.querySelector("#threshold-slider"));
  const sliderVal = /** @type {HTMLElement} */ (root.querySelector("#threshold-value"));
  const btnAttach = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-attach"));
  const btnMirror = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-mirror"));
  const btnFrontMirror = /** @type {HTMLButtonElement | null} */ (
    root.querySelector("#toggle-front-mirror")
  );
  const btnPark = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-parktronic"));
  const btnVoice = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-voice"));

  let missingRuVoiceNotified = false;

  function notifyMissingRuVoice() {
    if (missingRuVoiceNotified) return;
    missingRuVoiceNotified = true;
    deps.showNotice(
      "Озвучка речи недоступна в этом браузере или не установлен русский TTS (включён звуковой сигнал)",
      "info"
    );
  }

  setSpeechUnavailableHandler(() => {
    if (getState().settings.voice) notifyMissingRuVoice();
  });

  slider.addEventListener("input", () => updateSettings({ threshold: Number(slider.value) }));

  btnAttach.addEventListener("click", () => {
    ensureAudioContext();
    deps.onResetSmoothing();
    updateSettings({ attachToBody: !getState().settings.attachToBody });
  });

  btnMirror.addEventListener("click", () => {
    ensureAudioContext();
    updateSettings({ mirrorRef: !getState().settings.mirrorRef });
  });

  btnFrontMirror?.addEventListener("click", () => {
    if (btnFrontMirror.disabled) return;
    ensureAudioContext();
    updateSettings({ mirrorFrontCamera: !getState().settings.mirrorFrontCamera });
  });

  btnPark.addEventListener("click", () => {
    ensureAudioContext();
    updateSettings({ parktronic: !getState().settings.parktronic });
  });

  btnVoice.addEventListener("click", () => {
    ensureAudioContext();
    const next = !getState().settings.voice;
    if (next) {
      missingRuVoiceNotified = false;
      updateSettings({ voice: true });
      const tts = primeSpeechSynthesis({ speakTest: true });
      if (!tts.supported || tts.missingRussianVoice) notifyMissingRuVoice();
    } else {
      cancelSpeech();
      updateSettings({ voice: false });
    }
  });

  /**
   * @param {import("../../core/types.js").AppSettings} s
   * @param {import("../../core/cameraMirrorLogic.js").CameraMirrorState} mirrorState
   * @param {boolean} [isBusy]
   */
  function renderSettings(s, mirrorState, isBusy = false) {
    btnAttach.classList.toggle("active-green", s.attachToBody);
    btnAttach.setAttribute("aria-pressed", String(s.attachToBody));
    btnMirror.classList.toggle("active-cyan", s.mirrorRef);
    btnMirror.setAttribute("aria-pressed", String(s.mirrorRef));
    btnPark.classList.toggle("active-cyan", s.parktronic);
    btnPark.setAttribute("aria-pressed", String(s.parktronic));
    btnVoice.classList.toggle("active-cyan", s.voice);
    btnVoice.setAttribute("aria-pressed", String(s.voice));
    slider.value = String(s.threshold);
    sliderVal.textContent = `${s.threshold}%`;

    if (btnFrontMirror) {
      const copy = getFrontMirrorToggleCopy(mirrorState, isBusy);
      btnFrontMirror.textContent = copy.label;
      btnFrontMirror.disabled = copy.disabled;
      btnFrontMirror.setAttribute("aria-label", copy.ariaLabel);
      btnFrontMirror.setAttribute("aria-pressed", String(copy.pressed));
      btnFrontMirror.title = copy.title;
      btnFrontMirror.classList.toggle("active-cyan", copy.pressed && !copy.disabled);
    }
  }

  return { renderSettings, notifyMissingRuVoice };
}
