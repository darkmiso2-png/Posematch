import { inferFacingModeFromDevice } from "./cameraHudLogic.js";
import { cloneLandmarks, getMirroredCopy } from "./poseMath.js";

/**
 * @typedef {"user" | "environment" | "unknown"} NormalizedCameraFacing
 *
 * @typedef {Object} CameraMirrorInput
 * @property {string | null | undefined} [facingMode]
 * @property {string} [deviceId]
 * @property {string} [deviceLabel]
 * @property {boolean} [mirrorFrontCamera]
 *
 * @typedef {Object} CameraMirrorState
 * @property {NormalizedCameraFacing} normalizedFacing
 * @property {boolean} isRearCamera
 * @property {boolean} canToggleMirror
 * @property {boolean} savedPreference
 * @property {boolean} effectiveMirror
 *
 * @typedef {Object} FrontMirrorToggleCopy
 * @property {string} label
 * @property {string} ariaLabel
 * @property {string} title
 * @property {boolean} disabled
 * @property {boolean} pressed
 */

/**
 * Детерминированно определяет направление активной камеры после запуска потока.
 * Не опирается на флаг зеркалирования, чтобы «честный кадр» не маскировал переднюю камеру под заднюю.
 * @param {string | null | undefined} streamFacingMode
 * @param {string} [deviceId]
 * @param {string} [deviceLabel]
 * @param {"user" | "environment" | ""} [preferredFacingMode]
 * @returns {"user" | "environment" | ""}
 */
export function resolveActiveCameraFacing(
  streamFacingMode,
  deviceId = "",
  deviceLabel = "",
  preferredFacingMode = ""
) {
  if (streamFacingMode === "user" || streamFacingMode === "environment") {
    return streamFacingMode;
  }
  const inferred = inferFacingModeFromDevice(deviceId, deviceLabel);
  if (inferred) return inferred;
  if (preferredFacingMode === "user" || preferredFacingMode === "environment") {
    return preferredFacingMode;
  }
  return "";
}

/**
 * Вычисляет итоговое состояние зеркалирования камеры.
 * - Задняя камера (`environment`) всегда прямая (`effectiveMirror: false`), тумблер недоступен,
 *   но предпочтение пользователя `savedPreference` для передней камеры сохраняется.
 * - Передняя камера (`user`) и неопределённый `facingMode` (вебкамера ПК без label)
 *   детерминированно управляются настройкой `mirrorFrontCamera`.
 * @param {CameraMirrorInput} [input]
 * @returns {CameraMirrorState}
 */
export function resolveCameraMirrorState(input = {}) {
  const rawFacing = input.facingMode || "";
  /** @type {NormalizedCameraFacing} */
  let normalizedFacing = "unknown";

  if (rawFacing === "environment" || rawFacing === "user") {
    normalizedFacing = rawFacing;
  } else {
    const inferred = inferFacingModeFromDevice(input.deviceId || "", input.deviceLabel || "");
    normalizedFacing = inferred || "unknown";
  }

  const isRearCamera = normalizedFacing === "environment";
  const savedPreference = input.mirrorFrontCamera !== false;
  return {
    normalizedFacing,
    isRearCamera,
    canToggleMirror: !isRearCamera,
    savedPreference,
    effectiveMirror: isRearCamera ? false : savedPreference
  };
}

/**
 * Тексты и состояние доступности кнопки «Честная передняя камера»
 * строго в терминологии «Передняя / Задняя».
 * @param {CameraMirrorState} mirrorState
 * @param {boolean} [isBusy]
 * @returns {FrontMirrorToggleCopy}
 */
export function getFrontMirrorToggleCopy(mirrorState, isBusy = false) {
  if (mirrorState.isRearCamera) {
    return {
      label: "Задняя камера: прямой кадр",
      ariaLabel: "Зеркалирование отключено для задней камеры (прямой кадр)",
      title: "На задней камере кадр всегда прямой",
      disabled: true,
      pressed: false
    };
  }

  if (mirrorState.effectiveMirror) {
    return {
      label: "Передняя: как в зеркале",
      ariaLabel:
        "Передняя камера: режим «как в зеркале». Нажмите, чтобы включить честный неотзеркаленный кадр",
      title: "Переключить на честный (неотзеркаленный) кадр",
      disabled: Boolean(isBusy),
      pressed: true
    };
  }

  return {
    label: "Передняя: честный кадр",
    ariaLabel:
      "Передняя камера: честный неотзеркаленный кадр. Нажмите, чтобы включить режим «как в зеркале»",
    title: "Переключить на режим «как в зеркале»",
    disabled: Boolean(isBusy),
    pressed: false
  };
}

/**
 * Определяет, нужно ли отражать миниатюру эталона, чтобы её ориентация
 * строго совпадала с визуальной ориентацией живого оверлея на экране.
 * @param {boolean} mirrorRef
 * @param {boolean} effectiveCameraMirror
 * @returns {boolean}
 */
export function shouldMirrorReferencePreview(mirrorRef, effectiveCameraMirror) {
  return Boolean(mirrorRef) !== Boolean(effectiveCameraMirror);
}

/**
 * Проекция нормализованной X-координаты [0..1] из сырого видеопотока в экранную ось X видоискателя.
 * @param {number} x
 * @param {boolean} effectiveMirror
 * @returns {number}
 */
export function projectNormalizedXToViewport(x, effectiveMirror) {
  return effectiveMirror ? 1 - x : x;
}

/**
 * Синхронная трансформация скелета пользователя при сохранении снимка или 3с-записи позы.
 * @param {import("./types.js").JointPoint[] | null} userLandmarks
 * @param {boolean} effectiveMirror
 * @returns {import("./types.js").JointPoint[] | null}
 */
export function transformShotLandmarksForCapture(userLandmarks, effectiveMirror) {
  if (!userLandmarks) return null;
  return effectiveMirror ? getMirroredCopy(userLandmarks) : cloneLandmarks(userLandmarks);
}
