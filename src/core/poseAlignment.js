import { clamp, isJointActive, midpoint } from "./poseMath.js";

/**
 * @returns {import("./types.js").SmoothingState}
 */
export function createSmoothingState() {
  return {
    initialized: false,
    cx: 0.5,
    cy: 0.4,
    torsoPx: 140
  };
}

/**
 * Расчет экранных координат скелета эталона (с привязкой к торсу и сглаживанием).
 * @param {import("./types.js").JointPoint[]} refLms
 * @param {import("./types.js").JointPoint[] | null} userLms
 * @param {number} width
 * @param {number} height
 * @param {number} refAspect
 * @param {boolean} attachToBody
 * @param {import("./types.js").SmoothingState} smoothing
 * @returns {import("./types.js").TargetPointPx[]}
 */
export function computeTargetPointsPx(
  refLms,
  userLms,
  width,
  height,
  refAspect,
  attachToBody,
  smoothing
) {
  const refHasSh = isJointActive(refLms[11]) && isJointActive(refLms[12]);
  const refHasHips = isJointActive(refLms[23]) && isJointActive(refLms[24]);
  const refAnchor = refHasSh ? midpoint(refLms[11], refLms[12]) : { x: 0.5, y: 0.32 };

  let refTorsoIso = 0.26;
  if (refHasSh && refHasHips) {
    const refHip = midpoint(refLms[23], refLms[24]);
    refTorsoIso = Math.max(
      0.08,
      Math.hypot((refHip.x - refAnchor.x) * refAspect, refHip.y - refAnchor.y)
    );
  } else if (refHasSh) {
    const sw = Math.hypot((refLms[12].x - refLms[11].x) * refAspect, refLms[12].y - refLms[11].y);
    refTorsoIso = Math.max(0.08, sw * 1.45);
  }

  let targetCx = width * 0.5;
  let targetCy = height * 0.34;
  let scalePx = (height * 0.28) / refTorsoIso;

  if (attachToBody && userLms && isJointActive(userLms[11]) && isJointActive(userLms[12])) {
    const uSh = midpoint(userLms[11], userLms[12]);
    let uTorsoPx;
    if (isJointActive(userLms[23]) && isJointActive(userLms[24])) {
      const uHip = midpoint(userLms[23], userLms[24]);
      uTorsoPx = Math.hypot((uHip.x - uSh.x) * width, (uHip.y - uSh.y) * height);
    } else {
      const uSwPx = Math.hypot(
        (userLms[12].x - userLms[11].x) * width,
        (userLms[12].y - userLms[11].y) * height
      );
      uTorsoPx = uSwPx * 1.45;
    }
    uTorsoPx = clamp(uTorsoPx, height * 0.1, height * 0.65);

    if (!smoothing.initialized) {
      smoothing.cx = uSh.x;
      smoothing.cy = uSh.y;
      smoothing.torsoPx = uTorsoPx;
      smoothing.initialized = true;
    } else {
      const alpha = 0.24;
      smoothing.cx += (uSh.x - smoothing.cx) * alpha;
      smoothing.cy += (uSh.y - smoothing.cy) * alpha;
      smoothing.torsoPx += (uTorsoPx - smoothing.torsoPx) * alpha;
    }

    targetCx = smoothing.cx * width;
    targetCy = smoothing.cy * height;
    scalePx = smoothing.torsoPx / refTorsoIso;
  }

  return refLms.map((p) => ({
    x: targetCx + (p.x - refAnchor.x) * refAspect * scalePx,
    y: targetCy + (p.y - refAnchor.y) * scalePx,
    active: isJointActive(p)
  }));
}
