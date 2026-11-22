import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_CACHE_NAMES,
  CDN_CACHE_NAME,
  PRECACHE_URLS,
  SHELL_CACHE_NAME,
  canRegisterServiceWorker,
  classifyFetchRequest,
  getObsoleteCacheNames,
  isCacheableResponse
} from "../src/core/pwaLogic.js";

const ROOT = resolve(process.cwd());
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Читает размеры PNG из заголовка IHDR и проверяет PNG-сигнатуру.
 * @param {string} relPath
 * @returns {{ signature: number[], width: number, height: number, ihdrType: string }}
 */
function readPngMeta(relPath) {
  const buf = readFileSync(resolve(ROOT, relPath));
  return {
    signature: Array.from(buf.subarray(0, 8)),
    ihdrType: buf.subarray(12, 16).toString("ascii"),
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

describe("pwaLogic: request classification & cache management", () => {
  const appOrigin = "https://user.github.io";

  it("uses network-first for same-origin GET requests", () => {
    expect(
      classifyFetchRequest({
        method: "GET",
        url: "https://user.github.io/posematch/src/main.js",
        appOrigin
      })
    ).toEqual({ strategy: "network-first", cacheName: SHELL_CACHE_NAME });

    expect(
      classifyFetchRequest({
        method: "get",
        url: "./styles/tokens.css",
        appOrigin
      })
    ).toEqual({ strategy: "network-first", cacheName: SHELL_CACHE_NAME });
  });

  it("uses cache-first for MediaPipe CDN hosts", () => {
    expect(
      classifyFetchRequest({
        method: "GET",
        url: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/vision_wasm_internal.wasm",
        appOrigin
      })
    ).toEqual({ strategy: "cache-first", cacheName: CDN_CACHE_NAME });

    expect(
      classifyFetchRequest({
        method: "GET",
        url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        appOrigin
      })
    ).toEqual({ strategy: "cache-first", cacheName: CDN_CACHE_NAME });
  });

  it("bypasses non-GET, extension schemes, blob/data/file URLs and unknown hosts", () => {
    for (const req of [
      { method: "POST", url: "https://user.github.io/api" },
      { method: "GET", url: "chrome-extension://abcdef/content.js" },
      { method: "GET", url: "moz-extension://abcdef/content.js" },
      { method: "GET", url: "blob:https://user.github.io/1234" },
      { method: "GET", url: "data:image/png;base64,AAAA" },
      { method: "GET", url: "file:///C:/Antigravity/index.html" },
      { method: "GET", url: "https://example.com/analytics.js" }
    ]) {
      expect(classifyFetchRequest({ ...req, appOrigin })).toEqual({
        strategy: "bypass",
        cacheName: null
      });
    }
  });

  it("filters only obsolete posematch-* caches and keeps active or foreign caches", () => {
    const names = [...ACTIVE_CACHE_NAMES, "posematch-shell-v0", "posematch-cdn-v0", "other-app-v1"];
    expect(getObsoleteCacheNames(names)).toEqual(["posematch-shell-v0", "posematch-cdn-v0"]);
  });

  it("caches only HTTP 200 responses", () => {
    expect(isCacheableResponse(200)).toBe(true);
    expect(isCacheableResponse(206)).toBe(false);
    expect(isCacheableResponse(404)).toBe(false);
    expect(isCacheableResponse(0)).toBe(false);
  });

  it("allows SW registration only in secure context on https or localhost/127.0.0.1", () => {
    expect(
      canRegisterServiceWorker({
        hasServiceWorker: true,
        isSecureContext: true,
        protocol: "https:",
        hostname: "example.github.io"
      })
    ).toBe(true);

    expect(
      canRegisterServiceWorker({
        hasServiceWorker: true,
        isSecureContext: true,
        protocol: "http:",
        hostname: "localhost"
      })
    ).toBe(true);

    expect(
      canRegisterServiceWorker({
        hasServiceWorker: true,
        isSecureContext: true,
        protocol: "http:",
        hostname: "127.0.0.1"
      })
    ).toBe(true);

    expect(
      canRegisterServiceWorker({
        hasServiceWorker: true,
        isSecureContext: false,
        protocol: "http:",
        hostname: "192.168.1.10"
      })
    ).toBe(false);

    expect(
      canRegisterServiceWorker({
        hasServiceWorker: true,
        isSecureContext: true,
        protocol: "file:",
        hostname: ""
      })
    ).toBe(false);
  });
});

describe("PWA assets: manifest.webmanifest, precache URLs and binary PNG icons", () => {
  it("has all PRECACHE_URLS present on disk", () => {
    for (const rel of PRECACHE_URLS) {
      const normalized = rel === "./" ? "index.html" : rel.replace(/^\.\//, "");
      expect(existsSync(resolve(ROOT, normalized))).toBe(true);
    }
  });

  it("validates manifest.webmanifest fields and strict relative paths", () => {
    const raw = readFileSync(resolve(ROOT, "manifest.webmanifest"), "utf8");
    const manifest = JSON.parse(raw);

    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("portrait");
    expect(manifest.background_color).toBe("#0b0d12");
    expect(manifest.theme_color).toBe("#0b0d12");
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
    expect(manifest.id).toBe("./");
    expect(manifest.start_url.startsWith("/")).toBe(false);
    expect(manifest.scope.startsWith("/")).toBe(false);

    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("./icons/")).toBe(true);
      expect(icon.src.startsWith("/")).toBe(false);
    }

    expect(
      manifest.icons.some(
        (/** @type {{ sizes: string, purpose: string }} */ i) =>
          i.sizes === "192x192" && i.purpose === "any"
      )
    ).toBe(true);
    expect(
      manifest.icons.some(
        (/** @type {{ sizes: string, purpose: string }} */ i) =>
          i.sizes === "512x512" && i.purpose === "any"
      )
    ).toBe(true);
    expect(
      manifest.icons.some(
        (/** @type {{ sizes: string, purpose: string }} */ i) =>
          i.sizes === "512x512" && i.purpose === "maskable"
      )
    ).toBe(true);
  });

  it("validates binary PNG signatures and exact IHDR dimensions", () => {
    expect(existsSync(resolve(ROOT, "icons/icon.svg"))).toBe(true);

    const expected = [
      { path: "icons/icon-192.png", width: 192, height: 192 },
      { path: "icons/icon-512.png", width: 512, height: 512 },
      { path: "icons/icon-maskable-512.png", width: 512, height: 512 },
      { path: "icons/apple-touch-icon.png", width: 180, height: 180 }
    ];

    for (const item of expected) {
      const meta = readPngMeta(item.path);
      expect(meta.signature).toEqual(PNG_SIGNATURE);
      expect(meta.ihdrType).toBe("IHDR");
      expect(meta.width).toBe(item.width);
      expect(meta.height).toBe(item.height);
    }
  });
});
