import { JOINT_VISIBILITY_THRESHOLD, LR_SWAP_PAIRS, TOTAL_LANDMARKS } from "./constants.js";

/**
 * @param {import("./types.js").JointPoint | null | undefined} lm
 * @returns {boolean}
 */
export function isJointActive(lm) {
  return Boolean(
    lm && (lm.visibility === undefined || lm.visibility >= JOINT_VISIBILITY_THRESHOLD)
  );
}

/**
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * @param {number} rad
 * @returns {number}
 */
export function wrapAngle(rad) {
  let angle = rad;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

/**
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {{ x: number, y: number }}
 */
export function midpoint(a, b) {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

/**
 * @param {import("./types.js").JointPoint[]} lms
 * @returns {import("./types.js").JointPoint[]}
 */
export function cloneLandmarks(lms) {
  return lms.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z ?? 0,
    visibility: p.visibility ?? 1
  }));
}

/**
 * @returns {import("./types.js").JointPoint[]}
 */
function createBlankLandmarks() {
  return Array.from({ length: TOTAL_LANDMARKS }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0
  }));
}

/**
 * @param {Record<number, [number, number, number?]>} pts
 * @returns {import("./types.js").JointPoint[]}
 */
export function buildFullPose(pts) {
  const arr = createBlankLandmarks();
  for (const [idxStr, coords] of Object.entries(pts)) {
    const idx = Number(idxStr);
    arr[idx] = { x: coords[0], y: coords[1], z: 0, visibility: coords[2] ?? 1 };
  }
  return arr;
}

/**
 * @returns {import("./types.js").JointPoint[]}
 */
export function createDefaultSkeleton() {
  return buildFullPose({
    0: [0.5, 0.17, 1],
    11: [0.59, 0.3, 1],
    12: [0.41, 0.3, 1],
    13: [0.66, 0.43, 1],
    14: [0.34, 0.43, 1],
    15: [0.68, 0.56, 1],
    16: [0.32, 0.56, 1],
    23: [0.56, 0.56, 1],
    24: [0.44, 0.56, 1],
    25: [0.57, 0.74, 1],
    26: [0.43, 0.74, 1],
    27: [0.58, 0.9, 1],
    28: [0.42, 0.9, 1]
  });
}

/**
 * @param {import("./types.js").JointPoint[]} lms
 * @returns {import("./types.js").JointPoint[]}
 */
export function getMirroredCopy(lms) {
  const copy = cloneLandmarks(lms);
  for (const p of copy) p.x = 1 - p.x;
  for (const [a, b] of LR_SWAP_PAIRS) {
    const tmp = copy[a];
    copy[a] = copy[b];
    copy[b] = tmp;
  }
  return copy;
}
