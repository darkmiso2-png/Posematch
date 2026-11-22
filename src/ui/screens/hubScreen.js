import {
  deleteSavedCalibration,
  getState,
  navigateTo,
  openCalibrationDraft,
  renameSavedCalibration,
  setActiveFilter,
  setActiveReference
} from "../../state/store.js";
import { getReferenceBadgeLabel, renderHubGrid } from "./hubCards.js";
import { bindHubUpload } from "./hubUpload.js";

/**
 * Экран 1: Главный хаб (загрузка референса, Drag & Drop, фильтры, «Мои калибровки»).
 * @param {HTMLElement} root
 * @param {{ onStartRecordPose: () => void }} actions
 * @returns {{ render: (state: import("../../core/types.js").AppState) => void }}
 */
export function createHubScreen(root, actions) {
  const noticeEl = /** @type {HTMLElement} */ (root.querySelector("#hub-notice"));
  const noticeText = /** @type {HTMLElement} */ (root.querySelector("#hub-notice-text"));
  const noticeClose = /** @type {HTMLButtonElement} */ (root.querySelector("#hub-notice-close"));
  const dropzone = /** @type {HTMLElement} */ (root.querySelector("#hub-dropzone"));
  const uploadStatusEl = /** @type {HTMLElement} */ (root.querySelector("#hub-upload-status"));
  const uploadStatusText = /** @type {HTMLElement} */ (
    root.querySelector("#hub-upload-status-text")
  );
  const fileInput = /** @type {HTMLInputElement} */ (root.querySelector("#hub-file-input"));
  const btnUpload = /** @type {HTMLButtonElement} */ (root.querySelector("#hub-btn-upload"));
  const btnRecord = /** @type {HTMLButtonElement} */ (root.querySelector("#hub-btn-record"));
  const activeThumb = /** @type {HTMLImageElement} */ (root.querySelector("#hub-active-thumb"));
  const activeName = /** @type {HTMLElement} */ (root.querySelector("#hub-active-name"));
  const activeBadge = /** @type {HTMLElement} */ (root.querySelector("#hub-active-badge"));
  const btnShoot = /** @type {HTMLButtonElement} */ (root.querySelector("#hub-btn-shoot"));
  const btnCalib = /** @type {HTMLButtonElement} */ (root.querySelector("#hub-btn-calib"));
  const btnGallery = /** @type {HTMLButtonElement} */ (root.querySelector("#hub-btn-gallery"));
  const galleryBadge = /** @type {HTMLElement} */ (root.querySelector("#hub-gallery-count"));
  const filterRow = /** @type {HTMLElement} */ (root.querySelector("#hub-filter-row"));
  const savedCountEl = /** @type {HTMLElement} */ (root.querySelector("#hub-saved-count"));
  const presetGrid = /** @type {HTMLElement} */ (root.querySelector("#hub-preset-grid"));

  /** @type {string | null} */
  let editingId = null;
  let editingError = "";

  /**
   * @param {string} text
   * @param {"error" | "info" | "success"} [tone]
   */
  function showNotice(text, tone = "error") {
    noticeEl.className = `hub-notice hub-notice--${tone}`;
    noticeText.textContent = text;
    noticeEl.hidden = false;
  }

  function clearNotice() {
    noticeEl.hidden = true;
    noticeText.textContent = "";
  }

  /**
   * @param {boolean} busy
   * @param {string} [message]
   */
  function applyBusyUI(busy, message = "Анализ позы на фото...") {
    dropzone.classList.toggle("is-processing", busy);
    dropzone.setAttribute("aria-busy", String(busy));
    uploadStatusEl.hidden = !busy;
    uploadStatusText.textContent = message;
    btnUpload.disabled = busy;
    btnRecord.disabled = busy;
    const hasRef = Boolean(getState().activeReference);
    btnShoot.disabled = busy || !hasRef;
    btnCalib.disabled = busy || !hasRef;
  }

  const uploader = bindHubUpload({
    dropzone,
    fileInput,
    btnUpload,
    onBusyChange: applyBusyUI,
    onNotice: showNotice,
    onClearNotice: clearNotice,
    onDone: () => render(getState())
  });

  noticeClose.addEventListener("click", clearNotice);

  filterRow.addEventListener("click", (e) => {
    const btn = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (e.target).closest("[data-filter]")
    );
    if (!btn) return;
    const filter = /** @type {import("../../core/types.js").PresetCategory} */ (
      btn.dataset.filter || "all"
    );
    editingId = null;
    editingError = "";
    setActiveFilter(filter);
  });

  function startRecordPose() {
    if (uploader.isBusy()) return;
    navigateTo("camera");
    actions.onStartRecordPose();
  }

  btnRecord.addEventListener("click", startRecordPose);
  btnShoot.addEventListener("click", () => {
    if (!uploader.isBusy() && getState().activeReference) navigateTo("camera");
  });
  btnCalib.addEventListener("click", () => {
    if (uploader.isBusy()) return;
    const active = getState().activeReference;
    if (active) openCalibrationDraft(active);
  });
  btnGallery.addEventListener("click", () => navigateTo("gallery"));

  /** @param {import("../../core/types.js").AppState} state */
  function render(state) {
    const busy = uploader.isBusy();
    galleryBadge.textContent = String(state.shots.length);
    galleryBadge.classList.toggle("has-shots", state.shots.length > 0);
    savedCountEl.textContent = String(state.savedCalibrations.length);

    if (state.activeReference) {
      activeThumb.src = state.activeReference.imageDataUrl;
      activeThumb.hidden = false;
      activeName.textContent = state.activeReference.name;
      activeBadge.textContent = getReferenceBadgeLabel(state.activeReference);
      activeBadge.hidden = false;
    } else {
      activeThumb.removeAttribute("src");
      activeThumb.hidden = true;
      activeName.textContent = "Эталон не выбран";
      activeBadge.hidden = true;
    }

    btnShoot.disabled = busy || !state.activeReference;
    btnCalib.disabled = busy || !state.activeReference;

    filterRow.querySelectorAll("[data-filter]").forEach((el) => {
      const btn = /** @type {HTMLElement} */ (el);
      const isSelected = btn.dataset.filter === state.activeFilter;
      btn.classList.toggle("is-active", isSelected);
      btn.setAttribute("aria-pressed", String(isSelected));
    });

    const combined =
      state.activeFilter === "saved"
        ? state.savedCalibrations
        : state.activeFilter === "all"
          ? [...state.savedCalibrations, ...state.presets]
          : state.presets.filter((p) => p.category === state.activeFilter);

    renderHubGrid(presetGrid, {
      items: combined,
      activeFilter: state.activeFilter,
      activeReferenceId: state.activeReference?.id || null,
      editingId,
      editingError,
      isBusy: busy,
      onSelect: (ref) => {
        editingId = null;
        editingError = "";
        setActiveReference(ref);
      },
      onStartRename: (ref) => {
        editingId = ref.id;
        editingError = "";
        clearNotice();
        render(getState());
      },
      onCancelRename: () => {
        editingId = null;
        editingError = "";
        render(getState());
      },
      onSubmitRename: (id, nextName) => {
        const res = renameSavedCalibration(id, nextName);
        if (!res.ok) {
          editingError = res.error;
          if (res.error.includes("localStorage")) {
            showNotice(res.error, "error");
          }
          render(getState());
          return;
        }
        editingId = null;
        editingError = "";
        showNotice(`Калибровка переименована в «${res.name}».`, "success");
      },
      onDelete: (id) => {
        const wasActive = getState().activeReference?.id === id;
        const res = deleteSavedCalibration(id);
        if (!res.ok) {
          showNotice(res.error, "error");
          return;
        }
        if (editingId === id) {
          editingId = null;
          editingError = "";
        }
        if (wasActive) {
          showNotice("Активная калибровка удалена — выбран пресет по умолчанию.", "info");
        }
      },
      onEmptyUpload: () => uploader.triggerFilePicker(),
      onEmptyRecord: startRecordPose
    });
  }

  return { render };
}
