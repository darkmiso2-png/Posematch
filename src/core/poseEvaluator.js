import { BONE_CONNECTIONS } from "./constants.js";
import { clamp, isJointActive, midpoint, wrapAngle } from "./poseMath.js";

/**
 * @param {"left" | "right"} sideLabel
 * @param {"upper" | "forearm"} segType
 * @param {number} uy
 * @param {number} ry
 * @returns {string}
 */
function buildArmHint(sideLabel, segType, uy, ry) {
  const side = sideLabel === "left" ? "Левую" : "Правую";
  const sideGen = sideLabel === "left" ? "левый" : "правый";
  if (ry < uy - 0.18) return `${side} руку выше`;
  if (ry > uy + 0.18) return `${side} руку ниже`;
  if (segType === "forearm") return `Поправьте ${sideGen} локоть`;
  return `Поправьте ${side.toLowerCase()} руку`;
}

/**
 * @param {string} id
 * @param {number} ux
 * @param {number} uy
 * @param {number} rx
 * @param {number} ry
 * @param {import("./types.js").SegmentGroup} group
 * @returns {string}
 */
function boneHint(id, ux, uy, rx, ry, group) {
  if (id === "shoulder_line") return "Выровняйте линию плеч";
  if (id === "left_upper_arm") return buildArmHint("left", "upper", uy, ry);
  if (id === "right_upper_arm") return buildArmHint("right", "upper", uy, ry);
  if (id === "left_forearm") return buildArmHint("left", "forearm", uy, ry);
  if (id === "right_forearm") return buildArmHint("right", "forearm", uy, ry);
  if (group === "torso") return "Поправьте наклон корпуса";
  return "Поправьте положение ног";
}

/**
 * Сравнение позы пользователя и эталона по углам сегментов.
 * @param {import("./types.js").JointPoint[]} userLms
 * @param {import("./types.js").JointPoint[]} refLms
 * @param {number} videoAspect
 * @param {number} refAspect
 * @returns {import("./types.js").PoseEvaluation}
 */
export function evaluatePose(userLms, refLms, videoAspect, refAspect) {
  /** @type {Map<string, import("./types.js").SegmentResult>} */
  const segResults = new Map();
  /** @type {Record<import("./types.js").SegmentGroup, number[]>} */
  const buckets = { shoulders: [], elbows: [], torso: [], head: [], hips: [] };
  /** @type {{ worst: import("./types.js").SegmentResult | null }} */
  const tracker = { worst: null };
  let activeSegments = 0;

  /**
   * @param {string} id
   * @param {import("./types.js").SegmentGroup} group
   * @param {string} label
   * @param {import("./types.js").JointPoint | null | undefined} rA
   * @param {import("./types.js").JointPoint | null | undefined} rB
   * @param {import("./types.js").JointPoint | null | undefined} uA
   * @param {import("./types.js").JointPoint | null | undefined} uB
   * @param {(ux: number, uy: number, rx: number, ry: number) => string} hintFn
   */
  function check(id, group, label, rA, rB, uA, uB, hintFn) {
    if (!isJointActive(rA) || !isJointActive(rB) || !rA || !rB) return;
    activeSegments += 1;

    if (!isJointActive(uA) || !isJointActive(uB) || !uA || !uB) {
      const e = {
        id,
        group,
        score: 0,
        match: false,
        hint: `Покажите ${label.toLowerCase()} в кадр`
      };
      segResults.set(id, e);
      buckets[group].push(0);
      if (!tracker.worst || e.score < tracker.worst.score) tracker.worst = e;
      return;
    }

    const rdx = (rB.x - rA.x) * refAspect;
    const rdy = rB.y - rA.y;
    const udx = (uB.x - uA.x) * videoAspect;
    const udy = uB.y - uA.y;
    const rLen = Math.hypot(rdx, rdy);
    const uLen = Math.hypot(udx, udy);
    if (rLen < 1e-4 || uLen < 1e-4) return;

    const diffDeg =
      (Math.abs(wrapAngle(Math.atan2(udy, udx) - Math.atan2(rdy, rdx))) * 180) / Math.PI;
    const score = clamp(100 * (1 - Math.max(0, diffDeg - 8) / 57), 0, 100);
    const match = score >= 75;
    const hint = match ? "" : hintFn(udx / uLen, udy / uLen, rdx / rLen, rdy / rLen);
    const e = { id, group, score, match, hint };
    segResults.set(id, e);
    buckets[group].push(score);
    if (!tracker.worst || score < tracker.worst.score) tracker.worst = e;
  }

  for (const b of BONE_CONNECTIONS) {
    check(
      b.id,
      b.group,
      b.label,
      refLms[b.a],
      refLms[b.b],
      userLms[b.a],
      userLms[b.b],
      (ux, uy, rx, ry) => boneHint(b.id, ux, uy, rx, ry, b.group)
    );
  }

  if (isJointActive(refLms[11]) && isJointActive(refLms[12]) && isJointActive(refLms[0])) {
    const rSh = midpoint(refLms[11], refLms[12]);
    const uSh =
      isJointActive(userLms[11]) && isJointActive(userLms[12])
        ? midpoint(userLms[11], userLms[12])
        : null;
    check("head_neck", "head", "Голову", rSh, refLms[0], uSh, userLms[0], (ux, _uy, rx) =>
      rx < ux - 0.12
        ? "Наклоните голову вправо"
        : rx > ux + 0.12
          ? "Наклоните голову влево"
          : "Поправьте наклон головы"
    );
  }

  if (
    isJointActive(refLms[11]) &&
    isJointActive(refLms[12]) &&
    isJointActive(refLms[23]) &&
    isJointActive(refLms[24])
  ) {
    const rSh = midpoint(refLms[11], refLms[12]);
    const rHip = midpoint(refLms[23], refLms[24]);
    const uSh =
      isJointActive(userLms[11]) && isJointActive(userLms[12])
        ? midpoint(userLms[11], userLms[12])
        : null;
    const uHip =
      isJointActive(userLms[23]) && isJointActive(userLms[24])
        ? midpoint(userLms[23], userLms[24])
        : null;
    check(
      "torso_spine",
      "torso",
      "Корпус",
      rSh,
      rHip,
      uSh,
      uHip,
      () => "Выпрямите или наклоните корпус"
    );
  }

  /** @type {Record<import("./types.js").SegmentGroup, number | null>} */
  const groupScores = { shoulders: null, elbows: null, torso: null, head: null, hips: null };
  /** @type {number[]} */
  const allScores = [];
  for (const grp of /** @type {import("./types.js").SegmentGroup[]} */ (Object.keys(buckets))) {
    const arr = buckets[grp];
    if (arr.length > 0) {
      groupScores[grp] = Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
      allScores.push(...arr);
    }
  }

  if (activeSegments < 2 || allScores.length === 0) {
    return {
      totalScore: 0,
      groupScores,
      segResults,
      worstHint: "Включите минимум 2 сегмента в калибровке"
    };
  }

  const totalScore = Math.round(allScores.reduce((s, v) => s + v, 0) / allScores.length);
  return {
    totalScore,
    groupScores,
    segResults,
    worstHint:
      tracker.worst && !tracker.worst.match ? tracker.worst.hint : "Отлично! Удерживайте позу"
  };
}
