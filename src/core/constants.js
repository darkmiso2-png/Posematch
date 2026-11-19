export const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

export const AUTO_SHUTTER_HOLD_MS = 800;
export const SHUTTER_COOLDOWN_MS = 2200;
export const POSE_RECORD_SECONDS = 3;
export const VOICE_COOLDOWN_MS = 3200;
export const JOINT_VISIBILITY_THRESHOLD = 0.35;
export const TOTAL_LANDMARKS = 33;

/** @type {readonly number[]} */
export const EDITABLE_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

/** @type {Readonly<Record<number, string>>} */
export const JOINT_NAMES = {
  0: "Голова",
  11: "Л. плечо",
  12: "П. плечо",
  13: "Л. локоть",
  14: "П. локоть",
  15: "Л. кисть",
  16: "П. кисть",
  23: "Л. бедро",
  24: "П. бедро",
  25: "Л. колено",
  26: "П. колено",
  27: "Л. щиколотка",
  28: "П. щиколотка"
};

/** @type {readonly (readonly [number, number])[]} */
export const LR_SWAP_PAIRS = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32]
];

/**
 * @typedef {Object} BoneConnection
 * @property {number} a
 * @property {number} b
 * @property {import("./types.js").SegmentGroup} group
 * @property {string} id
 * @property {string} label
 */

/** @type {readonly BoneConnection[]} */
export const BONE_CONNECTIONS = [
  { a: 11, b: 12, group: "shoulders", id: "shoulder_line", label: "Линия плеч" },
  { a: 11, b: 13, group: "shoulders", id: "left_upper_arm", label: "Левое плечо" },
  { a: 12, b: 14, group: "shoulders", id: "right_upper_arm", label: "Правое плечо" },
  { a: 13, b: 15, group: "elbows", id: "left_forearm", label: "Левое предплечье" },
  { a: 14, b: 16, group: "elbows", id: "right_forearm", label: "Правое предплечье" },
  { a: 11, b: 23, group: "torso", id: "left_torso", label: "Корпус" },
  { a: 12, b: 24, group: "torso", id: "right_torso", label: "Корпус" },
  { a: 23, b: 24, group: "torso", id: "hip_line", label: "Линия таза" },
  { a: 23, b: 25, group: "hips", id: "left_thigh", label: "Левое бедро" },
  { a: 24, b: 26, group: "hips", id: "right_thigh", label: "Правое бедро" },
  { a: 25, b: 27, group: "hips", id: "left_shin", label: "Левая голень" },
  { a: 26, b: 28, group: "hips", id: "right_shin", label: "Правая голень" }
];

/** @type {import("./types.js").AppSettings} */
export const DEFAULT_SETTINGS = {
  attachToBody: true,
  mirrorRef: false,
  parktronic: true,
  voice: false,
  threshold: 80,
  activeDeviceId: ""
};
