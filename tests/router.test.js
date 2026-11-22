import { describe, expect, it, vi } from "vitest";
import { createScreenRouter } from "../src/ui/router.js";

function createMockScreens() {
  const makeEl = () =>
    /** @type {HTMLElement} */ (
      /** @type {unknown} */ ({
        hidden: false,
        classList: { toggle: vi.fn() }
      })
    );

  return {
    hub: makeEl(),
    calibration: makeEl(),
    camera: makeEl(),
    gallery: makeEl()
  };
}

describe("createScreenRouter", () => {
  it("fires onEnter and onLeave hooks only on actual screen transitions", () => {
    const screens = createMockScreens();
    const enterCam = vi.fn();
    const leaveCam = vi.fn();

    const route = createScreenRouter(screens, {
      onEnter: { camera: enterCam },
      onLeave: { camera: leaveCam }
    });

    route("camera");
    route("camera");
    expect(enterCam).toHaveBeenCalledTimes(1);
    expect(leaveCam).toHaveBeenCalledTimes(0);

    route("hub");
    expect(leaveCam).toHaveBeenCalledTimes(1);
    expect(screens.camera.hidden).toBe(true);
    expect(screens.hub.hidden).toBe(false);

    route("camera");
    expect(enterCam).toHaveBeenCalledTimes(2);
  });

  it("handles reentrant router calls inside onLeave without recursion", () => {
    const screens = createMockScreens();
    const enterHub = vi.fn();
    const leaveCamera = vi.fn(() => {
      // Имитация синхронного notify() -> syncUI() -> route("hub") изнутри deactivate()
      route("hub");
    });

    const route = createScreenRouter(screens, {
      onEnter: { hub: enterHub },
      onLeave: { camera: leaveCamera }
    });

    route("camera");
    route("hub");

    expect(leaveCamera).toHaveBeenCalledTimes(1);
    expect(enterHub).toHaveBeenCalledTimes(1);
    expect(screens.camera.hidden).toBe(true);
    expect(screens.hub.hidden).toBe(false);
  });
});
