import { BONE_CONNECTIONS, EDITABLE_JOINTS } from "../core/constants.js";
import { computeTargetPointsPx } from "../core/poseAlignment.js";
import { isJointActive, midpoint } from "../core/poseMath.js";

/**
 * Отрисовка целевого скелета на оверлее камеры.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {import("../core/types.js").JointPoint[] | null} userLms
 * @param {import("../core/types.js").JointPoint[] | null} refLms
 * @param {number} refAspect
 * @param {boolean} attachToBody
 * @param {import("../core/types.js").SmoothingState} smoothing
 * @param {import("../core/types.js").PoseEvaluation | null} evalResult
 * @returns {void}
 */
export function drawStageOverlay(
  ctx,
  width,
  height,
  userLms,
  refLms,
  refAspect,
  attachToBody,
  smoothing,
  evalResult
) {
  ctx.clearRect(0, 0, width, height);
  if (!width || !height || !refLms) return;

  const targetPts = computeTargetPointsPx(
    refLms,
    userLms,
    width,
    height,
    refAspect,
    attachToBody,
    smoothing
  );

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(5, Math.round(width * 0.008));

  for (const b of BONE_CONNECTIONS) {
    const pa = targetPts[b.a];
    const pb = targetPts[b.b];
    if (!pa.active || !pb.active) continue;
    const seg = evalResult ? evalResult.segResults.get(b.id) : null;
    const color = !userLms ? "rgba(0, 229, 255, 0.55)" : seg && seg.match ? "#00e676" : "#ff5252";
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  if (targetPts[11].active && targetPts[12].active && targetPts[0].active) {
    const shMid = midpoint(targetPts[11], targetPts[12]);
    const headSeg = evalResult ? evalResult.segResults.get("head_neck") : null;
    const hColor = !userLms
      ? "rgba(0, 229, 255, 0.55)"
      : headSeg && headSeg.match
        ? "#00e676"
        : "#ff5252";
    ctx.strokeStyle = hColor;
    ctx.shadowColor = hColor;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(shMid.x, shMid.y);
    ctx.lineTo(targetPts[0].x, targetPts[0].y);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  for (const idx of EDITABLE_JOINTS) {
    const pt = targetPts[idx];
    if (!pt.active) continue;
    ctx.fillStyle = "rgba(11, 13, 18, 0.7)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, idx === 0 ? 10 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Отрисовка нормализованного скелета поверх статичного изображения (миниатюра / галерея).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {import("../core/types.js").JointPoint[] | null} lms
 * @param {string} [color]
 * @returns {void}
 */
export function drawStaticSkeleton(ctx, width, height, lms, color = "#00e5ff") {
  if (!lms || !width || !height) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, Math.round(width * 0.01));

  for (const b of BONE_CONNECTIONS) {
    const pa = lms[b.a];
    const pb = lms[b.b];
    if (!isJointActive(pa) || !isJointActive(pb)) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * width, pa.y * height);
    ctx.lineTo(pb.x * width, pb.y * height);
    ctx.stroke();
  }

  if (isJointActive(lms[11]) && isJointActive(lms[12]) && isJointActive(lms[0])) {
    const sh = midpoint(lms[11], lms[12]);
    ctx.beginPath();
    ctx.moveTo(sh.x * width, sh.y * height);
    ctx.lineTo(lms[0].x * width, lms[0].y * height);
    ctx.stroke();
  }

  ctx.fillStyle = "#ffffff";
  for (const idx of EDITABLE_JOINTS) {
    const pt = lms[idx];
    if (!isJointActive(pt)) continue;
    ctx.beginPath();
    ctx.arc(pt.x * width, pt.y * height, Math.max(2.5, width * 0.012), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Отрисовка редактируемого скелета на экране калибровки.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} img
 * @param {number} width
 * @param {number} height
 * @param {import("../core/types.js").JointPoint[]} lms
 * @param {number} draggingIdx
 * @param {boolean} [isMirrored]
 * @returns {number} Количество выключенных точек
 */
export function drawCalibrationCanvas(
  ctx,
  img,
  width,
  height,
  lms,
  draggingIdx,
  isMirrored = false
) {
  ctx.clearRect(0, 0, width, height);
  if (isMirrored) {
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, width, height);
    ctx.restore();
  } else {
    ctx.drawImage(img, 0, 0, width, height);
  }
  ctx.fillStyle = "rgba(6, 8, 13, 0.25)";
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.lineCap = "round";
  for (const b of BONE_CONNECTIONS) {
    const a = lms[b.a];
    const bp = lms[b.b];
    const active = isJointActive(a) && isJointActive(bp);
    ctx.setLineDash(active ? [] : [5, 5]);
    ctx.lineWidth = active ? 4 : 2;
    ctx.strokeStyle = active ? "#00e5ff" : "rgba(160, 174, 192, 0.45)";
    ctx.beginPath();
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(bp.x * width, bp.y * height);
    ctx.stroke();
  }

  if (lms[11] && lms[12] && lms[0]) {
    const headOn = isJointActive(lms[11]) && isJointActive(lms[12]) && isJointActive(lms[0]);
    const sh = midpoint(lms[11], lms[12]);
    ctx.setLineDash(headOn ? [] : [5, 5]);
    ctx.lineWidth = headOn ? 4 : 2;
    ctx.strokeStyle = headOn ? "#00e5ff" : "rgba(160, 174, 192, 0.45)";
    ctx.beginPath();
    ctx.moveTo(sh.x * width, sh.y * height);
    ctx.lineTo(lms[0].x * width, lms[0].y * height);
    ctx.stroke();
  }

  let hiddenCount = 0;
  /** @type {Array<{ x: number, y: number }>} */
  const disabledMarkers = [];
  for (const idx of EDITABLE_JOINTS) {
    const p = lms[idx];
    const active = isJointActive(p);
    const jx = p.x * width;
    const jy = p.y * height;
    if (!active) {
      hiddenCount += 1;
      disabledMarkers.push({ x: jx, y: jy });
    }
    if (active && draggingIdx === idx) {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(jx, jy, 17, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 230, 118, 0.28)";
      ctx.fill();
    }
    ctx.setLineDash(active ? [] : [3, 3]);
    ctx.beginPath();
    ctx.arc(jx, jy, draggingIdx === idx ? 11 : 9, 0, Math.PI * 2);
    ctx.fillStyle = active ? (draggingIdx === idx ? "#00e676" : "#00e5ff") : "rgba(30,36,48,0.82)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = active ? "#0b0d12" : "#9aa5b8";
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.font = "600 10px Inter, Segoe UI, sans-serif";
  ctx.textBaseline = "middle";
  for (const m of disabledMarkers) {
    const label = "Выкл.";
    const padX = 5;
    const boxW = ctx.measureText(label).width + padX * 2;
    const boxH = 16;
    const rawX = m.x + 11;
    const boxX = rawX + boxW > width - 4 ? Math.max(4, m.x - boxW - 11) : rawX;
    const boxY = Math.max(4, Math.min(height - boxH - 4, m.y - boxH * 0.5));
    ctx.fillStyle = "rgba(11, 13, 18, 0.88)";
    ctx.strokeStyle = "rgba(154, 165, 184, 0.65)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f3f6fc";
    ctx.fillText(label, boxX + padX, boxY + boxH * 0.5 + 0.5);
  }
  ctx.restore();
  return hiddenCount;
}
