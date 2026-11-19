/**
 * Управление активным экраном из 4-экранного потока.
 * @param {Record<import("../core/types.js").ScreenId, HTMLElement>} screens
 * @param {import("../core/types.js").ScreenId} currentScreen
 * @param {Partial<Record<import("../core/types.js").ScreenId, () => void>>} [onEnter]
 * @returns {void}
 */
export function applyActiveScreen(screens, currentScreen, onEnter = {}) {
  for (const [id, el] of Object.entries(screens)) {
    const active = id === currentScreen;
    el.classList.toggle("active", active);
    el.hidden = !active;
  }
  const hook = onEnter[currentScreen];
  if (hook) hook();
}
