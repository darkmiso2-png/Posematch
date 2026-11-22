import { DEFAULT_SETTINGS, TOTAL_LANDMARKS } from "../core/constants.js";
import { clamp, cloneLandmarks } from "../core/poseMath.js";

const CALIBRATIONS_KEY = "posematch_calibrations_v1";
const SETTINGS_KEY = "posematch_settings_v1";
const ACTIVE_REF_KEY = "posematch_active_ref_v1";
export const CALIBRATION_NAME_MAX_LENGTH = 40;

const VALID_SOURCES = new Set(["preset", "upload", "recorded", "custom"]);
const VALID_CATEGORIES = new Set(["all", "portrait", "fullbody", "dynamic", "saved"]);

/**
 * Безопасная валидация массива из 33 точек скелета.
 * @param {unknown} raw
 * @returns {import("../core/types.js").JointPoint[] | null}
 */
function sanitizeLandmarks(raw) {
  if (!Array.isArray(raw) || raw.length !== TOTAL_LANDMARKS) return null;
  /** @type {import("../core/types.js").JointPoint[]} */
  const clean = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const pt = /** @type {Record<string, unknown>} */ (item);
    if (typeof pt.x !== "number" || !Number.isFinite(pt.x)) return null;
    if (typeof pt.y !== "number" || !Number.isFinite(pt.y)) return null;
    const z = typeof pt.z === "number" && Number.isFinite(pt.z) ? pt.z : 0;
    const visibility =
      typeof pt.visibility === "number" && Number.isFinite(pt.visibility)
        ? clamp(pt.visibility, 0, 1)
        : 1;
    clean.push({ x: clamp(pt.x, 0, 1), y: clamp(pt.y, 0, 1), z, visibility });
  }
  return clean;
}

/**
 * Валидация и нормализация одной записи калибровки из localStorage.
 * @param {unknown} raw
 * @returns {import("../core/types.js").PoseReference | null}
 */
function sanitizeCalibrationItem(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  if (!id) return null;

  const nameRes = validateCalibrationName(typeof obj.name === "string" ? obj.name : "");
  if (!nameRes.ok) return null;

  const imageDataUrl =
    typeof obj.imageDataUrl === "string" && obj.imageDataUrl.startsWith("data:image/")
      ? obj.imageDataUrl
      : "";
  if (!imageDataUrl) return null;

  const landmarks = sanitizeLandmarks(obj.landmarks);
  if (!landmarks) return null;

  const autoLandmarks = sanitizeLandmarks(obj.autoLandmarks) || cloneLandmarks(landmarks);
  const source =
    typeof obj.source === "string" && VALID_SOURCES.has(obj.source)
      ? /** @type {import("../core/types.js").ReferenceSource} */ (obj.source)
      : "custom";
  const category =
    typeof obj.category === "string" && VALID_CATEGORIES.has(obj.category)
      ? /** @type {import("../core/types.js").PresetCategory} */ (obj.category)
      : "saved";
  const aspect =
    typeof obj.aspect === "number" && Number.isFinite(obj.aspect) && obj.aspect > 0
      ? clamp(obj.aspect, 0.2, 5)
      : 0.75;
  const createdAt =
    typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt) && obj.createdAt > 0
      ? obj.createdAt
      : Date.now();

  return {
    id,
    name: nameRes.name,
    source,
    category,
    imageDataUrl,
    aspect,
    landmarks,
    autoLandmarks,
    autoDetected: Boolean(obj.autoDetected),
    createdAt
  };
}

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
    if (!Array.isArray(parsed)) return [];
    /** @type {import("../core/types.js").PoseReference[]} */
    const valid = [];
    for (const item of parsed) {
      const clean = sanitizeCalibrationItem(item);
      if (clean) valid.push(clean);
    }
    return valid;
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_SETTINGS };
    }
    const obj = /** @type {Record<string, unknown>} */ (parsed);
    const threshold =
      typeof obj.threshold === "number" && Number.isFinite(obj.threshold)
        ? clamp(Math.round(obj.threshold), 60, 95)
        : DEFAULT_SETTINGS.threshold;

    return {
      attachToBody:
        typeof obj.attachToBody === "boolean" ? obj.attachToBody : DEFAULT_SETTINGS.attachToBody,
      mirrorRef: typeof obj.mirrorRef === "boolean" ? obj.mirrorRef : DEFAULT_SETTINGS.mirrorRef,
      parktronic:
        typeof obj.parktronic === "boolean" ? obj.parktronic : DEFAULT_SETTINGS.parktronic,
      voice: typeof obj.voice === "boolean" ? obj.voice : DEFAULT_SETTINGS.voice,
      threshold,
      activeDeviceId:
        typeof obj.activeDeviceId === "string"
          ? obj.activeDeviceId
          : DEFAULT_SETTINGS.activeDeviceId
    };
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
