/**
 * Viewer tab: pure Babylon canvas.
 *
 * Scene exploration lives in the Babylon inspector (⌘I / topbar button); the
 * model summary lives in the status bar. This tab only owns the canvas, its
 * empty state and the load lifecycle.
 */
import { app } from "../app";
import { el, emptyState, OPEN_HINT } from "../ui";
import { ViewerScene } from "../viewer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TabHandle } from "./types";

export function mountViewer(): TabHandle {
  const root = el("div", { class: "tab-body canvas-only" });
  const main = el("div", { class: "tab-main" });
  const wrap = el("div", { class: "canvas-wrap" });
  const canvas = el("canvas", { id: "viewer-canvas" });
  const label = el("div", { class: "canvas-label", text: "no file loaded" });
  const loading = el("div", { class: "loading", text: "loading…" });
  const openHint = emptyState(OPEN_HINT, { label: "Open…", onClick: () => void app.pickAndOpen() });
  openHint.classList.add("overlay");
  openHint.hidden = true;
  wrap.append(canvas, label, loading, openHint);
  main.append(wrap);
  root.append(main);

  let viewer: ViewerScene | null = null;
  let pendingPath: string | null = app.viewPath;
  let pickedBound = false;

  const showLoading = (on: boolean, text = "loading…") => {
    loading.textContent = text;
    loading.classList.toggle("show", on);
  };

  async function loadPath(path: string): Promise<void> {
    const v = viewer;
    if (!v) return;
    label.textContent = path;
    showLoading(true, `loading ${path}…`);
    try {
      if (app.bridge.live) {
        const b64 = await app.bridge.loadBytes(path);
        await v.loadBase64(b64);
      } else {
        v.loadDemo();
      }
      openHint.hidden = true;
      label.textContent = app.bridge.live ? path : `${path} — demo scene (no nanoui)`;
    } catch (err) {
      app.toast(`load failed: ${(err as Error).message}`, "error");
      label.textContent = "load failed";
      openHint.hidden = false;
    } finally {
      showLoading(false);
    }

    try {
      app.setInfo(await app.bridge.info(path));
    } catch (err) {
      app.setInfo(null);
      app.toast(`info failed: ${(err as Error).message}`, "error");
    }

    if (!pickedBound) {
      pickedBound = true;
      v.scene.onPointerObservable.add((pi) => {
        if (pi.type !== 1) return; // POINTERDOWN
        v.selectMesh((pi.pickInfo?.pickedMesh as AbstractMesh | null) ?? null);
      });
    }
  }

  const offView = app.on("view", (d) => {
    pendingPath = d.path;
    if (viewer) void loadPath(d.path);
  });

  return {
    el: root,
    activate: () => {
      if (!viewer) {
        try {
          viewer = new ViewerScene(canvas, "viewer");
          app.setViewer(viewer);
          if (pendingPath) {
            void loadPath(pendingPath);
          } else if (!app.bridge.live) {
            viewer.loadDemo();
            label.textContent = "demo scene (no nanoui)";
          } else {
            openHint.hidden = false;
          }
        } catch (err) {
          const reason = (err as Error).message;
          wrap.append(el("div", { class: "empty", text: `WebGL unavailable: ${reason}` }));
          app.toast(`WebGL unavailable: ${reason}`, "error");
        }
      } else {
        viewer.resume();
        // The canvas was hidden while another tab was active; the observer's
        // 0×0 reports were ignored, so force a re-sync now that it is visible.
        viewer.forceResize();
      }
    },
    deactivate: () => viewer?.pause(),
    dispose: () => {
      offView();
      if (viewer) {
        app.setViewer(null);
        viewer.dispose();
        viewer = null;
      }
    },
  };
}
