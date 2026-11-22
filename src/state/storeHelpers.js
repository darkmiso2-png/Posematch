import { resolveInitialReference } from "../core/cameraHudLogic.js";
import { cloneLandmarks } from "../core/poseMath.js";
import { buildInitialPresets } from "../core/presetRenderer.js";
import {
  loadLastActiveReferenceId,
  loadSavedCalibrations,
  loadSettings
} from "../services/storageService.js";

/**
 * Глубокое клонирование эталона для защиты состояния от мутаций.
 * @param {import("../core/types.js").PoseReference | null} ref
 * @returns {import("../core/types.js").PoseReference | null}
 */
export function cloneReference(ref) {
  if (!ref) return null;
  return {
    ...ref,
    landmarks: cloneLandmarks(ref.landmarks),
    autoLandmarks: cloneLandmarks(ref.autoLandmarks)
  };
}

/**
 * Создание начального состояния AppState (Camera-First v2).
 * @returns {import("../core/types.js").AppState}
 */
export function createInitialState() {
  const presets = buildInitialPresets();
  const savedCalibrations = loadSavedCalibrations();
  const initialActiveRef = cloneReference(
    resolveInitialReference(presets, savedCalibrations, loadLastActiveReferenceId())
  );

  return {
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
}

/**
 * Сборка нормализованного объекта калибровки перед сохранением.
 * @param {import("../core/types.js").PoseReference} confirmedRef
 * @param {string} cleanName
 * @param {boolean} saveToLibrary
 * @returns {import("../core/types.js").PoseReference}
 */
export function buildCommittedCalibration(confirmedRef, cleanName, saveToLibrary) {
  const isPreset = confirmedRef.source === "preset";
  const nextId = isPreset
    ? `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    : confirmedRef.id;

  return {
    ...confirmedRef,
    id: nextId,
    name: cleanName,
    source: saveToLibrary ? "custom" : confirmedRef.source,
    category: saveToLibrary ? "saved" : confirmedRef.category,
    landmarks: cloneLandmarks(confirmedRef.landmarks),
    autoLandmarks: cloneLandmarks(confirmedRef.autoLandmarks)
  };
}
