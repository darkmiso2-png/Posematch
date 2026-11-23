import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GALLERY_MAX_SHOTS } from "../src/core/constants.js";
import { createDefaultSkeleton } from "../src/core/poseMath.js";
import {
  captureVideoFrameBlob,
  createShotDownloadUrl,
  revokeShotObjectUrl
} from "../src/services/shotMediaService.js";
import {
  addCapturedShot,
  clearShots,
  deleteShot,
  getState,
  navigateTo
} from "../src/state/store.js";
import { createGalleryScreen } from "../src/ui/screens/galleryScreen.js";

/**
 * @param {string} id
 * @param {Partial<import("../src/core/types.js").CapturedShot>} [patch]
 * @returns {import("../src/core/types.js").CapturedShot}
 */
function makeBlobShot(id, patch = {}) {
  return {
    id,
    referenceId: "preset-1",
    referenceName: "Портрет у окна",
    referenceImageDataUrl: "data:image/png;base64,REF",
    refMirrored: false,
    imageBlob: new Blob([id], { type: "image/jpeg" }),
    imageUrl: `blob:https://posematch.local/${id}`,
    score: 90,
    userLandmarks: createDefaultSkeleton(),
    refLandmarks: createDefaultSkeleton(),
    createdAt: 1700000000000,
    ...patch
  };
}

function createGalleryDomMock() {
  /** @type {Record<string, any>} */
  const elements = {};
  /** @type {Array<Record<string, any>>} */
  const createdLinks = [];
  /** @type {Array<{ src: string, alt: string }>} */
  const filmstripImgs = [];
  /** @type {Array<() => void>} */
  const loadedImgHandlers = [];

  /** @param {string} id */
  const makeEl = (id) => {
    const listeners = /** @type {Record<string, Array<() => void>>} */ ({});
    const el = {
      id,
      className: "",
      hidden: false,
      disabled: false,
      textContent: "",
      dataset: /** @type {Record<string, string>} */ ({}),
      children: /** @type {any[]} */ ([]),
      width: 0,
      height: 0,
      classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
      setAttribute: vi.fn(),
      querySelector: (/** @type {string} */ sel) => elements[sel] || null,
      append: (/** @type {any[]} */ ...items) => el.children.push(...items),
      replaceChildren: (/** @type {any[]} */ ...items) => {
        el.children = items;
      },
      addEventListener: (/** @type {string} */ ev, /** @type {() => void} */ fn) => {
        listeners[ev] = listeners[ev] || [];
        listeners[ev].push(fn);
      },
      click: () => (listeners.click || []).forEach((fn) => fn()),
      getContext: () => ({
        clearRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        scale: vi.fn(),
        drawImage: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn()
      })
    };
    return el;
  };

  [
    "#gal-content",
    "#gal-empty",
    "#gal-meta-pose",
    "#gal-meta-sub",
    "#gal-shot-score",
    "#gal-ref-note",
    "#gal-shot-note",
    "#gal-ref-canvas",
    "#gal-shot-canvas",
    "#gal-toggle-skel",
    "#gal-btn-download",
    "#gal-btn-delete",
    "#gal-strip-count",
    "#gal-strip",
    "#gal-notice",
    "#gal-btn-camera",
    "#gal-btn-hub"
  ].forEach((sel) => {
    elements[sel] = makeEl(sel);
  });

  const root = makeEl("root");
  const documentMock = {
    body: { appendChild: vi.fn() },
    createDocumentFragment: () => {
      /** @type {any[]} */
      const items = [];
      return { appendChild: (/** @type {any} */ node) => items.push(node), items };
    },
    createElement: (/** @type {string} */ tag) => {
      const node = makeEl(tag);
      if (tag === "a") {
        node.href = "";
        node.download = "";
        node.rel = "";
        node.remove = vi.fn();
        node.click = vi.fn();
        createdLinks.push(node);
      }
      if (tag === "img") {
        const imgNode = { src: "", alt: "", loading: "" };
        filmstripImgs.push(imgNode);
        return imgNode;
      }
      return node;
    }
  };

  class MockImage {
    constructor() {
      this._src = "";
      this.naturalWidth = 480;
      this.naturalHeight = 640;
      this.width = 480;
      this.height = 640;
      this.complete = true;
      /** @type {(() => void) | null} */
      this.onload = null;
      /** @type {(() => void) | null} */
      this.onerror = null;
    }
    get src() {
      return this._src;
    }
    /** @param {string} val */
    set src(val) {
      this._src = val;
      loadedImgHandlers.push(() => this.onload?.());
    }
  }

  return {
    root,
    elements,
    createdLinks,
    filmstripImgs,
    loadedImgHandlers,
    documentMock,
    MockImage
  };
}

describe("shotMediaService Blob capture, download URL and ObjectURL cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("captures canvas frame to Blob and creates ObjectURL", async () => {
    const mockBlob = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:captured-1");
    const scaleSpy = vi.fn();

    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ translate: vi.fn(), scale: scaleSpy, drawImage: vi.fn() }),
        toBlob: (/** @type {(b: Blob) => void} */ cb) => cb(mockBlob)
      })
    });

    const video = /** @type {HTMLVideoElement} */ ({ videoWidth: 720, videoHeight: 1280 });
    const res = await captureVideoFrameBlob(video, true, "image/jpeg", 0.92);

    expect(scaleSpy).toHaveBeenCalledWith(-1, 1);
    expect(createSpy).toHaveBeenCalledWith(mockBlob);
    expect(res).toEqual({ imageBlob: mockBlob, imageUrl: "blob:captured-1" });
  });

  it("revokes only blob: ObjectURLs and creates isolated download URLs", () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download-copy");

    const shot = makeBlobShot("d1");
    const dl = createShotDownloadUrl(shot);
    expect(dl).toEqual({ href: "blob:download-copy", isObjectUrl: true });
    expect(createSpy).toHaveBeenCalledWith(shot.imageBlob);

    revokeShotObjectUrl(shot);
    expect(revokeSpy).toHaveBeenCalledWith("blob:https://posematch.local/d1");

    revokeShotObjectUrl({
      ...shot,
      imageUrl: "data:image/jpeg;base64,LEGACY"
    });
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("store LRU eviction, deleteShot and clearShots revoke ObjectURL", () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let revokeSpy;

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    });
    clearShots();
    revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    clearShots();
    navigateTo("camera");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("evicts oldest shots above GALLERY_MAX_SHOTS and revokes their ObjectURLs", () => {
    for (let i = 1; i <= GALLERY_MAX_SHOTS; i += 1) {
      addCapturedShot(makeBlobShot(`shot-${i}`));
    }
    expect(getState().shots).toHaveLength(GALLERY_MAX_SHOTS);
    expect(revokeSpy).not.toHaveBeenCalled();

    addCapturedShot(makeBlobShot("shot-31"));
    expect(getState().shots).toHaveLength(GALLERY_MAX_SHOTS);
    expect(getState().shots[0].id).toBe("shot-31");
    expect(getState().shots.at(-1)?.id).toBe("shot-2");
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:https://posematch.local/shot-1");
  });

  it("revokes ObjectURL on deleteShot and revokes all URLs on clearShots", () => {
    addCapturedShot(makeBlobShot("s1"));
    addCapturedShot(makeBlobShot("s2"));
    addCapturedShot(makeBlobShot("s3"));

    expect(deleteShot("s2")).toBe(true);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:https://posematch.local/s2");

    revokeSpy.mockClear();
    expect(clearShots()).toBe(2);
    expect(getState().shots).toEqual([]);
    expect(getState().selectedShotId).toBeNull();
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledWith("blob:https://posematch.local/s3");
    expect(revokeSpy).toHaveBeenCalledWith("blob:https://posematch.local/s1");
  });
});

describe("galleryScreen rendering and downloading from Blob / ObjectURL", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders preview/filmstrip from ObjectURL and downloads isolated Blob URL", () => {
    const dom = createGalleryDomMock();
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:isolated-download");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    vi.stubGlobal("document", dom.documentMock);
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      setTimeout: vi.fn().mockReturnValue(77),
      clearTimeout: vi.fn()
    });
    vi.stubGlobal("Image", dom.MockImage);

    const screen = createGalleryScreen(
      /** @type {HTMLElement} */ (/** @type {unknown} */ (dom.root))
    );
    const shot = makeBlobShot("ui-1");
    const state = {
      ...getState(),
      shots: [shot],
      selectedShotId: shot.id
    };

    screen.render(state);
    dom.loadedImgHandlers.forEach((fn) => fn());

    expect(dom.filmstripImgs[0].src).toBe("blob:https://posematch.local/ui-1");
    expect(dom.elements["#gal-strip-count"].textContent).toBe("1");

    dom.elements["#gal-btn-download"].click();
    expect(createSpy).toHaveBeenCalledWith(shot.imageBlob);
    expect(dom.createdLinks[0].href).toBe("blob:isolated-download");
    expect(dom.createdLinks[0].download).toMatch(/^posematch-.*-90pct-\d+\.jpg$/);
    expect(dom.createdLinks[0].click).toHaveBeenCalledTimes(1);
    expect(revokeSpy).not.toHaveBeenCalledWith(shot.imageUrl);
  });
});
