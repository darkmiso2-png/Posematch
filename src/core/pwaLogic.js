const CACHE_PREFIX = "posematch-";
export const SHELL_CACHE_NAME = "posematch-shell-v1";
export const CDN_CACHE_NAME = "posematch-cdn-v1";

/** @type {readonly string[]} */
export const ACTIVE_CACHE_NAMES = [SHELL_CACHE_NAME, CDN_CACHE_NAME];

/** @type {readonly string[]} */
const MEDIAPIPE_CDN_HOSTS = ["cdn.jsdelivr.net", "storage.googleapis.com"];

/** @type {readonly string[]} */
const EXCLUDED_PROTOCOLS = [
  "chrome-extension:",
  "moz-extension:",
  "blob:",
  "data:",
  "file:",
  "about:"
];

/** @type {readonly string[]} */
export const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./styles/tokens.css",
  "./styles/layout.css",
  "./styles/hub.css",
  "./styles/hubCards.css",
  "./styles/calibration.css",
  "./styles/camera.css",
  "./styles/gallery.css"
];

/**
 * @typedef {"network-first" | "cache-first" | "bypass"} CacheStrategy
 *
 * @typedef {Object} FetchClassification
 * @property {CacheStrategy} strategy
 * @property {string | null} cacheName
 */

/**
 * Классифицирует HTTP-запрос для Service Worker.
 * @param {{ method: string, url: string, appOrigin: string }} input
 * @returns {FetchClassification}
 */
export function classifyFetchRequest({ method, url, appOrigin }) {
  if (!method || method.toUpperCase() !== "GET") {
    return { strategy: "bypass", cacheName: null };
  }
  if (!url) {
    return { strategy: "bypass", cacheName: null };
  }

  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(url, appOrigin);
  } catch {
    return { strategy: "bypass", cacheName: null };
  }

  if (EXCLUDED_PROTOCOLS.includes(parsed.protocol)) {
    return { strategy: "bypass", cacheName: null };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { strategy: "bypass", cacheName: null };
  }
  if (parsed.origin === appOrigin) {
    return { strategy: "network-first", cacheName: SHELL_CACHE_NAME };
  }
  if (MEDIAPIPE_CDN_HOSTS.includes(parsed.hostname)) {
    return { strategy: "cache-first", cacheName: CDN_CACHE_NAME };
  }
  return { strategy: "bypass", cacheName: null };
}

/**
 * Возвращает только устаревшие кэши PoseMatch для удаления при activate.
 * @param {readonly string[]} cacheNames
 * @returns {string[]}
 */
export function getObsoleteCacheNames(cacheNames) {
  return cacheNames.filter(
    (name) => name.startsWith(CACHE_PREFIX) && !ACTIVE_CACHE_NAMES.includes(name)
  );
}

/**
 * Проверяет допустимость кэширования ответа.
 * @param {number} status
 * @returns {boolean}
 */
export function isCacheableResponse(status) {
  return status === 200;
}

/**
 * Проверяет безопасность и допустимость регистрации Service Worker.
 * @param {{
 *   hasServiceWorker: boolean,
 *   isSecureContext: boolean,
 *   protocol: string,
 *   hostname: string
 * }} env
 * @returns {boolean}
 */
export function canRegisterServiceWorker(env) {
  if (!env.hasServiceWorker || !env.isSecureContext) {
    return false;
  }
  if (env.protocol === "https:") {
    return true;
  }
  if (env.protocol === "http:") {
    return env.hostname === "localhost" || env.hostname === "127.0.0.1" || env.hostname === "[::1]";
  }
  return false;
}
