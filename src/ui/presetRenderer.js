import { cloneLandmarks } from "../core/poseMath.js";
import { PRESET_DEFINITIONS } from "../core/presetData.js";

/**
 * Генерация стилизованного изображения-превью для встроенного пресета.
 * @param {import("../core/types.js").PresetDefinition} preset
 * @returns {string}
 */
function renderPresetDataUrl(preset) {
  if (typeof document === "undefined") return "";
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 640;
  const g = c.getContext("2d");
  if (!g) return "";

  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, "#121826");
  grad.addColorStop(1, "#0a0d14");
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);

  g.strokeStyle = "rgba(255,255,255,0.04)";
  g.lineWidth = 1;
  for (let x = 40; x < c.width; x += 40) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, c.height);
    g.stroke();
  }
  for (let y = 40; y < c.height; y += 40) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(c.width, y);
    g.stroke();
  }

  const lms = preset.landmarks;
  /** @param {number} i */
  const px = (i) => ({ x: lms[i].x * c.width, y: lms[i].y * c.height });

  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = "rgba(255,255,255,0.16)";
  g.fillStyle = "rgba(255,255,255,0.12)";

  g.beginPath();
  g.moveTo(px(11).x, px(11).y);
  g.lineTo(px(12).x, px(12).y);
  g.lineTo(px(24).x, px(24).y);
  g.lineTo(px(23).x, px(23).y);
  g.closePath();
  g.fill();

  const limbs = [
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [23, 25],
    [25, 27],
    [24, 26],
    [26, 28]
  ];
  g.lineWidth = 22;
  for (const [a, b] of limbs) {
    g.beginPath();
    g.moveTo(px(a).x, px(a).y);
    g.lineTo(px(b).x, px(b).y);
    g.stroke();
  }

  g.beginPath();
  g.arc(px(0).x, px(0).y, 34, 0, Math.PI * 2);
  g.fill();
  g.restore();

  g.fillStyle = preset.accent;
  g.font = "700 18px Inter, Segoe UI, sans-serif";
  g.fillText(preset.name.toUpperCase(), 20, 34);

  return c.toDataURL("image/png");
}

/**
 * Создание списка PoseReference из встроенных пресетов.
 * @returns {import("../core/types.js").PoseReference[]}
 */
export function buildInitialPresets() {
  const now = Date.now();
  return PRESET_DEFINITIONS.map((def) => ({
    id: def.id,
    name: def.name,
    source: "preset",
    category: def.category,
    imageDataUrl: renderPresetDataUrl(def),
    aspect: 480 / 640,
    landmarks: cloneLandmarks(def.landmarks),
    autoLandmarks: cloneLandmarks(def.landmarks),
    autoDetected: true,
    createdAt: now
  }));
}
