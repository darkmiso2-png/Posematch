import { getMirroredCopy } from "../../core/poseMath.js";
import { navigateTo, selectShot, setShowSkeletonOverlay } from "../../state/store.js";
import { drawStaticSkeleton } from "../overlayRenderer.js";

/**
 * Экран 4: галерея сессии и Side-by-Side сравнение «Эталон» vs «Ваше фото».
 * @param {HTMLElement} root
 * @returns {{ render: (state: import("../../core/types.js").AppState) => void }}
 */
export function createGalleryScreen(root) {
  const refCanvas = /** @type {HTMLCanvasElement} */ (root.querySelector("#gal-ref-canvas"));
  const refCtx = /** @type {CanvasRenderingContext2D} */ (refCanvas.getContext("2d"));
  const shotCanvas = /** @type {HTMLCanvasElement} */ (root.querySelector("#gal-shot-canvas"));
  const shotCtx = /** @type {CanvasRenderingContext2D} */ (shotCanvas.getContext("2d"));
  const shotScore = /** @type {HTMLElement} */ (root.querySelector("#gal-shot-score"));
  const strip = /** @type {HTMLElement} */ (root.querySelector("#gal-strip"));
  const toggleSkel = /** @type {HTMLButtonElement} */ (root.querySelector("#gal-toggle-skel"));
  const btnDownload = /** @type {HTMLButtonElement} */ (root.querySelector("#gal-btn-download"));

  /** @type {import("../../core/types.js").CapturedShot | null} */
  let currentShot = null;

  root.querySelector("#gal-btn-camera")?.addEventListener("click", () => navigateTo("camera"));
  root.querySelector("#gal-btn-hub")?.addEventListener("click", () => navigateTo("hub"));
  toggleSkel.addEventListener("click", () => {
    setShowSkeletonOverlay(toggleSkel.dataset.active !== "true");
  });

  btnDownload.addEventListener("click", () => {
    if (!currentShot) return;
    const a = document.createElement("a");
    a.href = currentShot.imageDataUrl;
    a.download = `posematch-${currentShot.score}pct-${currentShot.createdAt}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} src
   * @param {import("../../core/types.js").JointPoint[] | null} lms
   * @param {boolean} mirrorImg
   * @param {boolean} showSkeleton
   * @param {string} color
   */
  function drawPane(canvas, ctx, src, lms, mirrorImg, showSkeleton, color) {
    const img = new Image();
    img.onload = () => {
      canvas.width = 360;
      canvas.height = 480;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = (canvas.width - dw) * 0.5;
      const dy = (canvas.height - dh) * 0.5;

      ctx.save();
      ctx.translate(dx, dy);
      if (mirrorImg) {
        ctx.translate(dw, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(img, 0, 0, dw, dh);
      ctx.restore();

      if (showSkeleton && lms) {
        ctx.save();
        ctx.translate(dx, dy);
        drawStaticSkeleton(ctx, dw, dh, lms, color);
        ctx.restore();
      }
    };
    img.src = src;
  }

  /** @param {import("../../core/types.js").AppState} state */
  function render(state) {
    toggleSkel.dataset.active = String(state.showSkeletonOverlay);
    toggleSkel.classList.toggle("active-cyan", state.showSkeletonOverlay);

    currentShot = state.shots.find((s) => s.id === state.selectedShotId) || state.shots[0] || null;

    if (state.activeReference) {
      const refLms = state.settings.mirrorRef
        ? getMirroredCopy(state.activeReference.landmarks)
        : state.activeReference.landmarks;
      drawPane(
        refCanvas,
        refCtx,
        state.activeReference.imageDataUrl,
        refLms,
        state.settings.mirrorRef,
        state.showSkeletonOverlay,
        "#00e5ff"
      );
    }

    if (currentShot) {
      shotScore.textContent = `Совпадение: ${currentShot.score}%`;
      drawPane(
        shotCanvas,
        shotCtx,
        currentShot.imageDataUrl,
        currentShot.userLandmarks,
        false,
        state.showSkeletonOverlay,
        "#00e676"
      );
      btnDownload.disabled = false;
    } else {
      shotScore.textContent = "Пока нет снимков";
      shotCtx.clearRect(0, 0, shotCanvas.width, shotCanvas.height);
      btnDownload.disabled = true;
    }

    strip.innerHTML = "";
    for (const shot of state.shots) {
      const item = document.createElement("div");
      item.className = `shot-thumb${currentShot?.id === shot.id ? " active" : ""}`;
      const img = document.createElement("img");
      img.src = shot.imageDataUrl;
      img.alt = `${shot.score}%`;
      item.appendChild(img);
      item.addEventListener("click", () => selectShot(shot.id));
      strip.appendChild(item);
    }
  }

  return { render };
}
