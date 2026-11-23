/**
 * Идемпотентный контроллер баннера уведомлений `.app-notice` для экранов приложения.
 * @param {HTMLElement} root
 * @param {string} prefix
 * @param {{ defaultTone?: "info" | "error" | "success", onClear?: () => void }} [options]
 * @returns {{
 *   show: (text: string, tone?: "info" | "error" | "success") => void,
 *   clear: () => void
 * }}
 */
export function createScreenNotice(root, prefix, options = {}) {
  const noticeEl = /** @type {HTMLElement} */ (root.querySelector(`#${prefix}-notice`));
  const textId = `${prefix}-notice-text`;
  const closeId = `${prefix}-notice-close`;

  let noticeText = /** @type {HTMLElement | null} */ (noticeEl.querySelector(`#${textId}`));
  let noticeClose = /** @type {HTMLButtonElement | null} */ (noticeEl.querySelector(`#${closeId}`));

  if (!noticeText || !noticeClose) {
    noticeText = document.createElement("span");
    noticeText.id = textId;
    noticeText.className = "app-notice-text";

    noticeClose = document.createElement("button");
    noticeClose.id = closeId;
    noticeClose.className = "app-notice-close";
    noticeClose.type = "button";
    noticeClose.setAttribute("aria-label", "Закрыть уведомление");
    noticeClose.textContent = "×";

    noticeEl.replaceChildren(noticeText, noticeClose);
  }

  const defaultTone = options.defaultTone || "info";

  /**
   * @param {string} text
   * @param {"info" | "error" | "success"} [tone]
   */
  function show(text, tone = defaultTone) {
    noticeEl.className = `app-notice app-notice--${tone}`;
    /** @type {HTMLElement} */ (noticeText).textContent = text;
    noticeEl.hidden = false;
  }

  function clear() {
    options.onClear?.();
    noticeEl.hidden = true;
    /** @type {HTMLElement} */ (noticeText).textContent = "";
  }

  if (noticeClose.dataset.noticeBound !== "1") {
    noticeClose.dataset.noticeBound = "1";
    noticeClose.addEventListener("click", clear);
  }

  return { show, clear };
}
