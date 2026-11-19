import { createDefaultSkeleton } from "../../core/poseMath.js";
import { loadImageFile } from "../../services/cameraService.js";
import { detectPoseOnImage } from "../../services/mediapipeService.js";
import {
  deleteSavedCalibration,
  getState,
  navigateTo,
  openCalibrationDraft,
  setActiveFilter,
  setActiveReference
} from "../../state/store.js";

/**
 * @param {HTMLElement} root
 * @param {{ onStartRecordPose: () => void }} actions
 * @returns {{ render: (state: import("../../core/types.js").AppState) => void }}
 */
export function createHubScreen(root, actions) {
  const filterRow = /** @type {HTMLElement} */ (root.querySelector("#hub-filter-row"));
  const presetGrid = /** @type {HTMLElement} */ (root.querySelector("#hub-preset-grid"));
  const fileInput = /** @type {HTMLInputElement} */ (root.querySelector("#hub-file-input"));
  const btnUpload = /** @type {HTMLButtonElement} */ (root.querySelector("#hub-btn-upload"));
  const btnRecord = /** @type {HTMLButtonElement} */ (root.querySelector("#hub-btn-record"));
  const btnShoot = /** @type {HTMLButtonElement} */ (root.querySelector("#hub-btn-shoot"));
  const btnCalib = /** @type {HTMLButtonElement} */ (root.querySelector("#hub-btn-calib"));
  const btnGallery = /** @type {HTMLButtonElement} */ (root.querySelector("#hub-btn-gallery"));
  const galleryBadge = /** @type {HTMLElement} */ (root.querySelector("#hub-gallery-count"));

  /** @param {Blob | File | null | undefined} file */
  async function handleImageUpload(file) {
    if (!file) return;
    try {
      const { img, dataUrl, aspect } = await loadImageFile(file);
      const detected = await detectPoseOnImage(img);
      const initial = detected || createDefaultSkeleton();
      const name =
        "name" in file && file.name ? file.name.replace(/\.[^.]+$/, "") : "Фото-референс";
      openCalibrationDraft({
        id: `upload-${Date.now()}`,
        name,
        source: "upload",
        category: "saved",
        imageDataUrl: dataUrl,
        aspect,
        landmarks: initial,
        autoLandmarks: initial,
        autoDetected: Boolean(detected),
        createdAt: Date.now()
      });
    } catch (err) {
      console.warn("Image upload error:", err);
    }
  }

  btnUpload.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    handleImageUpload(fileInput.files?.[0]);
    fileInput.value = "";
  });

  window.addEventListener("paste", (e) => {
    if (getState().currentScreen !== "hub") return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        handleImageUpload(item.getAsFile());
        break;
      }
    }
  });

  filterRow.addEventListener("click", (e) => {
    const btn = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (e.target).closest("[data-filter]")
    );
    if (!btn) return;
    const filter = /** @type {import("../../core/types.js").PresetCategory} */ (
      btn.dataset.filter || "all"
    );
    setActiveFilter(filter);
  });

  btnRecord.addEventListener("click", () => {
    navigateTo("camera");
    actions.onStartRecordPose();
  });
  btnShoot.addEventListener("click", () => navigateTo("camera"));
  btnCalib.addEventListener("click", () => {
    const active = getState().activeReference;
    if (active) openCalibrationDraft(active);
  });
  btnGallery.addEventListener("click", () => navigateTo("gallery"));

  /** @param {import("../../core/types.js").AppState} state */
  function render(state) {
    galleryBadge.textContent = String(state.shots.length);

    filterRow.querySelectorAll("[data-filter]").forEach((el) => {
      const btn = /** @type {HTMLElement} */ (el);
      btn.classList.toggle("active-cyan", btn.dataset.filter === state.activeFilter);
    });

    const combined =
      state.activeFilter === "saved"
        ? state.savedCalibrations
        : state.activeFilter === "all"
          ? [...state.savedCalibrations, ...state.presets]
          : state.presets.filter((p) => p.category === state.activeFilter);

    presetGrid.innerHTML = "";
    if (combined.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted-note";
      empty.textContent = "В этой категории пока нет шаблонов.";
      presetGrid.appendChild(empty);
      return;
    }

    for (const ref of combined) {
      const card = document.createElement("div");
      card.className = `preset-card${state.activeReference?.id === ref.id ? " active" : ""}`;
      const img = document.createElement("img");
      img.src = ref.imageDataUrl;
      img.alt = ref.name;
      const title = document.createElement("span");
      title.textContent = ref.name;
      card.append(img, title);

      if (ref.source === "custom") {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn-ghost";
        del.textContent = "Удалить";
        del.addEventListener("click", (ev) => {
          ev.stopPropagation();
          deleteSavedCalibration(ref.id);
        });
        card.appendChild(del);
      }

      card.addEventListener("click", () => setActiveReference(ref));
      presetGrid.appendChild(card);
    }
  }

  return { render };
}
