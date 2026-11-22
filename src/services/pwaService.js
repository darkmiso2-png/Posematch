import { canRegisterServiceWorker } from "../core/pwaLogic.js";

/**
 * Выполняет регистрацию Service Worker после загрузки страницы.
 * @returns {Promise<boolean>}
 */
async function performRegistration() {
  try {
    await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
      type: "module"
    });
    return true;
  } catch (err) {
    console.warn("Service Worker registration skipped:", err);
    return false;
  }
}

/**
 * Безопасно регистрирует PWA Service Worker, не блокируя старт камеры и MediaPipe.
 * @returns {Promise<boolean>}
 */
export function registerPwaServiceWorker() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return Promise.resolve(false);
  }
  const allowed = canRegisterServiceWorker({
    hasServiceWorker: "serviceWorker" in navigator,
    isSecureContext: Boolean(window.isSecureContext),
    protocol: window.location.protocol,
    hostname: window.location.hostname
  });
  if (!allowed) {
    return Promise.resolve(false);
  }
  if (typeof document !== "undefined" && document.readyState === "complete") {
    return performRegistration();
  }
  return new Promise((resolve) => {
    window.addEventListener(
      "load",
      () => {
        void performRegistration().then(resolve);
      },
      { once: true }
    );
  });
}
