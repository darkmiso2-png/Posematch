import { DEFAULT_SETTINGS } from "../core/constants.js";

const CALIBRATIONS_KEY = "posematch_calibrations_v1";
const SETTINGS_KEY = "posematch_settings_v1";

/**
 * @returns {import("../core/types.js").PoseReference[]}
 */
export function loadSavedCalibrations() {
  try {
    const raw = localStorage.getItem(CALIBRATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Failed to load calibrations:", err);
    return [];
  }
}

/**
 * @param {import("../core/types.js").PoseReference[]} list
 * @returns {boolean}
 */
export function saveCalibrationsList(list) {
  try {
    localStorage.setItem(CALIBRATIONS_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    console.warn("Failed to save calibrations (QuotaExceeded?):", err);
    return false;
  }
}

/**
 * @returns {import("../core/types.js").AppSettings}
 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * @param {import("../core/types.js").AppSettings} settings
 * @returns {void}
 */
export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("Failed to save settings:", err);
  }
}
