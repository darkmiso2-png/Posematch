import {
  buildShotDownloadFilename,
  formatShotMetadata,
  resolveSelectedShot,
  resolveShotReference
} from "../../core/galleryLogic.js";
import { deleteShot, navigateTo, selectShot, setShowSkeletonOverlay } from "../../state/store.js";
import { createScreenNotice } from "../screenNotice.js";
import {
  createGalleryPaneRenderer,
  dataUrlToBlob,
  mountGalleryEmptyState
} from "./galleryViewHelpers.js";

const PANE_WIDTH = 360;
const PANE_HEIGHT = 480;

/**
 * Экран 4: галерея сессии, Side-by-Side сравнение «Эталон» vs «Ваше фото»,
 * тумблер скелета, лента дублей и скачивание чистого JPG.
 * @param {HTMLElement} root
 * @returns {{ render: (state: import("../../core/types.js").AppState) => void, clearNotice: () => void }}
 */
export function createGalleryScreen(root) {
  const contentBox = /** @type {HTMLElement} */ (root.querySelector("#gal-content"));
  const emptyBox = /** @type {HTMLElement} */ (root.querySelector("#gal-empty"));
  const btnEmptyCamera = mountGalleryEmptyState(emptyBox);
  const metaPoseEl = /** @type {HTMLElement} */ (root.querySelector("#gal-meta-pose"));
  const metaSubEl = /** @type {HTMLElement} */ (root.querySelector("#gal-meta-sub"));
  const shotScoreEl = /** @type {HTMLElement} */ (root.querySelector("#gal-shot-score"));
  const refNoteEl = /** @type {HTMLElement} */ (root.querySelector("#gal-ref-note"));
  const shotNoteEl = /** @type {HTMLElement} */ (root.querySelector("#gal-shot-note"));
  const refCanvas = /** @type {HTMLCanvasElement} */ (root.querySelector("#gal-ref-canvas"));
  const refCtx = /** @type {CanvasRenderingContext2D} */ (refCanvas.getContext("2d"));
  const shotCanvas = /** @type {HTMLCanvasElement} */ (root.querySelector("#gal-shot-canvas"));
  const shotCtx = /** @type {CanvasRenderingContext2D} */ (shotCanvas.getContext("2d"));
  const toggleSkel = /** @type {HTMLButtonElement} */ (root.querySelector("#gal-toggle-skel"));
  const btnDownload = /** @type {HTMLButtonElement} */ (root.querySelector("#gal-btn-download"));
  const btnDelete = /** @type {HTMLButtonElement} */ (root.querySelector("#gal-btn-delete"));
  const stripCountEl = /** @type {HTMLElement} */ (root.querySelector("#gal-strip-count"));
  const strip = /** @type {HTMLElement} */ (root.querySelector("#gal-strip"));

  refCanvas.width = PANE_WIDTH;
  refCanvas.height = PANE_HEIGHT;
  shotCanvas.width = PANE_WIDTH;
  shotCanvas.height = PANE_HEIGHT;

  /** @type {import("../../core/types.js").CapturedShot | null} */
  let currentShot = null;
  let currentRefName = "Эталон";
  /** @type {string | null} */
  let lastRenderedShotId = null;
  let preserveDeleteNotice = false;
  let activeDownloadUrl = "";
  let downloadRevokeTimer = 0;
  const drawPane = createGalleryPaneRenderer();

  function revokeActiveDownloadUrl() {
    if (downloadRevokeTimer) {
      window.clearTimeout(downloadRevokeTimer);
      downloadRevokeTimer = 0;
    }
    if (activeDownloadUrl) {
      URL.revokeObjectURL(activeDownloadUrl);
      activeDownloadUrl = "";
    }
  }
  window.addEventListener("pagehide", revokeActiveDownloadUrl);

  const { show: showNotice, clear: clearNotice } = createScreenNotice(root, "gal", {
    defaultTone: "info",
    onClear: () => {
      preserveDeleteNotice = false;
    }
  });
  root.querySelector("#gal-btn-camera")?.addEventListener("click", () => navigateTo("camera"));
  btnEmptyCamera.addEventListener("click", () => navigateTo("camera"));
  root.querySelector("#gal-btn-hub")?.addEventListener("click", () => navigateTo("hub"));

  toggleSkel.addEventListener("click", () => {
    setShowSkeletonOverlay(toggleSkel.dataset.active !== "true");
  });

  btnDelete.addEventListener("click", () => {
    if (!currentShot) return;
    const deletedId = currentShot.id;
    preserveDeleteNotice = true;
    if (deleteShot(deletedId)) {
      showNotice("Дубль удалён", "info");
    } else {
      preserveDeleteNotice = false;
      showNotice("Не удалось удалить выбранный дубль.", "error");
    }
  });

  btnDownload.addEventListener("click", () => {
    if (!currentShot || !currentShot.imageDataUrl) {
      showNotice("Нет изображения для скачивания.", "error");
      return;
    }

    const filename = buildShotDownloadFilename(currentShot, currentRefName);
    const blob = dataUrlToBlob(currentShot.imageDataUrl);
    if (!blob && !currentShot.imageDataUrl.startsWith("data:image/")) {
      showNotice("Некорректный формат изображения для скачивания.", "error");
      return;
    }

    revokeActiveDownloadUrl();
    const objectUrl = blob ? URL.createObjectURL(blob) : "";
    const href = objectUrl || currentShot.imageDataUrl;
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();

    if (objectUrl) {
      activeDownloadUrl = objectUrl;
      downloadRevokeTimer = window.setTimeout(revokeActiveDownloadUrl, 60_000);
    }
    showNotice(`Файл ${filename} скачан`, "info");
  });

  /**
   * @param {import("../../core/types.js").CapturedShot[]} shots
   * @param {string | null} activeId
   */
  function renderFilmstrip(shots, activeId) {
    stripCountEl.textContent = `${shots.length}`;
    const fragment = document.createDocumentFragment();

    for (const shot of shots) {
      const isActive = activeId === shot.id;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `shot-thumb${isActive ? " active" : ""}`;
      btn.setAttribute("aria-label", `Дубль, совпадение ${shot.score}%`);
      if (isActive) {
        btn.setAttribute("aria-current", "true");
      }

      const img = document.createElement("img");
      img.src = shot.imageDataUrl;
      img.alt = `Снимок ${shot.score}%`;
      img.loading = "lazy";

      const badge = document.createElement("span");
      badge.className = "shot-thumb-badge";
      badge.textContent = `${Math.round(shot.score)}%`;

      btn.append(img, badge);
      btn.addEventListener("click", () => selectShot(shot.id));
      fragment.appendChild(btn);
    }

    strip.replaceChildren(fragment);
  }

  /** @param {import("../../core/types.js").AppState} state */
  function render(state) {
    toggleSkel.dataset.active = String(state.showSkeletonOverlay);
    toggleSkel.setAttribute("aria-pressed", String(state.showSkeletonOverlay));
    toggleSkel.classList.toggle("active-cyan", state.showSkeletonOverlay);

    currentShot = resolveSelectedShot(state.shots, state.selectedShotId);
    const nextShotId = currentShot ? currentShot.id : null;
    if (lastRenderedShotId !== null && lastRenderedShotId !== nextShotId) {
      if (preserveDeleteNotice) {
        preserveDeleteNotice = false;
      } else {
        clearNotice();
      }
    }
    lastRenderedShotId = nextShotId;

    if (!currentShot) {
      currentRefName = "Эталон";
      contentBox.hidden = true;
      emptyBox.hidden = false;
      btnDownload.disabled = true;
      btnDelete.disabled = true;
      refCtx.clearRect(0, 0, refCanvas.width, refCanvas.height);
      shotCtx.clearRect(0, 0, shotCanvas.width, shotCanvas.height);
      stripCountEl.textContent = "0";
      strip.replaceChildren();
      return;
    }

    contentBox.hidden = false;
    emptyBox.hidden = true;
    btnDownload.disabled = false;
    btnDelete.disabled = false;

    const resolvedRef = resolveShotReference(
      currentShot,
      state.presets,
      state.savedCalibrations,
      state.activeReference,
      state.settings.mirrorRef
    );
    currentRefName = resolvedRef.name;

    const meta = formatShotMetadata(currentShot, state.shots, resolvedRef.name);
    metaPoseEl.textContent = meta.referenceName;
    metaSubEl.textContent = `${meta.takeLabel} • ${meta.timeLabel}`;
    shotScoreEl.textContent = `${meta.score}%`;
    refNoteEl.textContent = resolvedRef.mirrorImage ? "Зеркало" : "";
    shotNoteEl.textContent = meta.hasUserSkeleton ? "" : "Скелет не найден";

    drawPane(
      "ref",
      refCanvas,
      refCtx,
      resolvedRef.imageDataUrl,
      resolvedRef.landmarks,
      resolvedRef.mirrorImage,
      state.showSkeletonOverlay,
      "#00e5ff"
    );

    drawPane(
      "shot",
      shotCanvas,
      shotCtx,
      currentShot.imageDataUrl,
      currentShot.userLandmarks,
      false,
      state.showSkeletonOverlay,
      "#00e676"
    );

    renderFilmstrip(state.shots, currentShot.id);
  }

  return { render, clearNotice };
}
