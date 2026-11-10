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
import { errMessage } from "../guards";

/**
 * Generation counter: every `view` event / loadPath entry bumps it, and each
 * async reply checks its own id before touching the UI, so a stale
 * loadBytes/info reply can never overwrite a newer file's view.
 */
let viewSeq = 0;

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
    const seq = ++viewSeq;
    const stale = (): boolean => seq !== viewSeq;
    const v = viewer;
    if (!v) return;
    label.textContent = path;
    showLoading(true, t("viewer.loadingPath", { path }));
    try {
      if (app.bridge.live) {
        const b64 = await app.bridge.loadBytes(path);
        if (stale()) return;
        await v.loadBase64(b64);
        if (stale()) return;
        // Successful viewer model load: the shell opens the inspector.
        // (Demo and failed loads stay quiet.)
        window.dispatchEvent(new CustomEvent("assetty:viewer-loaded"));
      } else {
        v.loadDemo();
      }
      if (stale()) return;
      openHint.hidden = true;
      label.textContent = app.bridge.live ? path : t("viewer.demoScenePath", { path });
    } catch (err) {
      if (stale()) return;
      app.toast(t("viewer.loadFailedMsg", { message: errMessage(err) }), "error");
      label.textContent = t("viewer.loadFailed");
      openHint.hidden = false;
    } finally {
      // A superseded reply must not hide the newer load's spinner.
      if (!stale()) showLoading(false);
    }

    if (stale()) return;
    try {
      const info = await app.bridge.info(path);
      if (stale()) return;
      app.setInfo(info);
    } catch (err) {
      if (stale()) return;
      app.setInfo(null);
      app.toast(t("viewer.infoFailed", { message: errMessage(err) }), "error");
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
          const reason = errMessage(err);
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
