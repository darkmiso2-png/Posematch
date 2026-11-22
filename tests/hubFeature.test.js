import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSkeleton } from "../src/core/poseMath.js";
import {
  CALIBRATION_NAME_MAX_LENGTH,
  loadSavedCalibrations,
  saveCalibrationsList,
  validateCalibrationName
} from "../src/services/storageService.js";
import {
  commitCalibrationDraft,
  deleteSavedCalibration,
  getState,
  renameSavedCalibration
} from "../src/state/store.js";

/**
 * @param {boolean} [throwQuota]
 */
function createMockStorage(throwQuota = false) {
  /** @type {Map<string, string>} */
  const map = new Map();
  let setCalls = 0;
  return {
    get setCalls() {
      return setCalls;
    },
    /** @param {string} k */
    getItem(k) {
      return map.has(k) ? /** @type {string} */ (map.get(k)) : null;
    },
    /**
     * @param {string} k
     * @param {string} v
     */
    setItem(k, v) {
      setCalls += 1;
      if (throwQuota) {
        const err = new Error("Quota exceeded");
        err.name = "QuotaExceededError";
        throw err;
      }
      map.set(k, v);
    },
    /** @param {string} k */
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
    key() {
      return null;
    },
    get length() {
      return map.size;
    }
  };
}

/**
 * @param {string} id
 * @param {string} name
 * @returns {import("../src/core/types.js").PoseReference}
 */
function makeCustomRef(id, name) {
  const skel = createDefaultSkeleton();
  return {
    id,
    name,
    source: "custom",
    category: "saved",
    imageDataUrl: "data:image/png;base64,AAA",
    aspect: 0.75,
    landmarks: skel,
    autoLandmarks: skel,
    autoDetected: true,
    createdAt: 1000
  };
}

describe("validateCalibrationName", () => {
  it("rejects empty and whitespace-only strings", () => {
    expect(validateCalibrationName("").ok).toBe(false);
    expect(validateCalibrationName("   \t\n  ").ok).toBe(false);
  });

  it("trims edges and collapses repeated spaces", () => {
    const res = validateCalibrationName("   Моя    новая   поза  ");
    expect(res).toEqual({ ok: true, name: "Моя новая поза" });
  });

  it("truncates names exceeding max length", () => {
    const long = "А".repeat(CALIBRATION_NAME_MAX_LENGTH + 15);
    const res = validateCalibrationName(long);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.name.length).toBe(CALIBRATION_NAME_MAX_LENGTH);
    }
  });
});

describe("storageService quota handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("catches QuotaExceededError without throwing", () => {
    vi.stubGlobal("localStorage", createMockStorage(true));
    const res = saveCalibrationsList([makeCustomRef("c1", "Тест")]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.quotaExceeded).toBe(true);
    }
  });

  it("persists and loads calibrations list", () => {
    vi.stubGlobal("localStorage", createMockStorage(false));
    const item = makeCustomRef("c2", "Стойка");
    expect(saveCalibrationsList([item]).ok).toBe(true);
    const loaded = loadSavedCalibrations();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Стойка");
  });
});

describe("store calibration rename and delete", () => {
  /** @type {ReturnType<typeof createMockStorage>} */
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage(false);
    vi.stubGlobal("localStorage", mockStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renames active calibration immutably and skips no-op writes", () => {
    const ref = makeCustomRef("custom-rename-1", "Поза А");
    commitCalibrationDraft(ref, true);
    const prevActive = getState().activeReference;
    const callsBeforeNoop = mockStorage.setCalls;

    const noopRes = renameSavedCalibration("custom-rename-1", "  Поза   А ");
    expect(noopRes).toEqual({ ok: true, name: "Поза А" });
    expect(mockStorage.setCalls).toBe(callsBeforeNoop);

    const renameRes = renameSavedCalibration("custom-rename-1", "  Поза Б  ");
    expect(renameRes).toEqual({ ok: true, name: "Поза Б" });
    const nextActive = getState().activeReference;
    expect(nextActive?.name).toBe("Поза Б");
    expect(nextActive).not.toBe(prevActive);
    expect(prevActive?.name).toBe("Поза А");

    const emptyRes = renameSavedCalibration("custom-rename-1", "   ");
    expect(emptyRes.ok).toBe(false);

    deleteSavedCalibration("custom-rename-1");
  });

  it("falls back activeReference to presets[0] when active calibration is deleted", () => {
    const ref = makeCustomRef("custom-del-active", "Временная");
    commitCalibrationDraft(ref, true);
    expect(getState().activeReference?.id).toBe("custom-del-active");

    const delRes = deleteSavedCalibration("custom-del-active");
    expect(delRes.ok).toBe(true);
    expect(getState().activeReference?.id).toBe(getState().presets[0].id);
    expect(getState().savedCalibrations.some((c) => c.id === "custom-del-active")).toBe(false);
  });
});
