import { AUTO_SHUTTER_HOLD_MS, POSE_RECORD_SECONDS, SHUTTER_COOLDOWN_MS } from "./constants.js";
import { clamp } from "./poseMath.js";

/**
 * @typedef {"unsupported" | "insecure" | "permission" | "not_found" | "busy" | "unknown"} CameraErrorCode
 *
 * @typedef {Object} CameraErrorInfo
 * @property {CameraErrorCode} code
 * @property {string} title
 * @property {string} message
 * @property {boolean} canRetry
 *
 * @typedef {Object} AutoShutterState
 * @property {number} holdMs
 * @property {number} cooldownMs
 *
 * @typedef {Object} AutoShutterInput
 * @property {number} dtMs
 * @property {boolean} hasPose
 * @property {number} score
 * @property {number} threshold
 * @property {boolean} isRecording
 * @property {boolean} cameraReady
 *
 * @typedef {Object} AutoShutterStepResult
 * @property {number} holdMs
 * @property {number} cooldownMs
 * @property {boolean} shouldShoot
 * @property {number} progress
 *
 * @typedef {"idle" | "running" | "completed" | "cancelled"} CountdownStatus
 *
 * @typedef {Object} CountdownState
 * @property {CountdownStatus} status
 * @property {number} remainingMs
 * @property {number} displaySec
 * @property {number} durationMs
 */

/**
 * Выбор стартового активного эталона (Camera-First v2):
 * последний валидный ID -> presets[0] -> savedCalibrations[0] -> null.
 * @param {import("./types.js").PoseReference[]} presets
 * @param {import("./types.js").PoseReference[]} savedCalibrations
 * @param {string | null} lastActiveId
 * @returns {import("./types.js").PoseReference | null}
 */
export function resolveInitialReference(presets, savedCalibrations, lastActiveId) {
  if (lastActiveId) {
    const savedMatch = savedCalibrations.find((item) => item.id === lastActiveId);
    if (savedMatch) return savedMatch;
    const presetMatch = presets.find((item) => item.id === lastActiveId);
    if (presetMatch) return presetMatch;
  }
  return presets[0] || savedCalibrations[0] || null;
}

/**
 * Классификация ошибок доступа к камере для устойчивого Camera Fallback State.
 * @param {unknown} err
 * @param {boolean} [hasMediaDevices]
 * @param {boolean} [isSecureContext]
 * @returns {CameraErrorInfo}
 */
export function classifyCameraError(err, hasMediaDevices = true, isSecureContext = true) {
  if (!isSecureContext) {
    return {
      code: "insecure",
      title: "Нужен HTTPS или localhost",
      message:
        "Доступ к камере заблокирован в небезопасном контексте. Откройте через HTTPS или localhost.",
      canRetry: false
    };
  }

  if (!hasMediaDevices) {
    return {
      code: "unsupported",
      title: "Камера недоступна в браузере",
      message:
        "Браузер не поддерживает getUserMedia. Используйте другой браузер или загрузите фото в библиотеке.",
      canRetry: false
    };
  }

  const e = /** @type {{ name?: string, message?: string } | null} */ (err);
  const name = e?.name || "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return {
      code: "permission",
      title: "Нет разрешения на камеру",
      message:
        "Разрешите доступ к камере в настройках браузера и нажмите «Повторить доступ к камере».",
      canRetry: true
    };
  }

  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError" ||
    name === "ConstraintNotSatisfiedError"
  ) {
    return {
      code: "not_found",
      title: "Камера не найдена",
      message:
        "Подключенная камера не обнаружена или недоступна. Проверьте устройство и повторите попытку.",
      canRetry: true
    };
  }

  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return {
      code: "busy",
      title: "Камера занята",
      message:
        "Камера используется другим приложением или вкладкой. Освободите её и повторите попытку.",
      canRetry: true
    };
  }

  const detail = e?.message ? ` (${e.message})` : "";
  return {
    code: "unknown",
    title: "Не удалось запустить камеру",
    message: `Проверьте подключение и права доступа к камере${detail}.`,
    canRetry: true
  };
}

/**
 * Шаг расчета прогресса автозатвора (800 ms удержания + cooldown).
 * @param {AutoShutterState} state
 * @param {AutoShutterInput} input
 * @returns {AutoShutterStepResult}
 */
export function stepAutoShutter(state, input) {
  const dt = Math.min(100, Math.max(0, input.dtMs));
  let cooldownMs = Math.max(0, state.cooldownMs - dt);
  let holdMs = Math.max(0, state.holdMs);
  let shouldShoot = false;

  if (!input.cameraReady || input.isRecording || !input.hasPose || cooldownMs > 0) {
    holdMs = 0;
  } else if (input.score >= input.threshold) {
    holdMs += dt;
    if (holdMs >= AUTO_SHUTTER_HOLD_MS) {
      holdMs = 0;
      cooldownMs = SHUTTER_COOLDOWN_MS;
      shouldShoot = true;
    }
  } else {
    holdMs = Math.max(0, holdMs - dt * 2.5);
  }

  return {
    holdMs,
    cooldownMs,
    shouldShoot,
    progress: clamp(holdMs / AUTO_SHUTTER_HOLD_MS, 0, 1)
  };
}

/**
 * Параметры SVG-кольца прогресса автозатвора.
 * @param {number} holdMs
 * @param {number} [targetMs]
 * @param {number} [radius]
 * @returns {{ progress: number, percent: number, circumference: number, dashOffset: number }}
 */
export function computeShutterRingProgress(holdMs, targetMs = AUTO_SHUTTER_HOLD_MS, radius = 26) {
  const circumference = 2 * Math.PI * radius;
  const progress = targetMs > 0 ? clamp(holdMs / targetMs, 0, 1) : 0;
  return {
    progress,
    percent: Math.round(progress * 100),
    circumference,
    dashOffset: circumference * (1 - progress)
  };
}

/**
 * Начальное состояние стейт-машины обратного отсчета 3-2-1.
 * @returns {CountdownState}
 */
export function createIdleCountdown() {
  return { status: "idle", remainingMs: 0, displaySec: 0, durationMs: 0 };
}

/**
 * Запуск обратного отсчета записи позы.
 * @param {number} [seconds]
 * @returns {CountdownState}
 */
export function startCountdown(seconds = POSE_RECORD_SECONDS) {
  const safeSec = Math.max(1, Math.round(seconds));
  const durationMs = safeSec * 1000;
  return {
    status: "running",
    remainingMs: durationMs,
    displaySec: safeSec,
    durationMs
  };
}

/**
 * Тик стейт-машины обратного отсчета.
 * @param {CountdownState} state
 * @param {number} dtMs
 * @returns {{ state: CountdownState, tickChanged: boolean, finished: boolean }}
 */
export function stepCountdown(state, dtMs) {
  if (state.status !== "running") {
    return { state, tickChanged: false, finished: false };
  }

  const dt = Math.max(0, dtMs);
  const nextRemaining = state.remainingMs - dt;
  if (nextRemaining <= 0) {
    return {
      state: {
        status: "completed",
        remainingMs: 0,
        displaySec: 0,
        durationMs: state.durationMs
      },
      tickChanged: false,
      finished: true
    };
  }

  const nextSec = Math.max(1, Math.ceil(nextRemaining / 1000));
  return {
    state: {
      status: "running",
      remainingMs: nextRemaining,
      displaySec: nextSec,
      durationMs: state.durationMs
    },
    tickChanged: nextSec !== state.displaySec,
    finished: false
  };
}

/**
 * Отмена активного обратного отсчета.
 * @param {CountdownState} state
 * @returns {CountdownState}
 */
export function cancelCountdown(state) {
  return {
    status: state.status === "running" ? "cancelled" : state.status,
    remainingMs: 0,
    displaySec: 0,
    durationMs: state.durationMs
  };
}

/**
 * Определяет, нужно ли зеркалить превью и захваченный кадр камеры.
 * Передняя камера (user) и веб-камеры ПК управляются mirrorFrontCamera, задняя (environment) — всегда прямая.
 * @param {string | null | undefined} facingMode
 * @param {string} [deviceLabel]
 * @param {boolean} [mirrorFrontCamera]
 * @returns {boolean}
 */
export function shouldMirrorCamera(facingMode, deviceLabel = "", mirrorFrontCamera = true) {
  if (facingMode === "environment") return false;
  if (facingMode === "user") return Boolean(mirrorFrontCamera);
  if (!facingMode && inferFacingModeFromDevice("", deviceLabel) === "environment") return false;
  return Boolean(mirrorFrontCamera);
}

/**
 * Определяет направление камеры ("user" | "environment") по deviceId или label для fallback-запроса.
 * @param {string} [deviceId]
 * @param {string} [deviceLabel]
 * @returns {"user" | "environment" | null}
 */
export function inferFacingModeFromDevice(deviceId = "", deviceLabel = "") {
  const combined = `${deviceLabel} ${deviceId}`.trim();
  if (!combined) return null;
  if (/(?:^|[^a-zа-яё])(back|rear|environment|тыл|задн)/i.test(combined)) return "environment";
  if (/(?:^|[^a-zа-яё])(front|user|фронт|передн)/i.test(combined)) return "user";
  return null;
}
