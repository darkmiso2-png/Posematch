import {
  ACTIVE_CACHE_NAMES,
  PRECACHE_URLS,
  SHELL_CACHE_NAME,
  classifyFetchRequest,
  getObsoleteCacheNames,
  isCacheableResponse
} from "./src/core/pwaLogic.js";

/**
 * Безопасно сохраняет ответ в кэш без проброса ошибок квоты.
 * @param {string} cacheName
 * @param {RequestInfo} request
 * @param {Response} response
 * @returns {Promise<void>}
 */
async function safeCachePut(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (err) {
    console.warn("SW cache.put skipped:", err);
  }
}

/**
 * Неубиваемый pre-cache базовой оболочки через Promise.allSettled.
 * @returns {Promise<void>}
 */
async function precacheShell() {
  try {
    const cache = await caches.open(SHELL_CACHE_NAME);
    await Promise.allSettled(
      PRECACHE_URLS.map(async (url) => {
        const response = await fetch(new Request(url, { cache: "reload" }));
        if (isCacheableResponse(response)) {
          await cache.put(url, response.clone());
        }
      })
    );
  } catch (err) {
    console.warn("SW precache skipped:", err);
  }
}

/**
 * Стратегия Network-First для same-origin ресурсов с откатом на кэш в офлайне.
 * @param {Request} request
 * @param {string} cacheName
 * @returns {Promise<Response>}
 */
async function handleNetworkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (isCacheableResponse(networkResponse)) {
      await safeCachePut(cacheName, request, networkResponse.clone());
    }
    return networkResponse;
  } catch (networkErr) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    if (request.mode === "navigate") {
      const fallback = (await cache.match("./index.html")) || (await cache.match("./"));
      if (fallback) {
        return fallback;
      }
    }
    throw networkErr;
  }
}

/**
 * Стратегия Cache-First для тяжелых ресурсов CDN MediaPipe.
 * @param {Request} request
 * @param {string} cacheName
 * @returns {Promise<Response>}
 */
async function handleCacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const networkResponse = await fetch(request);
  if (isCacheableResponse(networkResponse)) {
    await safeCachePut(cacheName, request, networkResponse.clone());
  }
  return networkResponse;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheShell();
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const existingNames = await caches.keys();
      const obsolete = getObsoleteCacheNames(existingNames);
      await Promise.all(obsolete.map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { strategy, cacheName } = classifyFetchRequest({
    method: event.request.method,
    url: event.request.url,
    appOrigin: self.location.origin
  });
  if (strategy === "bypass" || !cacheName || !ACTIVE_CACHE_NAMES.includes(cacheName)) {
    return;
  }
  if (strategy === "network-first") {
    event.respondWith(handleNetworkFirst(event.request, cacheName));
    return;
  }
  if (strategy === "cache-first") {
    event.respondWith(handleCacheFirst(event.request, cacheName));
  }
});
