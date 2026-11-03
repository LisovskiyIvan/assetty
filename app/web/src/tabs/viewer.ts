/**
 * Viewer tab: pure Babylon canvas.
 *
 * Scene exploration lives in the Babylon inspector (⌘I / topbar button); the
 * model summary lives in the status bar. This tab only owns the canvas, its
 * empty state and the load lifecycle.
 */
import { app } from "../app";
import { el, emptyState } from "../ui";
import { onLang, t } from "../i18n";
import { ViewerScene } from "../viewer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TabHandle } from "./types";

export function mountViewer(): TabHandle {
  const root = el("div", { class: "tab-body canvas-only" });
  const main = el("div", { class: "tab-main" });
  const wrap = el("div", { class: "canvas-wrap" });
  const canvas = el("canvas", { id: "viewer-canvas" });
  const label = el("div", { class: "canvas-label", text: t("viewer.noFile") });
  const loading = el("div", { class: "loading", text: t("viewer.loading") });
  const openHint = emptyState(t("viewer.openHint"), {
    label: t("common.open"),
    onClick: () => void app.pickAndOpen(),
  });
  openHint.classList.add("overlay");
  openHint.hidden = true;
  wrap.append(canvas, label, loading, openHint);
  main.append(wrap);
  root.append(main);

  let viewer: ViewerScene | null = null;
  let pendingPath: string | null = app.viewPath;
  let pickedBound = false;

  const showLoading = (on: boolean, text?: string) => {
    loading.textContent = text ?? t("viewer.loading");
    loading.classList.toggle("show", on);
  };

  /** Re-renders visible strings in the active language (no reload). */
  function syncStrings(): void {
    loading.textContent = t("viewer.loading");
    const text = openHint.querySelector(".empty-state-text");
    if (text) text.textContent = t("viewer.openHint");
    const btn = openHint.querySelector("button");
    if (btn) btn.textContent = t("common.open");
  }

  async function loadPath(path: string): Promise<void> {
    const v = viewer;
    if (!v) return;
    label.textContent = path;
    showLoading(true, t("viewer.loadingPath", { path }));
    try {
      if (app.bridge.live) {
        const b64 = await app.bridge.loadBytes(path);
        await v.loadBase64(b64);
        // Successful viewer model load: the shell opens the inspector.
        // (Demo and failed loads stay quiet.)
        window.dispatchEvent(new CustomEvent("assetty:viewer-loaded"));
      } else {
        v.loadDemo();
      }
      openHint.hidden = true;
      label.textContent = app.bridge.live ? path : t("viewer.demoScenePath", { path });
    } catch (err) {
      app.toast(t("viewer.loadFailedMsg", { message: (err as Error).message }), "error");
      label.textContent = t("viewer.loadFailed");
      openHint.hidden = false;
    } finally {
      showLoading(false);
    }

    try {
      app.setInfo(await app.bridge.info(path));
    } catch (err) {
      app.setInfo(null);
      app.toast(t("viewer.infoFailed", { message: (err as Error).message }), "error");
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
  const offLang = onLang(() => syncStrings());

  return {
    el: root,
    activate: () => {
      syncStrings();
      if (!viewer) {
        try {
          viewer = new ViewerScene(canvas, "viewer");
          app.setViewer(viewer);
          if (pendingPath) {
            void loadPath(pendingPath);
          } else if (!app.bridge.live) {
            viewer.loadDemo();
            label.textContent = t("viewer.demoScene");
          } else {
            openHint.hidden = false;
          }
        } catch (err) {
          const reason = (err as Error).message;
          wrap.append(el("div", { class: "empty", text: t("viewer.webglFail", { reason }) }));
          app.toast(t("viewer.webglFail", { reason }), "error");
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
      offLang();
      if (viewer) {
        app.setViewer(null);
        viewer.dispose();
        viewer = null;
      }
    },
  };
}
