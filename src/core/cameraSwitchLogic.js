import { inferFacingModeFromDevice } from "./cameraHudLogic.js";

/**
 * @typedef {"user" | "environment"} CameraFacing
 *
 * @typedef {Object} CameraSwitchTarget
 * @property {string} deviceId
 * @property {CameraFacing} targetFacing
 *
 * @typedef {Object} CameraSwitchCopy
 * @property {string} ariaLabel
 * @property {string} title
 */

/**
 * Возвращает противоположное направление камеры.
 * @param {CameraFacing} facing
 * @returns {CameraFacing}
 */
function getOppositeFacing(facing) {
  return facing === "environment" ? "user" : "environment";
}

/**
 * Определяет текущее направление для устройства или активной камеры.
 * @param {{ deviceId?: string, label?: string } | null | undefined} device
 * @param {string} activeDeviceId
 * @param {string} activeFacingMode
 * @returns {CameraFacing | null}
 */
export function resolveDeviceFacing(device, activeDeviceId = "", activeFacingMode = "") {
  if (
    device &&
    device.deviceId &&
    device.deviceId === activeDeviceId &&
    (activeFacingMode === "user" || activeFacingMode === "environment")
  ) {
    return activeFacingMode;
  }
  return inferFacingModeFromDevice(device?.deviceId || "", device?.label || "");
}

/**
 * Выбирает целевую камеру для быстрого переключения «Передняя / Задняя».
 * Работает даже при пустых device.label (циклический выбор + targetFacing).
 * @param {Array<{ deviceId: string, label?: string }>} devices
 * @param {string} currentDeviceId
 * @param {string} [currentFacing]
 * @returns {CameraSwitchTarget | null}
 */
export function resolveNextCameraTarget(devices, currentDeviceId, currentFacing = "") {
  if (!Array.isArray(devices) || devices.length < 2) return null;

  const currentIdx = devices.findIndex((d) => d.deviceId === currentDeviceId);
  const currentDevice = currentIdx >= 0 ? devices[currentIdx] : null;
  const knownFacing =
    currentFacing === "user" || currentFacing === "environment"
      ? currentFacing
      : inferFacingModeFromDevice(
          currentDevice?.deviceId || currentDeviceId,
          currentDevice?.label
        ) || "user";

  const targetFacing = getOppositeFacing(knownFacing);

  const facingMatch = devices.find(
    (d) =>
      d.deviceId !== currentDeviceId &&
      inferFacingModeFromDevice(d.deviceId, d.label || "") === targetFacing
  );
  if (facingMatch) {
    return { deviceId: facingMatch.deviceId, targetFacing };
  }

  if (currentIdx >= 0) {
    const next = devices[(currentIdx + 1) % devices.length];
    return { deviceId: next.deviceId, targetFacing };
  }

  const fallback = devices.find((d) => d.deviceId !== currentDeviceId) || devices[1];
  return { deviceId: fallback.deviceId, targetFacing };
}

/**
 * Тексты доступности (aria-label / title) для кнопки переключения камер
 * строго с формулировками «Передняя» / «Задняя».
 * @param {string} currentFacing
 * @param {boolean} canSwitch
 * @param {boolean} isSwitching
 * @returns {CameraSwitchCopy}
 */
export function getSwitchCameraCopy(currentFacing, canSwitch, isSwitching) {
  if (!canSwitch) {
    return {
      ariaLabel: "Переключение передней и задней камеры недоступно",
      title: "Доступна только одна камера"
    };
  }
  if (isSwitching) {
    return {
      ariaLabel: "Переключение камеры...",
      title: "Переключение камеры..."
    };
  }
  const normalized = currentFacing === "environment" ? "environment" : "user";
  const targetFacing = getOppositeFacing(normalized);
  const targetLabel = targetFacing === "environment" ? "Задняя камера" : "Передняя камера";
  const currentLabel = normalized === "environment" ? "Задняя" : "Передняя";
  return {
    ariaLabel: `Переключить камеру (${targetLabel}, сейчас: ${currentLabel})`,
    title: targetLabel
  };
}

/**
 * Подпись камеры для выпадающего списка <select> без «Фронт / Тыл».
 * @param {{ deviceId: string, label?: string }} device
 * @param {number} index
 * @param {string} activeDeviceId
 * @param {string} activeFacingMode
 * @returns {string}
 */
export function formatCameraOptionLabel(device, index, activeDeviceId = "", activeFacingMode = "") {
  if (device.label && device.label.trim()) return device.label.trim();
  const facing = resolveDeviceFacing(device, activeDeviceId, activeFacingMode);
  if (facing === "environment") return `Задняя камера (${index + 1})`;
  if (facing === "user") return `Передняя камера (${index + 1})`;
  return `Камера ${index + 1}`;
}

/**
 * Сообщение об ошибке переключения камеры для .app-notice--error.
 * @param {string} targetFacing
 * @param {string | null | undefined} reason
 * @returns {string}
 */
export function formatCameraSwitchError(targetFacing, reason) {
  const targetLabel = targetFacing === "environment" ? "Задняя камера" : "Передняя камера";
  const suffix = reason ? `: ${reason}` : ".";
  return `Не удалось переключить камеру (${targetLabel})${suffix}`;
}
