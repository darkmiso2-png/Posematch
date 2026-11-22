import { CALIBRATION_NAME_MAX_LENGTH } from "../../services/storageService.js";

/** @type {Record<import("../../core/types.js").PresetCategory, string>} */
const CATEGORY_LABELS = {
  all: "Пресет",
  portrait: "Портрет",
  fullbody: "Рост",
  dynamic: "Динамика",
  saved: "Мои"
};

/**
 * Человекочитаемая метка источника/категории эталона.
 * @param {import("../../core/types.js").PoseReference} ref
 * @returns {string}
 */
export function getReferenceBadgeLabel(ref) {
  if (ref.source === "custom") return "Мои";
  if (ref.source === "recorded") return "Запись 3с";
  if (ref.source === "upload") return "Фото";
  return CATEGORY_LABELS[ref.category] || "Пресет";
}

/**
 * @param {import("../../core/types.js").PresetCategory} activeFilter
 * @param {boolean} isBusy
 * @param {{ onEmptyUpload: () => void, onEmptyRecord: () => void }} handlers
 * @returns {HTMLElement}
 */
function buildEmptyState(activeFilter, isBusy, handlers) {
  const box = document.createElement("div");
  box.className = "hub-empty-state";

  const title = document.createElement("strong");
  title.className = "hub-empty-title";

  const desc = document.createElement("p");
  desc.className = "hub-empty-desc";

  if (activeFilter === "saved") {
    title.textContent = "В «Моих» пока нет сохраненных поз";
    desc.textContent =
      "Загрузите фото-референс или запишите позу с камеры и сохраните калибровку, чтобы она появилась здесь.";
    box.append(title, desc);

    const actions = document.createElement("div");
    actions.className = "hub-empty-actions";

    const btnUpload = document.createElement("button");
    btnUpload.type = "button";
    btnUpload.className = "btn btn-primary";
    btnUpload.textContent = "Загрузить фото";
    btnUpload.disabled = isBusy;
    btnUpload.addEventListener("click", handlers.onEmptyUpload);

    const btnRecord = document.createElement("button");
    btnRecord.type = "button";
    btnRecord.className = "btn";
    btnRecord.textContent = "Запись 3с";
    btnRecord.disabled = isBusy;
    btnRecord.addEventListener("click", handlers.onEmptyRecord);

    actions.append(btnUpload, btnRecord);
    box.appendChild(actions);
    return box;
  }

  title.textContent = "В этой категории пока нет шаблонов";
  desc.textContent = "Выберите фильтр «Все» или загрузите собственный референс.";
  box.append(title, desc);
  return box;
}

/**
 * @param {import("../../core/types.js").PoseReference} ref
 * @param {string} editingError
 * @param {{ onCancelRename: () => void, onSubmitRename: (id: string, name: string) => void }} handlers
 * @returns {HTMLFormElement}
 */
function buildRenameForm(ref, editingError, handlers) {
  const form = document.createElement("form");
  form.className = "hub-rename-form";
  form.addEventListener("click", (ev) => ev.stopPropagation());

  const input = document.createElement("input");
  input.type = "text";
  input.className = "hub-rename-input";
  input.maxLength = CALIBRATION_NAME_MAX_LENGTH;
  input.value = ref.name;
  input.setAttribute("aria-label", "Новое название калибровки");
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      handlers.onCancelRename();
    }
  });
  form.appendChild(input);

  if (editingError) {
    const errEl = document.createElement("span");
    errEl.className = "hub-rename-error";
    errEl.textContent = editingError;
    form.appendChild(errEl);
  }

  const row = document.createElement("div");
  row.className = "hub-card-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "hub-card-btn hub-card-btn--primary";
  saveBtn.textContent = "Сохранить";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "hub-card-btn";
  cancelBtn.textContent = "Отмена";
  cancelBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    handlers.onCancelRename();
  });

  row.append(saveBtn, cancelBtn);
  form.appendChild(row);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    handlers.onSubmitRename(ref.id, input.value);
  });

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });

  return form;
}

/**
 * Безопасный рендер сетки карточек эталонов и Empty State на Экране 1.
 * @param {HTMLElement} container
 * @param {{
 *   items: import("../../core/types.js").PoseReference[],
 *   activeFilter: import("../../core/types.js").PresetCategory,
 *   activeReferenceId: string | null,
 *   editingId: string | null,
 *   editingError: string,
 *   isBusy: boolean,
 *   onSelect: (ref: import("../../core/types.js").PoseReference) => void,
 *   onStartRename: (ref: import("../../core/types.js").PoseReference) => void,
 *   onCancelRename: () => void,
 *   onSubmitRename: (id: string, nextName: string) => void,
 *   onDelete: (id: string) => void,
 *   onEmptyUpload: () => void,
 *   onEmptyRecord: () => void
 * }} params
 * @returns {void}
 */
export function renderHubGrid(container, params) {
  const { items, activeFilter, activeReferenceId, editingId, editingError, isBusy } = params;

  if (items.length === 0) {
    container.replaceChildren(
      buildEmptyState(activeFilter, isBusy, {
        onEmptyUpload: params.onEmptyUpload,
        onEmptyRecord: params.onEmptyRecord
      })
    );
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const ref of items) {
    const isActive = activeReferenceId === ref.id;
    const isEditing = ref.source === "custom" && editingId === ref.id;

    const card = document.createElement("div");
    card.className = `hub-card${isActive ? " is-active" : ""}`;
    card.setAttribute("role", "button");
    card.tabIndex = isEditing ? -1 : 0;
    card.setAttribute("aria-pressed", String(isActive));

    const media = document.createElement("div");
    media.className = "hub-card-media";

    const img = document.createElement("img");
    img.src = ref.imageDataUrl;
    img.alt = ref.name;
    img.loading = "lazy";
    media.appendChild(img);

    const tag = document.createElement("span");
    tag.className = "hub-card-tag";
    tag.textContent = getReferenceBadgeLabel(ref);
    media.appendChild(tag);

    if (isActive) {
      const badge = document.createElement("span");
      badge.className = "hub-card-active-badge";
      badge.textContent = "Активен";
      media.appendChild(badge);
    }

    card.appendChild(media);

    if (isEditing) {
      card.appendChild(
        buildRenameForm(ref, editingError, {
          onCancelRename: params.onCancelRename,
          onSubmitRename: params.onSubmitRename
        })
      );
    } else {
      const title = document.createElement("div");
      title.className = "hub-card-title";
      title.textContent = ref.name;
      card.appendChild(title);

      if (ref.source === "custom") {
        const actions = document.createElement("div");
        actions.className = "hub-card-actions";

        const btnRename = document.createElement("button");
        btnRename.type = "button";
        btnRename.className = "hub-card-btn";
        btnRename.textContent = "Изм. имя";
        btnRename.addEventListener("click", (ev) => {
          ev.stopPropagation();
          params.onStartRename(ref);
        });

        const btnDelete = document.createElement("button");
        btnDelete.type = "button";
        btnDelete.className = "hub-card-btn hub-card-btn--danger";
        btnDelete.textContent = "Удалить";
        btnDelete.addEventListener("click", (ev) => {
          ev.stopPropagation();
          params.onDelete(ref.id);
        });

        actions.append(btnRename, btnDelete);
        card.appendChild(actions);
      }

      card.addEventListener("click", () => params.onSelect(ref));
      card.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          params.onSelect(ref);
        }
      });
    }

    fragment.appendChild(card);
  }

  container.replaceChildren(fragment);
}
