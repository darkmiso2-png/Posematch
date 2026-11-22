import { resolveInitialReference } from "../core/cameraHudLogic.js";
import { validateCalibrationSkeleton } from "../core/calibrationLogic.js";
import { cloneLandmarks } from "../core/poseMath.js";
import { buildInitialPresets } from "../core/presetRenderer.js";
import {
  loadLastActiveReferenceId,
  loadSavedCalibrations,
  loadSettings,
  saveCalibrationsList,
  saveLastActiveReferenceId,
  saveSettings,
  validateCalibrationName
} from "../services/storageService.js";

/** @type {Set<(state: import("../core/types.js").AppState) => void>} */
const listeners = new Set();

/** @type {import("../core/types.js").ScreenId} */
let calibrationReturnScreen = "camera";

/**
 * @param {import("../core/types.js").PoseReference | null} ref
 * @returns {import("../core/types.js").PoseReference | null}
 */
function cloneReference(ref) {
  if (!ref) return null;
  return {
    ...ref,
    landmarks: cloneLandmarks(ref.landmarks),
    autoLandmarks: cloneLandmarks(ref.autoLandmarks)
  };
}

const presets = buildInitialPresets();
const savedCalibrations = loadSavedCalibrations();
const initialActiveRef = cloneReference(
  resolveInitialReference(presets, savedCalibrations, loadLastActiveReferenceId())
);

/** @type {import("../core/types.js").AppState} */
const state = {
  currentScreen: "camera",
  activeFilter: "all",
  presets,
  savedCalibrations,
  activeReference: initialActiveRef,
  draftCalibration: null,
  shots: [],
  selectedShotId: null,
  showSkeletonOverlay: true,
  settings: loadSettings(),
  runtime: {
    mpStatus: "loading",
    mpMessage: "Загрузка ИИ...",
    cameraReady: false,
    cameraError: null,
    isRecordingPose: false,
    countdownSec: 0,
    holdMs: 0,
    shutterCooldownMs: 0
  }
};

function notify() {
  for (const fn of listeners) fn(state);
}

/**
 * @returns {import("../core/types.js").AppState}
 */
export function getState() {
  return state;
}

/**
 * @param {(state: import("../core/types.js").AppState) => void} listener
 * @returns {() => void}
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * @param {import("../core/types.js").ScreenId} screen
 * @returns {void}
 */
export function navigateTo(screen) {
  state.currentScreen = screen;
  notify();
}

/**
 * @param {import("../core/types.js").PresetCategory} filter
 * @returns {void}
 */
export function setActiveFilter(filter) {
  state.activeFilter = filter;
  notify();
}

/**
 * @param {import("../core/types.js").PoseReference} ref
 * @returns {void}
 */
export function setActiveReference(ref) {
  state.activeReference = cloneReference(ref);
  state.runtime.holdMs = 0;
  saveLastActiveReferenceId(state.activeReference?.id || null);
  notify();
}

/**
 * @param {import("../core/types.js").PoseReference} ref
 * @returns {void}
 */
export function openCalibrationDraft(ref) {
  if (state.currentScreen !== "calibration") {
    calibrationReturnScreen = state.currentScreen === "camera" ? "camera" : "hub";
  }
  state.draftCalibration = cloneReference(ref);
  state.currentScreen = "calibration";
  notify();
}

/**
 * Отменяет черновик калибровки без сохранения и возвращает на предыдущий экран.
 * @returns {import("../core/types.js").ScreenId}
 */
export function cancelCalibrationDraft() {
  state.draftCalibration = null;
  const target = calibrationReturnScreen === "camera" ? "camera" : "hub";
  state.currentScreen = target;
  notify();
  return target;
}

/**
 * Подтверждение и сохранение калибровки (решение 2A: всегда сохраняет в localStorage,
 * делает activeReference и переводит на экран camera).
 * @param {import("../core/types.js").PoseReference} confirmedRef
 * @param {boolean} [saveToLibrary]
 * @returns {{ ok: true, ref: import("../core/types.js").PoseReference } | { ok: false, error: string, quotaExceeded?: boolean }}
 */
export function commitCalibrationDraft(confirmedRef, saveToLibrary = true) {
  const nameCheck = validateCalibrationName(confirmedRef.name);
  if (!nameCheck.ok) {
    return { ok: false, error: nameCheck.error };
  }

  const skelCheck = validateCalibrationSkeleton(confirmedRef.landmarks);
  if (!skelCheck.ok) {
    return { ok: false, error: skelCheck.error };
  }

  const isPreset = confirmedRef.source === "preset";
  const nextId = isPreset
    ? `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    : confirmedRef.id;

  /** @type {import("../core/types.js").PoseReference} */
  const clean = {
    ...confirmedRef,
    id: nextId,
    name: nameCheck.name,
    source: saveToLibrary ? "custom" : confirmedRef.source,
    category: saveToLibrary ? "saved" : confirmedRef.category,
    landmarks: cloneLandmarks(confirmedRef.landmarks),
    autoLandmarks: cloneLandmarks(confirmedRef.autoLandmarks)
  };

  if (saveToLibrary) {
    const idx = state.savedCalibrations.findIndex((c) => c.id === clean.id);
    const nextSaved =
      idx >= 0
        ? state.savedCalibrations.map((c, i) => (i === idx ? clean : c))
        : [clean, ...state.savedCalibrations];
    const res = saveCalibrationsList(nextSaved);
    if (!res.ok) {
      return { ok: false, error: res.error, quotaExceeded: res.quotaExceeded };
    }
    state.savedCalibrations = nextSaved;
  }

  state.activeReference = clean;
  state.draftCalibration = null;
  state.runtime.holdMs = 0;
  state.currentScreen = "camera";
  saveLastActiveReferenceId(clean.id);
  notify();
  return { ok: true, ref: clean };
}

/**
 * Удаление сохраненной калибровки с синхронизацией в localStorage.
 * Если удаляется текущий activeReference, переключает его на первый доступный пресет.
 * @param {string} id
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function deleteSavedCalibration(id) {
  const nextSaved = state.savedCalibrations.filter((c) => c.id !== id);
  if (nextSaved.length === state.savedCalibrations.length) {
    return { ok: true };
  }

  const res = saveCalibrationsList(nextSaved);
  if (!res.ok) {
    return { ok: false, error: res.error };
  }

  state.savedCalibrations = nextSaved;

  if (state.activeReference?.id === id) {
    state.activeReference = cloneReference(state.presets[0] || null);
    state.runtime.holdMs = 0;
    saveLastActiveReferenceId(state.activeReference?.id || null);
  }

  notify();
  return { ok: true };
}

/**
 * Переименование сохраненной калибровки с валидацией и синхронизацией в localStorage.
 * @param {string} id
 * @param {string} rawName
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function renameSavedCalibration(id, rawName) {
  const validation = validateCalibrationName(rawName);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const existing = state.savedCalibrations.find((c) => c.id === id);
  if (!existing) {
    return { ok: false, error: "Калибровка не найдена." };
  }

  if (existing.name === validation.name) {
    return { ok: true, name: validation.name };
  }

  const nextSaved = state.savedCalibrations.map((c) =>
    c.id === id ? { ...c, name: validation.name } : c
  );
  const res = saveCalibrationsList(nextSaved);
  if (!res.ok) {
    return { ok: false, error: res.error };
  }

  state.savedCalibrations = nextSaved;
  if (state.activeReference?.id === id) {
    state.activeReference = {
      ...state.activeReference,
      name: validation.name
    };
  }

  notify();
  return { ok: true, name: validation.name };
}

/**
 * @param {Partial<import("../core/types.js").AppSettings>} patch
 * @returns {void}
 */
export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  saveSettings(state.settings);
  notify();
}

/**
 * @param {Partial<import("../core/types.js").RuntimeStatus>} patch
 * @returns {void}
 */
export function updateRuntime(patch) {
  state.runtime = { ...state.runtime, ...patch };
  notify();
}

/**
 * Сброс эфемерного состояния камеры при паузе/выходе с экрана съемки.
 * @returns {void}
 */
export function resetCameraRuntime() {
  state.runtime = {
    ...state.runtime,
    cameraReady: false,
    isRecordingPose: false,
    countdownSec: 0,
    holdMs: 0,
    shutterCooldownMs: 0
  };
  notify();
}

/**
 * @param {import("../core/types.js").CapturedShot} shot
 * @returns {void}
 */
export function addCapturedShot(shot) {
  state.shots = [shot, ...state.shots];
  state.selectedShotId = shot.id;
  notify();
}

/**
 * @param {string | null} shotId
 * @returns {void}
 */
export function selectShot(shotId) {
  state.selectedShotId = shotId;
  notify();
}

/**
 * @param {boolean} show
 * @returns {void}
 */
export function setShowSkeletonOverlay(show) {
  state.showSkeletonOverlay = show;
  notify();
}
