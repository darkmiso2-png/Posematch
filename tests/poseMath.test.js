import { describe, expect, it } from "vitest";
import { computeTargetPointsPx, createSmoothingState } from "../src/core/poseAlignment.js";
import { evaluatePose } from "../src/core/poseEvaluator.js";
import {
  buildFullPose,
  createDefaultSkeleton,
  getMirroredCopy,
  isJointActive,
  midpoint,
  remapPaddedLandmarks,
  wrapAngle
} from "../src/core/poseMath.js";

describe("poseMath", () => {
  it("normalizes angles via wrapAngle into [-PI, PI]", () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI * 0.5, 6);
  });

  it("computes midpoint and joint activity threshold", () => {
    const mid = midpoint({ x: 0.2, y: 0.4 }, { x: 0.6, y: 0.8 });
    expect(mid.x).toBeCloseTo(0.4, 6);
    expect(mid.y).toBeCloseTo(0.6, 6);
    expect(isJointActive({ x: 0.5, y: 0.5, visibility: 0.34 })).toBe(false);
    expect(isJointActive({ x: 0.5, y: 0.5, visibility: 0.35 })).toBe(true);
    expect(isJointActive({ x: 0.5, y: 0.5 })).toBe(true);
  });

  it("mirrors landmarks horizontally and swaps left/right pairs", () => {
    const pose = buildFullPose({
      11: [0.7, 0.3, 1],
      12: [0.3, 0.3, 1]
    });
    const mirrored = getMirroredCopy(pose);
    expect(mirrored[11].x).toBeCloseTo(0.7, 5);
    expect(mirrored[12].x).toBeCloseTo(0.3, 5);
  });
});

describe("evaluatePose", () => {
  it("returns 100% for identical skeleton poses", () => {
    const skel = createDefaultSkeleton();
    const res = evaluatePose(skel, skel, 16 / 9, 16 / 9);
    expect(res.totalScore).toBe(100);
  });

  it("ignores disabled joints in reference skeleton", () => {
    const ref = createDefaultSkeleton();
    const user = createDefaultSkeleton();
    ref[15].visibility = 0;
    user[15] = { x: 0.1, y: 0.9, z: 0, visibility: 1 };
    const res = evaluatePose(user, ref, 1, 1);
    expect(res.segResults.has("left_forearm")).toBe(false);
    expect(res.totalScore).toBe(100);
  });

  it("scores 0 when user joint is missing for active reference segment", () => {
    const ref = createDefaultSkeleton();
    const user = createDefaultSkeleton();
    user[15].visibility = 0;
    const res = evaluatePose(user, ref, 1, 1);
    const seg = res.segResults.get("left_forearm");
    expect(seg?.score).toBe(0);
    expect(res.totalScore).toBeLessThan(100);
  });

  it("returns 0 when fewer than 2 reference segments are active", () => {
    const ref = buildFullPose({ 11: [0.4, 0.3, 1], 12: [0.6, 0.3, 1] });
    const user = createDefaultSkeleton();
    const res = evaluatePose(user, ref, 1, 1);
    expect(res.totalScore).toBe(0);
  });
});

describe("computeTargetPointsPx", () => {
  it("anchors target skeleton to user shoulders with smoothing", () => {
    const ref = createDefaultSkeleton();
    const user = createDefaultSkeleton();
    const smoothing = createSmoothingState();
    const pts = computeTargetPointsPx(ref, user, 480, 640, 0.75, true, smoothing);
    expect(smoothing.initialized).toBe(true);
    expect(pts[11].active).toBe(true);
    expect(pts[0].y).toBeLessThan(pts[11].y);
  });
});

describe("remapPaddedLandmarks", () => {
  it("maps center and original image corners from 15% padded canvas back into [0..1]", () => {
    const padRatio = 0.15;
    const min = padRatio / (1 + 2 * padRatio);
    const max = (1 + padRatio) / (1 + 2 * padRatio);
    const remapped = remapPaddedLandmarks(
      [
        { x: 0.5, y: 0.5, z: -0.2, visibility: 0.9 },
        { x: min, y: min, z: 0, visibility: 1 },
        { x: max, y: max, z: 0, visibility: 0.8 },
        { x: 0.01, y: 0.99, z: 0, visibility: 0.7 }
      ],
      padRatio
    );
    expect(remapped[0].x).toBeCloseTo(0.5, 6);
    expect(remapped[0].y).toBeCloseTo(0.5, 6);
    expect(remapped[0].z).toBeCloseTo(-0.2, 6);
    expect(remapped[0].visibility).toBeCloseTo(0.9, 6);
    expect(remapped[1].x).toBeCloseTo(0, 6);
    expect(remapped[1].y).toBeCloseTo(0, 6);
    expect(remapped[2].x).toBeCloseTo(1, 6);
    expect(remapped[2].y).toBeCloseTo(1, 6);
    expect(remapped[3].x).toBe(0);
    expect(remapped[3].y).toBe(1);
  });

  it("supports exact rounded pixel layout mapping", () => {
    const layout = { imgX: 15, imgY: 30, imgW: 100, imgH: 200, canvasW: 130, canvasH: 260 };
    const remapped = remapPaddedLandmarks(
      [
        { x: 15 / 130, y: 30 / 260 },
        { x: 115 / 130, y: 230 / 260 },
        { x: 65 / 130, y: 130 / 260 }
      ],
      0.15,
      layout
    );
    expect(remapped[0].x).toBeCloseTo(0, 6);
    expect(remapped[0].y).toBeCloseTo(0, 6);
    expect(remapped[1].x).toBeCloseTo(1, 6);
    expect(remapped[1].y).toBeCloseTo(1, 6);
    expect(remapped[2].x).toBeCloseTo(0.5, 6);
    expect(remapped[2].y).toBeCloseTo(0.5, 6);
  });
});
