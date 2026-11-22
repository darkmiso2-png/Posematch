/**
 * @typedef {import("../core/types.js").ScreenId} ScreenId
 * @typedef {Partial<Record<ScreenId, () => void>>} ScreenHooks
 */

/**
 * Создает контроллер переключения экранов с жизненным циклом onLeave / onEnter.
 * Гарантирует однократный вызов onLeave при уходе и onEnter при входе на экран.
 * @param {Record<ScreenId, HTMLElement>} screens
 * @param {{ onEnter?: ScreenHooks, onLeave?: ScreenHooks }} [hooks]
 * @returns {(nextScreen: ScreenId) => void}
 */
export function createScreenRouter(screens, hooks = {}) {
  /** @type {ScreenId | null} */
  let currentScreen = null;

  return (nextScreen) => {
    const prevScreen = currentScreen;
    if (prevScreen === nextScreen) return;

    currentScreen = nextScreen;
    for (const [id, el] of Object.entries(screens)) {
      const active = id === nextScreen;
      el.classList.toggle("active", active);
      el.hidden = !active;
    }

    if (prevScreen) {
      hooks.onLeave?.[prevScreen]?.();
    }
    hooks.onEnter?.[nextScreen]?.();
  };
}
