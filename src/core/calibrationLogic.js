import { BONE_CONNECTIONS, EDITABLE_JOINTS, JOINT_NAMES } from "./constants.js";
import { clamp, cloneLandmarks, getMirroredCopy, isJointActive } from "./poseMath.js";

const CALIBRATION_HIT_RADIUS_PX = 26;
const CALIBRATION_DRAG_THRESHOLD_PX = 6;
const CALIBRATION_DOUBLE_TAP_MS = 320;
const CALIBRATION_DOUBLE_TAP_DIST_PX = 28;
const MIN_ACTIVE_CALIBRATION_SEGMENTS = 2;

const EDITABLE_SET = new Set(EDITABLE_JOINTS);

/**
 * @typedef {Object} HiddenJointInfo
 * @property {number} index
 * @property {string} name
 */

/**
 * @typedef {Object} TapRecord
 * @property {number} idx
 * @property {number} x
 * @property {number} y
 * @property {number} time
 */

/**
 * Переводит координаты холста в нормализованные [0.01..0.99].
 * @param {number} px
 * @param {number} py
 * @param {number} width
 * @param {number} height
 * @returns {{ x: number, y: number }}
 */
export function canvasToNormalized(px, py, width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { x: 0.5, y: 0.5 };
  }
  return {
    x: clamp(px / width, 0.01, 0.99),
    y: clamp(py / height, 0.01, 0.99)
  };
}

/**
 * Поиск ближайшего редактируемого сустава в радиусе захвата.
 * @param {import("./types.js").JointPoint[]} landmarks
 * @param {number} px
 * @param {number} py
 * @param {number} width
 * @param {number} height
 * @param {number} [hitRadius]
 * @returns {number} Индекс сустава или -1
 */
export function findNearestJoint(
  landmarks,
  px,
  py,
  width,
  height,
  hitRadius = CALIBRATION_HIT_RADIUS_PX
) {
  if (!Array.isArray(landmarks) || width <= 0 || height <= 0) return -1;
  let bestIdx = -1;
  let bestDist = hitRadius;
  for (const idx of EDITABLE_JOINTS) {
    const p = landmarks[idx];
    if (!p) continue;
    const dist = Math.hypot(p.x * width - px, p.y * height - py);
    if (dist <= bestDist) {
      bestDist = dist;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

/**
 * Перемещение редактируемого сустава с ограничением координат и активацией.
 * @param {import("./types.js").JointPoint[]} landmarks
 * @param {number} idx
 * @param {number} normX
 * @param {number} normY
 * @returns {boolean}
 */
export function moveJoint(landmarks, idx, normX, normY) {
  if (!EDITABLE_SET.has(idx) || !landmarks[idx]) return false;
  landmarks[idx].x = clamp(normX, 0.01, 0.99);
  landmarks[idx].y = clamp(normY, 0.01, 0.99);
  landmarks[idx].visibility = 1;
  return true;
}

/**
 * Переключает видимость сустава (0 <-> 1).
 * @param {import("./types.js").JointPoint[]} landmarks
 * @param {number} idx
 * @returns {boolean | null} Новое состояние активности (true = вкл.) или null
 */
export function toggleJointVisibility(landmarks, idx) {
  if (!EDITABLE_SET.has(idx) || !landmarks[idx]) return null;
  const nextActive = !isJointActive(landmarks[idx]);
  landmarks[idx].visibility = nextActive ? 1 : 0;
  return nextActive;
}

/**
 * Явно задает видимость одного редактируемого сустава.
 * @param {import("./types.js").JointPoint[]} landmarks
 * @param {number} idx
 * @param {boolean} visible
 * @returns {boolean}
 */
export function setJointVisibility(landmarks, idx, visible) {
  if (!EDITABLE_SET.has(idx) || !landmarks[idx]) return false;
  landmarks[idx].visibility = visible ? 1 : 0;
  return true;
}

/**
 * Возвращает видимость всем редактируемым суставам.
 * @param {import("./types.js").JointPoint[]} landmarks
 * @returns {number} Количество восстановленных скрытых точек
 */
export function restoreAllJoints(landmarks) {
  let restored = 0;
  for (const idx of EDITABLE_JOINTS) {
    const p = landmarks[idx];
    if (!p) continue;
    if (!isJointActive(p)) restored += 1;
    p.visibility = 1;
  }
  return restored;
}

/**
 * Возвращает список выключенных редактируемых суставов с русскими названиями.
 * @param {import("./types.js").JointPoint[]} landmarks
 * @returns {HiddenJointInfo[]}
 */
export function getHiddenJoints(landmarks) {
  /** @type {HiddenJointInfo[]} */
  const hidden = [];
  for (const idx of EDITABLE_JOINTS) {
    const p = landmarks[idx];
    if (!isJointActive(p)) {
      hidden.push({
        index: idx,
        name: JOINT_NAMES[idx] || `Точка ${idx}`
      });
    }
  }
  return hidden;
}

/**
 * Отзеркаливание позы по X (1 - x) с обменом левых/правых индексов MediaPipe.
 * @param {import("./types.js").JointPoint[]} landmarks
 * @returns {import("./types.js").JointPoint[]}
 */
export function mirrorCalibrationLandmarks(landmarks) {
  return getMirroredCopy(landmarks);
}

/**
 * Сброс к исходным точкам автодетекции (включая все скрытые точки).
 * @param {import("./types.js").JointPoint[]} autoLandmarks
 * @returns {import("./types.js").JointPoint[]}
 */
export function resetCalibrationLandmarks(autoLandmarks) {
  return cloneLandmarks(autoLandmarks);
}

/**
 * Подсчет активных оцениваемых сегментов (синхронно с evaluatePose).
 * @param {import("./types.js").JointPoint[]} landmarks
 * @returns {number}
 */
export function countActiveSegments(landmarks) {
  if (!Array.isArray(landmarks)) return 0;
  let active = 0;
  for (const b of BONE_CONNECTIONS) {
    if (isJointActive(landmarks[b.a]) && isJointActive(landmarks[b.b])) {
      active += 1;
    }
  }
  if (isJointActive(landmarks[11]) && isJointActive(landmarks[12]) && isJointActive(landmarks[0])) {
    active += 1;
  }
  if (
    isJointActive(landmarks[11]) &&
    isJointActive(landmarks[12]) &&
    isJointActive(landmarks[23]) &&
    isJointActive(landmarks[24])
  ) {
    active += 1;
  }
  return active;
}

/**
 * Проверка, что в позе достаточно активных сегментов для оценки на камере.
 * @param {import("./types.js").JointPoint[]} landmarks
 * @returns {{ ok: true, activeSegments: number } | { ok: false, activeSegments: number, error: string }}
 */
export function validateCalibrationSkeleton(landmarks) {
  const activeSegments = countActiveSegments(landmarks);
  if (activeSegments < MIN_ACTIVE_CALIBRATION_SEGMENTS) {
    return {
      ok: false,
      activeSegments,
      error: `Слишком мало активных точек: для оценки позы нужно минимум ${MIN_ACTIVE_CALIBRATION_SEGMENTS} активных сегмента.`
    };
  }
  return { ok: true, activeSegments };
}

/**
 * Проверяет, превышен ли порог начала перетаскивания (anti-conflict с double-tap).
 * @param {{ x: number, y: number }} startPos
 * @param {{ x: number, y: number }} currPos
 * @param {number} [thresholdPx]
 * @returns {boolean}
 */
export function isDragExceeded(startPos, currPos, thresholdPx = CALIBRATION_DRAG_THRESHOLD_PX) {
  return Math.hypot(currPos.x - startPos.x, currPos.y - startPos.y) >= thresholdPx;
}

/**
 * Единый детектор двойного тапа/клика по суставу.
 * @param {TapRecord | null} prevTap
 * @param {TapRecord} nextTap
 * @param {number} [maxDelayMs]
 * @param {number} [maxDistPx]
 * @returns {boolean}
 */
export function shouldTriggerDoubleTap(
  prevTap,
  nextTap,
  maxDelayMs = CALIBRATION_DOUBLE_TAP_MS,
  maxDistPx = CALIBRATION_DOUBLE_TAP_DIST_PX
) {
  if (!prevTap || prevTap.idx < 0 || nextTap.idx !== prevTap.idx) return false;
  const dt = nextTap.time - prevTap.time;
  if (dt < 0 || dt > maxDelayMs) return false;
  return Math.hypot(nextTap.x - prevTap.x, nextTap.y - prevTap.y) <= maxDistPx;
}
