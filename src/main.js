import { installAudioUnlockListener } from "./services/audioVoiceService.js";
import { initPoseLandmarker } from "./services/mediapipeService.js";
import { registerPwaServiceWorker } from "./services/pwaService.js";
import { getState, subscribe, updateRuntime } from "./state/store.js";
import { createCameraController } from "./ui/cameraController.js";
import { createScreenRouter } from "./ui/router.js";
import { createCalibrationScreen } from "./ui/screens/calibrationScreen.js";
import { createCameraScreen } from "./ui/screens/cameraScreen.js";
import { createGalleryScreen } from "./ui/screens/galleryScreen.js";
import { createHubScreen } from "./ui/screens/hubScreen.js";

const mpDot = /** @type {HTMLElement} */ (document.querySelector("#mp-status-dot"));
const mpText = /** @type {HTMLElement} */ (document.querySelector("#mp-status-text"));

/** @type {Record<import("./core/types.js").ScreenId, HTMLElement>} */
const screens = {
  hub: /** @type {HTMLElement} */ (document.querySelector("#screen-hub")),
  calibration: /** @type {HTMLElement} */ (document.querySelector("#screen-calibration")),
  camera: /** @type {HTMLElement} */ (document.querySelector("#screen-camera")),
  gallery: /** @type {HTMLElement} */ (document.querySelector("#screen-gallery"))
};

/** @type {ReturnType<typeof createCameraController> | null} */
let camController = null;

const cameraView = createCameraScreen(screens.camera, {
  onSelectCamera: (id) => camController?.connectCamera(id),
  onRetryCamera: () => camController?.connectCamera(""),
  onManualShutter: () => camController?.takeManualShot(),
  onRecordPose: () => camController?.recordPose3Sec(),
  onCancelRecordPose: () => camController?.cancelRecordPose(),
  onResetSmoothing: () => camController?.resetSmoothing()
});

camController = createCameraController(cameraView);
const hubView = createHubScreen(screens.hub, {
  onStartRecordPose: () => camController?.recordPose3Sec()
});
const calibView = createCalibrationScreen(screens.calibration);
const galleryView = createGalleryScreen(screens.gallery);

const routeToScreen = createScreenRouter(screens, {
  onEnter: {
    camera: () => camController?.activate()
  },
  onLeave: {
    camera: () => camController?.deactivate(),
    gallery: () => galleryView.clearNotice()
  }
});

/** @param {import("./core/types.js").AppState} state */
function syncUI(state) {
  mpDot.className = "dot";
  if (state.runtime.mpStatus === "gpu" || state.runtime.mpStatus === "cpu") {
    mpDot.classList.add("ready");
  } else if (state.runtime.mpStatus === "error") {
    mpDot.classList.add("error");
  }
  mpText.textContent = state.runtime.mpMessage;

  routeToScreen(state.currentScreen);

  if (state.currentScreen === "hub") hubView.render(state);
  if (state.currentScreen === "calibration") calibView.render(state);
  if (state.currentScreen === "camera") cameraView.render(state);
  if (state.currentScreen === "gallery") galleryView.render(state);
}

subscribe(syncUI);
syncUI(getState());
installAudioUnlockListener();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    camController?.deactivate();
  } else if (getState().currentScreen === "camera") {
    camController?.activate();
  }
});

window.addEventListener("pagehide", () => {
  camController?.deactivate();
});

initPoseLandmarker((mpStatus, mpMessage) => updateRuntime({ mpStatus, mpMessage }));
void registerPwaServiceWorker();
