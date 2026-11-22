import { DEFAULT_SETTINGS } from "../core/constants.js";

const CALIBRATIONS_KEY = "posematch_calibrations_v1";
const SETTINGS_KEY = "posematch_settings_v1";
const ACTIVE_REF_KEY = "posematch_active_ref_v1";
export const CALIBRATION_NAME_MAX_LENGTH = 40;

/**
 * Безопасный доступ к localStorage (не падает в Node/Vitest).
 * @returns {Storage | null}
 */
function getStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Валидация и нормализация названия пользовательской калибровки.
 * @param {string} rawName
 * @returns {{ ok: true, name: string } | { ok: false, name: string, error: string }}
 */
export function validateCalibrationName(rawName) {
  const normalized = (typeof rawName === "string" ? rawName : "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, CALIBRATION_NAME_MAX_LENGTH)
    .trim();

  if (!normalized) {
    return {
      ok: false,
      name: "",
      error: "Введите название позы (нельзя сохранить пустое имя)."
    };
  }

  return { ok: true, name: normalized };
}

/**
 * @returns {import("../core/types.js").PoseReference[]}
 */
export function loadSavedCalibrations() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(CALIBRATIONS_KEY);
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
 * @returns {{ ok: true } | { ok: false, quotaExceeded: boolean, error: string }}
 */
export function saveCalibrationsList(list) {
  const storage = getStorage();
  if (!storage) {
    return {
      ok: false,
      quotaExceeded: false,
      error: "Хранилище localStorage недоступно в текущей среде."
    };
  }
  try {
    storage.setItem(CALIBRATIONS_KEY, JSON.stringify(list));
    return { ok: true };
  } catch (err) {
    console.warn("Failed to save calibrations (QuotaExceeded?):", err);
    const e = /** @type {{ name?: string, code?: number }} */ (err);
    const quotaExceeded =
      e?.name === "QuotaExceededError" ||
      e?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      e?.code === 22 ||
      e?.code === 1014;
    return {
      ok: false,
      quotaExceeded,
      error: quotaExceeded
        ? "Память localStorage переполнена. Удалите старые калибровки, чтобы сохранить изменения."
        : "Не удалось сохранить изменения в localStorage."
    };
  }
}

/**
 * @returns {import("../core/types.js").AppSettings}
 */
export function loadSettings() {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(SETTINGS_KEY);
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
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("Failed to save settings:", err);
  }
}

/**
 * Чтение последнего выбранного ID эталона.
 * @returns {string | null}
 */
export function loadLastActiveReferenceId() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const id = storage.getItem(ACTIVE_REF_KEY);
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Сохранение ID последнего выбранного эталона.
 * @param {string | null} id
 * @returns {void}
 */
export function saveLastActiveReferenceId(id) {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (id) {
      storage.setItem(ACTIVE_REF_KEY, id);
    } else {
      storage.removeItem(ACTIVE_REF_KEY);
    }
  } catch (err) {
    console.warn("Failed to save active reference ID:", err);
  }
}
