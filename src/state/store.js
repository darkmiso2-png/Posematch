import { cloneLandmarks } from "../core/poseMath.js";
import { buildInitialPresets } from "../core/presetRenderer.js";
import {
  loadSavedCalibrations,
  loadSettings,
  saveCalibrationsList,
  saveSettings,
  validateCalibrationName
} from "../services/storageService.js";

/** @type {Set<(state: import("../core/types.js").AppState) => void>} */
const listeners = new Set();

const presets = buildInitialPresets();
const savedCalibrations = loadSavedCalibrations();

/** @type {import("../core/types.js").AppState} */
const state = {
  currentScreen: "hub",
  activeFilter: "all",
  presets,
  savedCalibrations,
  activeReference: presets[0] || null,
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
  state.activeReference = {
    ...ref,
    landmarks: cloneLandmarks(ref.landmarks),
    autoLandmarks: cloneLandmarks(ref.autoLandmarks)
  };
  state.runtime.holdMs = 0;
  notify();
}

/**
 * @param {import("../core/types.js").PoseReference} ref
 * @returns {void}
 */
export function openCalibrationDraft(ref) {
  state.draftCalibration = {
    ...ref,
    landmarks: cloneLandmarks(ref.landmarks),
    autoLandmarks: cloneLandmarks(ref.autoLandmarks)
  };
  state.currentScreen = "calibration";
  notify();
}

/**
 * @param {import("../core/types.js").PoseReference} confirmedRef
 * @param {boolean} [saveToLibrary]
 * @returns {boolean}
 */
export function commitCalibrationDraft(confirmedRef, saveToLibrary = false) {
  const clean = {
    ...confirmedRef,
    landmarks: cloneLandmarks(confirmedRef.landmarks),
    autoLandmarks: cloneLandmarks(confirmedRef.autoLandmarks)
  };
  state.activeReference = clean;
  state.draftCalibration = null;

  let savedOk = true;
  if (saveToLibrary) {
    const customCopy = {
      ...clean,
      category: /** @type {const} */ ("saved"),
      source: /** @type {const} */ ("custom")
    };
    const idx = state.savedCalibrations.findIndex((c) => c.id === customCopy.id);
    const nextSaved =
      idx >= 0
        ? state.savedCalibrations.map((c, i) => (i === idx ? customCopy : c))
        : [customCopy, ...state.savedCalibrations];
    const res = saveCalibrationsList(nextSaved);
    savedOk = res.ok;
    if (res.ok) {
      state.savedCalibrations = nextSaved;
    }
  }

  state.currentScreen = "camera";
  notify();
  return savedOk;
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
    const fallback = state.presets[0] || null;
    state.activeReference = fallback
      ? {
          ...fallback,
          landmarks: cloneLandmarks(fallback.landmarks),
          autoLandmarks: cloneLandmarks(fallback.autoLandmarks)
        }
      : null;
    state.runtime.holdMs = 0;
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
