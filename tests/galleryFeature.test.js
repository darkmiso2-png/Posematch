import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildShotDownloadFilename,
  formatShotMetadata,
  removeShotAndResolveSelection,
  resolveSelectedShot,
  resolveShotReference,
  sanitizeFilenameSegment
} from "../src/core/galleryLogic.js";
import { createDefaultSkeleton } from "../src/core/poseMath.js";
import {
  addCapturedShot,
  deleteShot,
  getState,
  navigateTo,
  selectShot,
  setShowSkeletonOverlay
} from "../src/state/store.js";

/**
 * @param {string} id
 * @param {Partial<import("../src/core/types.js").CapturedShot>} [patch]
 * @returns {import("../src/core/types.js").CapturedShot}
 */
function makeShot(id, patch = {}) {
  return {
    id,
    referenceId: "preset-1",
    referenceName: "Портрет у окна",
    referenceImageDataUrl: "data:image/png;base64,REF",
    refMirrored: false,
    imageDataUrl: "data:image/jpeg;base64,SHOT",
    score: 88,
    userLandmarks: createDefaultSkeleton(),
    refLandmarks: createDefaultSkeleton(),
    createdAt: 1700000000000,
    ...patch
  };
}

/**
 * @param {string} id
 * @param {string} name
 * @returns {import("../src/core/types.js").PoseReference}
 */
function makeRef(id, name) {
  const skel = createDefaultSkeleton();
  return {
    id,
    name,
    source: "custom",
    category: "saved",
    imageDataUrl: "data:image/jpeg;base64,SAVED",
    aspect: 0.75,
    landmarks: skel,
    autoLandmarks: skel,
    autoDetected: true,
    createdAt: 1700000000000
  };
}

describe("galleryLogic filename sanitization and download naming", () => {
  it("transliterates cyrillic and strips unsafe path/special chars", () => {
    expect(sanitizeFilenameSegment("Портрет у окна")).toBe("portret-u-okna");
    expect(sanitizeFilenameSegment("../../Фото: тест?! #1")).toBe("foto-test-1");
    expect(sanitizeFilenameSegment("   ")).toBe("pose");
    expect(sanitizeFilenameSegment("***")).toBe("pose");
  });

  it("builds safe JPG filename with clamped score and timestamp", () => {
    const shot = makeShot("s1", { score: 104.6, createdAt: 1712345678901 });
    expect(buildShotDownloadFilename(shot, "Динамичный шаг!")).toBe(
      "posematch-dinamichnyy-shag-100pct-1712345678901.jpg"
    );

    const invalidShot = makeShot("s2", {
      referenceName: "",
      score: Number.NaN,
      createdAt: 0
    });
    const name = buildShotDownloadFilename(invalidShot, "");
    expect(name).toMatch(/^posematch-pose-0pct-\d+\.jpg$/);
  });
});

describe("galleryLogic selection and deletion resolution", () => {
  it("resolves active shot with fallback to first item or null", () => {
    const s1 = makeShot("s1");
    const s2 = makeShot("s2");
    expect(resolveSelectedShot([], "s1")).toBeNull();
    expect(resolveSelectedShot([s1, s2], "s2")?.id).toBe("s2");
    expect(resolveSelectedShot([s1, s2], "missing")?.id).toBe("s1");
    expect(resolveSelectedShot([s1, s2], null)?.id).toBe("s1");
  });

  it("selects neighbor shot after deleting first, middle or last shot", () => {
    const s1 = makeShot("s1");
    const s2 = makeShot("s2");
    const s3 = makeShot("s3");

    const delFirst = removeShotAndResolveSelection([s1, s2, s3], "s1", "s1");
    expect(delFirst.removed).toBe(true);
    expect(delFirst.shots.map((s) => s.id)).toEqual(["s2", "s3"]);
    expect(delFirst.selectedShotId).toBe("s2");

    const delMid = removeShotAndResolveSelection([s1, s2, s3], "s2", "s2");
    expect(delMid.shots.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(delMid.selectedShotId).toBe("s3");

    const delLast = removeShotAndResolveSelection([s1, s2, s3], "s3", "s3");
    expect(delLast.shots.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(delLast.selectedShotId).toBe("s2");

    const delOnly = removeShotAndResolveSelection([s1], "s1", "s1");
    expect(delOnly.shots).toEqual([]);
    expect(delOnly.selectedShotId).toBeNull();
  });

  it("preserves selectedShotId when deleting another shot or missing id", () => {
    const s1 = makeShot("s1");
    const s2 = makeShot("s2");

    const delOther = removeShotAndResolveSelection([s1, s2], "s2", "s1");
    expect(delOther.selectedShotId).toBe("s1");

    const delMissing = removeShotAndResolveSelection([s1, s2], "nope", "s2");
    expect(delMissing.removed).toBe(false);
    expect(delMissing.selectedShotId).toBe("s2");
  });
});

describe("galleryLogic reference resolution and metadata", () => {
  it("prefers embedded shot reference snapshot and falls back to saved/presets", () => {
    const preset = makeRef("preset-1", "Пресет База");
    const saved = makeRef("custom-1", "Моя стойка");

    const shotWithSnapshot = makeShot("s1", {
      referenceId: "custom-1",
      referenceName: "Снимок позы",
      referenceImageDataUrl: "data:image/png;base64,SNAP",
      refMirrored: true
    });
    const r1 = resolveShotReference(shotWithSnapshot, [preset], [saved], null, false);
    expect(r1.name).toBe("Снимок позы");
    expect(r1.imageDataUrl).toBe("data:image/png;base64,SNAP");
    expect(r1.mirrorImage).toBe(true);

    const legacyShot = makeShot("s2", {
      referenceId: "custom-1",
      referenceName: undefined,
      referenceImageDataUrl: undefined,
      refMirrored: undefined
    });
    const r2 = resolveShotReference(legacyShot, [preset], [saved], null, true);
    expect(r2.name).toBe("Моя стойка");
    expect(r2.imageDataUrl).toBe("data:image/jpeg;base64,SAVED");
    expect(r2.mirrorImage).toBe(true);
  });

  it("formats metadata safely when userLandmarks is missing or timestamp invalid", () => {
    const s1 = makeShot("s1", { userLandmarks: null, score: -10, createdAt: 0 });
    const s2 = makeShot("s2", { score: 92, createdAt: 1712345678901 });
    const meta1 = formatShotMetadata(s1, [s1, s2], "  Базовая  ");
    expect(meta1.referenceName).toBe("Базовая");
    expect(meta1.score).toBe(0);
    expect(meta1.takeLabel).toBe("Дубль 2 из 2");
    expect(meta1.timeLabel).toBe("--:--");
    expect(meta1.hasUserSkeleton).toBe(false);

    const meta2 = formatShotMetadata(s2, [s1, s2], "");
    expect(meta2.referenceName).toBe("Эталон");
    expect(meta2.takeLabel).toBe("Дубль 1 из 2");
    expect(meta2.hasUserSkeleton).toBe(true);
  });
});

describe("store gallery actions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    });
    while (getState().shots.length > 0) {
      deleteShot(getState().shots[0].id);
    }
    setShowSkeletonOverlay(true);
  });

  afterEach(() => {
    while (getState().shots.length > 0) {
      deleteShot(getState().shots[0].id);
    }
    navigateTo("camera");
    vi.unstubAllGlobals();
  });

  it("adds, selects, toggles skeleton and deletes shots down to empty state", () => {
    addCapturedShot(makeShot("g1", { score: 80 }));
    addCapturedShot(makeShot("g2", { score: 90 }));
    addCapturedShot(makeShot("g3", { score: 95 }));

    expect(getState().shots.map((s) => s.id)).toEqual(["g3", "g2", "g1"]);
    expect(getState().selectedShotId).toBe("g3");

    selectShot("g2");
    expect(getState().selectedShotId).toBe("g2");

    setShowSkeletonOverlay(false);
    expect(getState().showSkeletonOverlay).toBe(false);

    expect(deleteShot("g2")).toBe(true);
    expect(getState().shots.map((s) => s.id)).toEqual(["g3", "g1"]);
    expect(getState().selectedShotId).toBe("g1");

    expect(deleteShot("g1")).toBe(true);
    expect(getState().selectedShotId).toBe("g3");

    expect(deleteShot("g3")).toBe(true);
    expect(getState().shots).toEqual([]);
    expect(getState().selectedShotId).toBeNull();
    expect(deleteShot("missing")).toBe(false);
  });
});
