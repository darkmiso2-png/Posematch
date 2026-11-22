import { loadImageFile } from "../../services/cameraService.js";
import { detectPoseOnImage } from "../../services/mediapipeService.js";
import { validateCalibrationName } from "../../services/storageService.js";
import { getState, openCalibrationDraft } from "../../state/store.js";

/**
 * Подключение загрузки фото-референса: кнопка, Drag & Drop и Ctrl+V (paste).
 * @param {{
 *   dropzone: HTMLElement,
 *   fileInput: HTMLInputElement,
 *   btnUpload: HTMLButtonElement,
 *   onBusyChange: (busy: boolean, message?: string) => void,
 *   onNotice: (text: string, tone?: "error" | "info" | "success") => void,
 *   onClearNotice: () => void,
 *   onDone: () => void
 * }} opts
 * @returns {{ triggerFilePicker: () => void, isBusy: () => boolean }}
 */
export function bindHubUpload(opts) {
  const { dropzone, fileInput, btnUpload, onBusyChange, onNotice, onClearNotice, onDone } = opts;

  let processing = false;
  let dragDepth = 0;

  /** @param {Blob | File | null | undefined} file */
  async function handleImageUpload(file) {
    if (!file || processing) return;

    if (file.type && !file.type.startsWith("image/")) {
      const label = "name" in file && file.name ? `«${file.name}»` : "Выбранный файл";
      onNotice(`${label} не является изображением. Выберите JPG, PNG или WebP.`, "error");
      fileInput.value = "";
      return;
    }

    onClearNotice();
    processing = true;
    onBusyChange(true, "Чтение изображения...");

    try {
      const { img, dataUrl, aspect } = await loadImageFile(file);
      onBusyChange(true, "Анализ позы на фото...");
      const detected = await detectPoseOnImage(img);

      if (!detected) {
        const mpStatus = getState().runtime.mpStatus;
        if (mpStatus === "loading") {
          onNotice(
            "Нейросеть ещё загружается. Дождитесь готовности ИИ и повторите загрузку фото.",
            "info"
          );
        } else if (mpStatus === "error") {
          onNotice("Движок ИИ не загружен — не удалось распознать позу на фото.", "error");
        } else {
          onNotice("Человек не найден на фото. Выберите снимок, где фигура видна четче.", "error");
        }
        return;
      }

      const rawName =
        "name" in file && file.name ? file.name.replace(/\.[^.]+$/, "") : "Фото-референс";
      const validated = validateCalibrationName(rawName);
      const safeName = validated.ok ? validated.name : "Фото-референс";

      openCalibrationDraft({
        id: `upload-${Date.now()}`,
        name: safeName,
        source: "upload",
        category: "saved",
        imageDataUrl: dataUrl,
        aspect,
        landmarks: detected,
        autoLandmarks: detected,
        autoDetected: true,
        createdAt: Date.now()
      });
    } catch (err) {
      console.warn("Image upload error:", err);
      onNotice(
        "Не удалось прочитать файл как изображение. Проверьте формат (JPG, PNG, WebP).",
        "error"
      );
    } finally {
      processing = false;
      fileInput.value = "";
      onBusyChange(false);
      onDone();
    }
  }

  function triggerFilePicker() {
    if (!processing) fileInput.click();
  }

  btnUpload.addEventListener("click", triggerFilePicker);

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) handleImageUpload(file);
    else fileInput.value = "";
  });

  dropzone.addEventListener("dragenter", (e) => {
    if (getState().currentScreen !== "hub") return;
    e.preventDefault();
    dragDepth += 1;
    dropzone.classList.add("is-dragover");
  });

  dropzone.addEventListener("dragover", (e) => {
    if (getState().currentScreen !== "hub") return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = processing ? "none" : "copy";
    }
  });

  dropzone.addEventListener("dragleave", (e) => {
    if (getState().currentScreen !== "hub") return;
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove("is-dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    if (getState().currentScreen !== "hub") return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    dropzone.classList.remove("is-dragover");
    if (processing) return;

    const file = e.dataTransfer?.files?.[0];
    if (!file) {
      onNotice("Перетащите файл изображения (JPG, PNG, WebP).", "error");
      return;
    }
    handleImageUpload(file);
  });

  window.addEventListener("dragover", (e) => {
    if (getState().currentScreen === "hub") e.preventDefault();
  });

  window.addEventListener("drop", (e) => {
    if (getState().currentScreen !== "hub") return;
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove("is-dragover");
  });

  window.addEventListener("paste", (e) => {
    if (getState().currentScreen !== "hub") return;
    const target = e.target;
    if (target instanceof HTMLElement && target.closest("input, textarea")) return;
    if (processing) return;

    const items = e.clipboardData?.items;
    const files = e.clipboardData?.files;

    /** @type {File | null} */
    let imageFile = null;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          imageFile = item.getAsFile();
          break;
        }
      }
    }
    if (!imageFile && files && files.length > 0) {
      const candidate = files[0];
      if (candidate.type.startsWith("image/")) {
        imageFile = candidate;
      } else {
        e.preventDefault();
        onNotice(`Файл «${candidate.name}» не является изображением.`, "error");
        return;
      }
    }

    if (imageFile) {
      e.preventDefault();
      handleImageUpload(imageFile);
      return;
    }

    if ((items && items.length > 0) || (files && files.length > 0)) {
      onNotice("В буфере обмена нет картинки. Скопируйте изображение или выберите файл.", "error");
    }
  });

  return {
    triggerFilePicker,
    isBusy: () => processing
  };
}
