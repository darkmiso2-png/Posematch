import { GALLERY_MAX_SHOTS } from "./constants.js";
import { clamp } from "./poseMath.js";

/** @type {Record<string, string>} */
const CYRILLIC_MAP = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya"
};

/**
 * @typedef {Object} ResolvedShotReference
 * @property {string} name
 * @property {string | null} imageDataUrl
 * @property {import("./types.js").JointPoint[] | null} landmarks
 * @property {boolean} mirrorImage
 */

/**
 * @typedef {Object} ShotMetadataView
 * @property {string} referenceName
 * @property {number} score
 * @property {string} scoreLabel
 * @property {string} takeLabel
 * @property {string} timeLabel
 * @property {boolean} hasUserSkeleton
 */

/**
 * Нормализация выбранного снимка в сессии:
 * если selectedShotId валиден — возвращает его, иначе первый снимок, или null для пустой ленты.
 * @param {import("./types.js").CapturedShot[]} shots
 * @param {string | null} selectedShotId
 * @returns {import("./types.js").CapturedShot | null}
 */
export function resolveSelectedShot(shots, selectedShotId) {
  if (!Array.isArray(shots) || shots.length === 0) return null;
  if (selectedShotId) {
    const found = shots.find((shot) => shot.id === selectedShotId);
    if (found) return found;
  }
  return shots[0];
}

/**
 * Возвращает URL изображения кадра с приоритетом ObjectURL и обратной совместимостью с Data URL.
 * @param {import("./types.js").CapturedShot | null | undefined} shot
 * @returns {string}
 */
export function getShotImageSrc(shot) {
  if (!shot) return "";
  if (typeof shot.imageUrl === "string" && shot.imageUrl) return shot.imageUrl;
  if (typeof shot.imageDataUrl === "string" && shot.imageDataUrl) return shot.imageDataUrl;
  return "";
}

/**
 * Добавляет новый кадр в начало ленты с соблюдением LRU-лимита (вытесняет самые старые).
 * @param {import("./types.js").CapturedShot[]} shots
 * @param {import("./types.js").CapturedShot} newShot
 * @param {number} [maxShots]
 * @returns {{ shots: import("./types.js").CapturedShot[], evicted: import("./types.js").CapturedShot[] }}
 */
export function appendShotWithLruLimit(shots, newShot, maxShots = GALLERY_MAX_SHOTS) {
  const limit = Number.isFinite(maxShots) ? Math.max(1, Math.floor(maxShots)) : GALLERY_MAX_SHOTS;
  const list = Array.isArray(shots) ? shots.filter((item) => item.id !== newShot.id) : [];
  const next = [newShot, ...list];
  if (next.length <= limit) {
    return { shots: next, evicted: [] };
  }
  return {
    shots: next.slice(0, limit),
    evicted: next.slice(limit)
  };
}

/**
 * Удаление снимка и предсказуемый выбор соседнего валидного дубля.
 * @param {import("./types.js").CapturedShot[]} shots
 * @param {string} targetId
 * @param {string | null} currentSelectedId
 * @returns {{
 *   shots: import("./types.js").CapturedShot[],
 *   selectedShotId: string | null,
 *   removed: boolean,
 *   removedShot: import("./types.js").CapturedShot | null
 * }}
 */
export function removeShotAndResolveSelection(shots, targetId, currentSelectedId) {
  const removeIdx = shots.findIndex((shot) => shot.id === targetId);
  if (removeIdx < 0) {
    const resolved = resolveSelectedShot(shots, currentSelectedId);
    return {
      shots,
      selectedShotId: resolved ? resolved.id : null,
      removed: false,
      removedShot: null
    };
  }

  const removedShot = shots[removeIdx];
  const nextShots = shots.filter((shot) => shot.id !== targetId);
  if (nextShots.length === 0) {
    return { shots: [], selectedShotId: null, removed: true, removedShot };
  }

  if (currentSelectedId && currentSelectedId !== targetId) {
    const preserved = nextShots.find((shot) => shot.id === currentSelectedId);
    if (preserved) {
      return { shots: nextShots, selectedShotId: preserved.id, removed: true, removedShot };
    }
  }

  const fallbackIdx = Math.min(removeIdx, nextShots.length - 1);
  return {
    shots: nextShots,
    selectedShotId: nextShots[fallbackIdx].id,
    removed: true,
    removedShot
  };
}

/**
 * Определение эталона (изображения, названия, флага зеркала и скелета) для выбранного снимка.
 * Приоритет: снимок эталона внутри CapturedShot -> поиск по referenceId -> activeReference.
 * @param {import("./types.js").CapturedShot} shot
 * @param {import("./types.js").PoseReference[]} presets
 * @param {import("./types.js").PoseReference[]} savedCalibrations
 * @param {import("./types.js").PoseReference | null} activeReference
 * @param {boolean} currentMirrorRef
 * @returns {ResolvedShotReference}
 */
export function resolveShotReference(
  shot,
  presets,
  savedCalibrations,
  activeReference,
  currentMirrorRef
) {
  const matched =
    savedCalibrations.find((ref) => ref.id === shot.referenceId) ||
    presets.find((ref) => ref.id === shot.referenceId) ||
    (activeReference && activeReference.id === shot.referenceId ? activeReference : null);

  const name =
    typeof shot.referenceName === "string" && shot.referenceName.trim()
      ? shot.referenceName.trim()
      : matched?.name || activeReference?.name || "Эталон";

  const imageDataUrl =
    typeof shot.referenceImageDataUrl === "string" && shot.referenceImageDataUrl
      ? shot.referenceImageDataUrl
      : matched?.imageDataUrl || activeReference?.imageDataUrl || null;

  const mirrorImage =
    typeof shot.refMirrored === "boolean" ? shot.refMirrored : Boolean(currentMirrorRef);

  return {
    name,
    imageDataUrl,
    landmarks: shot.refLandmarks || null,
    mirrorImage
  };
}

/**
 * Санитизация имени позы в безопасный ASCII-slug для имени файла.
 * @param {string | null | undefined} rawName
 * @returns {string}
 */
export function sanitizeFilenameSegment(rawName) {
  const input = typeof rawName === "string" ? rawName.trim().toLowerCase() : "";
  if (!input) return "pose";

  let transliterated = "";
  for (const ch of input) {
    if (Object.prototype.hasOwnProperty.call(CYRILLIC_MAP, ch)) {
      transliterated += CYRILLIC_MAP[ch];
    } else {
      transliterated += ch;
    }
  }

  const slug = transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");

  return slug || "pose";
}

/**
 * Формирование безопасного имени JPG-файла для скачивания снимка.
 * @param {import("./types.js").CapturedShot} shot
 * @param {string | null | undefined} referenceName
 * @returns {string}
 */
export function buildShotDownloadFilename(shot, referenceName) {
  const safeName = sanitizeFilenameSegment(referenceName || shot.referenceName);
  const rawScore = Number.isFinite(shot.score) ? Math.round(shot.score) : 0;
  const safeScore = clamp(rawScore, 0, 100);
  const safeTs =
    Number.isFinite(shot.createdAt) && shot.createdAt > 0 ? Math.floor(shot.createdAt) : Date.now();
  return `posematch-${safeName}-${safeScore}pct-${safeTs}.jpg`;
}

/**
 * Форматирование времени съемки HH:MM:SS без зависимости от локального формата дат.
 * @param {number} timestampMs
 * @returns {string}
 */
function formatShotTime(timestampMs) {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "--:--";
  const d = new Date(timestampMs);
  if (Number.isNaN(d.getTime())) return "--:--";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Подготовка безопасных метаданных выбранного снимка для шапки/панели Галереи.
 * @param {import("./types.js").CapturedShot} shot
 * @param {import("./types.js").CapturedShot[]} allShots
 * @param {string} referenceName
 * @returns {ShotMetadataView}
 */
export function formatShotMetadata(shot, allShots, referenceName) {
  const total = allShots.length;
  const idx = allShots.findIndex((item) => item.id === shot.id);
  const takeNumber = idx >= 0 ? Math.max(1, total - idx) : 1;
  const rawScore = Number.isFinite(shot.score) ? Math.round(shot.score) : 0;
  const score = clamp(rawScore, 0, 100);
  const hasUserSkeleton = Array.isArray(shot.userLandmarks) && shot.userLandmarks.length > 0;

  return {
    referenceName: referenceName.trim() || "Эталон",
    score,
    scoreLabel: `Совпадение: ${score}%`,
    takeLabel: `Дубль ${takeNumber} из ${Math.max(1, total)}`,
    timeLabel: formatShotTime(shot.createdAt),
    hasUserSkeleton
  };
}
