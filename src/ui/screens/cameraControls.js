import {
  cancelSpeech,
  ensureAudioContext,
  primeSpeechSynthesis,
  setSpeechUnavailableHandler
} from "../../services/audioVoiceService.js";
import { getState, updateSettings } from "../../state/store.js";

/**
 * Подсистема панели настроек 2x2 и слайдера порога автоспуска Экрана 3.
 * @param {HTMLElement} root
 * @param {{
 *   onResetSmoothing: () => void,
 *   showNotice: (text: string, tone?: "info" | "error" | "success") => void
 * }} deps
 * @returns {{
 *   renderSettings: (settings: import("../../core/types.js").AppSettings) => void,
 *   notifyMissingRuVoice: () => void
 * }}
 */
export function createCameraControls(root, deps) {
  const slider = /** @type {HTMLInputElement} */ (root.querySelector("#threshold-slider"));
  const sliderVal = /** @type {HTMLElement} */ (root.querySelector("#threshold-value"));
  const btnAttach = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-attach"));
  const btnMirror = /** @type {HTMLButtonElement} */ (root.querySelector("#toggle-mirror"));
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

  /** @param {import("../../core/types.js").AppSettings} s */
  function renderSettings(s) {
    btnAttach.classList.toggle("active-green", s.attachToBody);
    btnMirror.classList.toggle("active-cyan", s.mirrorRef);
    btnPark.classList.toggle("active-cyan", s.parktronic);
    btnVoice.classList.toggle("active-cyan", s.voice);
    slider.value = String(s.threshold);
    sliderVal.textContent = `${s.threshold}%`;
  }

  return { renderSettings, notifyMissingRuVoice };
}
