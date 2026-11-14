/**
 * Optimize tab: side-by-side / split-slider compare view (canvases, camera
 * sync, grip drag). Owns the ViewerScene pair and the compare-mode UI.
 */
import { app } from "../../app";
import { notify } from "../../notify";
import { t } from "../../i18n";
import { el, emptyState } from "../../ui";
import { fieldHelpButton } from "../../optimizeForm";
import { ViewerScene, linkCameras, type ModelExt } from "../../viewer";
import type { OptimizeResult } from "../../types";
import { errMessage } from "../../guards";

/** Before/after view mode. "side" is the classic two canvases; "split"
 * stacks both scenes in one viewport with a draggable wipe divider (the
 * TOP canvas shows the result, clipped to the right of the divider). */
export type CompareMode = "side" | "split";

export interface DualScenes {
  left: ViewerScene;
  /** Null until the first split-view/result use (created lazily). */
  right: ViewerScene | null;
}

export interface DualApi {
  /** Result currently compared (null while no artifact exists). */
  setResult(res: OptimizeResult | null): void;
  hasResult(): boolean;
  compareMode(): CompareMode;
  splitPos(): number;
  setCompareMode(mode: CompareMode): void;
  /** Creates the left pane on first call (the right pane stays lazy until
   * the first split-view/result use); resumes afterwards. False on WebGL failure. */
  ensureScenes(): boolean;
  /** Left pane always present once ensured; right null until lazily created. */
  scenes(): DualScenes | null;
  pause(): void;
  disposeScenes(): void;
  forceResize(): void;
  loadLeftLive(b64: string, ext?: ModelExt): Promise<void>;
  loadLeftDemo(): void;
  loadRightLive(b64: string, ext?: ModelExt): Promise<void>;
  loadRightDemo(): void;
  showOpenHint(): void;
  hideOpenHint(): void;
  syncEmptyHint(): void;
  /** Re-renders toolbar + layout (compare mode, labels, split state). */
  resync(): void;
}

export function createDualView(main: HTMLElement): DualApi {
  const dual = el("div", { class: "dual" });
  const mkPane = (key: string, paneClass: string) => {
    const wrap = el("div", { class: `canvas-wrap ${paneClass}` });
    const canvas = el("canvas");
    const paneLabel = el("div", { class: "canvas-label", text: t(key) });
    wrap.append(canvas, paneLabel);
    dual.append(wrap);
    return { wrap, canvas, paneLabel };
  };
  const leftPane = mkPane("opt.original", "pane-left");
  const rightPane = mkPane("opt.optimized", "pane-top");

  /** Divider position in % (left = SOURCE, right = OPTIMIZED). Persists across
   * renders of the same result; reset to 50% on every new result. */
  let compareMode: CompareMode = "side";
  let splitPos = 50;
  let lastResult: OptimizeResult | null = null;

  const sideBtn = el("button", {
    class: "small active",
    text: t("opt.sideBySide"),
    title: t("opt.sideTitle"),
  });
  const splitBtn = el("button", {
    class: "small",
    text: t("opt.splitSlider"),
    title: t("opt.splitNeedResult"),
    disabled: true,
  });
  const splitHint = el("span", {
    class: "hint",
    text: t("opt.syncHint"),
  });
  const modeSeg = el("div", { class: "segmented compare-seg" }, sideBtn, splitBtn);
  const toolbar = el(
    "div",
    { class: "compare-toolbar" },
    modeSeg,
    fieldHelpButton("compare.mode"),
    splitHint,
  );

  // Split overlay: divider line + full-height 28px drag strip with a ⟷ knob
  // + SOURCE/OPTIMIZED chips. pointer-events:none except the grip, so drags
  // anywhere else fall through to the MASTER (source) canvas below.
  const splitLine = el("div", { class: "split-line" });
  const splitGrip = el(
    "button",
    { class: "split-grip", title: t("opt.splitDragTitle") },
    el("span", { class: "split-knob", text: "⟷" }),
  );
  splitGrip.setAttribute("role", "slider");
  splitGrip.setAttribute("aria-label", t("opt.splitSlider"));
  splitGrip.setAttribute("aria-valuemin", "0");
  splitGrip.setAttribute("aria-valuemax", "100");
  splitGrip.setAttribute("aria-valuenow", "50");
  splitGrip.setAttribute("aria-orientation", "horizontal");
  const splitChipLeft = el("div", { class: "split-chip left", text: t("opt.chipSource") });
  const splitChipRight = el("div", { class: "split-chip right", text: t("opt.chipOptimized") });
  const splitUi = el(
    "div",
    { class: "split-ui" },
    splitLine,
    splitChipLeft,
    splitChipRight,
    splitGrip,
  );
  dual.append(splitUi);
  // No bottom panel here: progress + report live in the right panel.
  main.append(toolbar, dual);

  const openHint = emptyState(t("viewer.openHint"), {
    label: t("common.open"),
    onClick: () => void app.pickAndOpen(),
  });
  openHint.classList.add("overlay");
  openHint.hidden = true;
  main.append(openHint);

  /** "No source model" when a view exists without a source; else the Open hint. */
  function syncEmptyHint(): void {
    const label = openHint.querySelector(".empty-state-text");
    if (label) {
      label.textContent =
        !app.sourcePath && app.viewPath ? t("viewer.noSourceHint") : t("viewer.openHint");
    }
    const btn = openHint.querySelector("button");
    if (btn) btn.textContent = t("common.open");
    if (!app.sourcePath) openHint.hidden = false;
  }

  let left: ViewerScene | null = null;
  let right: ViewerScene | null = null;
  /** Bidirectional orbit-link teardown (null until both panes exist). */
  let stopLink: (() => void) | null = null;
  /** Removes the split-mode master→slave camera sync (null when inactive). */
  let stopSplitSync: (() => void) | null = null;

  /** Applies the divider position: the TOP canvas (result) is clipped so only
   * its right part shows; the BOTTOM canvas (source) shows through on the left. */
  function applySplit(): void {
    const x = Math.max(0, Math.min(100, splitPos));
    rightPane.wrap.style.clipPath = `inset(0 0 0 ${x}%)`;
    splitLine.style.left = `${x}%`;
    splitGrip.style.left = `${x}%`;
    splitGrip.setAttribute("aria-valuenow", String(Math.round(x)));
  }

  /**
   * Split mode makes the source camera the MASTER and the result camera a
   * SLAVE: every frame (just before each scene renders, on both scenes so the
   * copy lands even when the two engines tick in different order) the slave
   * copies angle/radius/target plus the zoom/clip limits, so both viewports
   * share identical projections — pixel-level comparison at shared angles.
   * The slave canvas never receives input (the top pane is pointer-events:none
   * and the grip strip sits above it), so the bidirectional orbit link used by
   * side-by-side mode cannot fight this copy: it is idempotent anyway.
   */
  function setSplitSync(on: boolean): void {
    if (on && stopSplitSync) return;
    if (!on) {
      stopSplitSync?.();
      stopSplitSync = null;
      return;
    }
    const master = left;
    const slave = right;
    if (!master || !slave) return;
    const copy = (): void => {
      const s = master.camera;
      const d = slave.camera;
      d.lowerRadiusLimit = s.lowerRadiusLimit;
      d.upperRadiusLimit = s.upperRadiusLimit;
      d.minZ = s.minZ;
      d.maxZ = s.maxZ;
      slave.applyCameraFrom(s);
    };
    copy();
    const o1 = master.scene.onBeforeRenderObservable.add(copy);
    const o2 = slave.scene.onBeforeRenderObservable.add(copy);
    stopSplitSync = () => {
      master.scene.onBeforeRenderObservable.remove(o1);
      slave.scene.onBeforeRenderObservable.remove(o2);
    };
  }

  /** Refreshes the toolbar + layout for the current mode/result state. Falls
   * back to side-by-side while there is no result to compare against. */
  function syncCompareUI(): void {
    const split = compareMode === "split" && lastResult !== null;
    dual.classList.toggle("split", split);
    sideBtn.classList.toggle("active", !split);
    splitBtn.classList.toggle("active", split);
    sideBtn.textContent = t("opt.sideBySide");
    sideBtn.title = t("opt.sideTitle");
    splitBtn.textContent = t("opt.splitSlider");
    splitBtn.disabled = lastResult === null;
    splitBtn.title = lastResult ? t("opt.splitWipeTitle") : t("opt.splitNeedResult");
    splitHint.textContent = split ? t("opt.splitHint") : t("opt.syncHint");
    splitGrip.title = t("opt.splitDragTitle");
    splitGrip.setAttribute("aria-label", t("opt.splitSlider"));
    splitGrip.setAttribute("aria-valuenow", String(Math.round(splitPos)));
    splitGrip.setAttribute("aria-disabled", split ? "false" : "true");
    splitChipLeft.textContent = t("opt.chipSource");
    splitChipRight.textContent = t("opt.chipOptimized");
    leftPane.paneLabel.textContent = t("opt.original");
    rightPane.paneLabel.textContent = t("opt.optimized");
    setSplitSync(split && left !== null && right !== null);
    if (split) applySplit();
    else rightPane.wrap.style.clipPath = "";
    left?.forceResize();
    right?.forceResize();
  }

  function setCompareMode(mode: CompareMode): void {
    if (mode === "split" && lastResult === null) return;
    // Split view needs the result pane: create it on first activation and
    // keep it for the tab lifetime (disposeScenes drops it).
    if (mode === "split") ensureRight();
    compareMode = mode;
    syncCompareUI();
  }

  sideBtn.addEventListener("click", () => setCompareMode("side"));
  splitBtn.addEventListener("click", () => setCompareMode("split"));

  /** Dragging the 28px grip strip moves the divider. Moves are handled on the
   * container (not the grip): with pointer capture they retarget to the grip
   * and bubble up here; without capture (or when the cursor outruns the
   * strip) the container still sees them. The strip sits above both canvases,
   * so these pointerdowns never reach the master camera. Arrow keys nudge the
   * divider without a pointer (Home/End jump to the edges). */
  function nudgeSplit(delta: number): void {
    if (compareMode !== "split" || lastResult === null) return;
    splitPos = Math.max(0, Math.min(100, splitPos + delta));
    applySplit();
  }
  splitGrip.addEventListener("keydown", (ev) => {
    switch (ev.key) {
      case "ArrowLeft":
      case "ArrowDown":
        ev.preventDefault();
        nudgeSplit(-2);
        break;
      case "ArrowRight":
      case "ArrowUp":
        ev.preventDefault();
        nudgeSplit(2);
        break;
      case "Home":
        ev.preventDefault();
        if (compareMode === "split" && lastResult !== null) {
          splitPos = 0;
          applySplit();
        }
        break;
      case "End":
        ev.preventDefault();
        if (compareMode === "split" && lastResult !== null) {
          splitPos = 100;
          applySplit();
        }
        break;
    }
  });
  let splitDragging = false;
  let splitRect: DOMRect | null = null;
  splitGrip.addEventListener("pointerdown", (ev) => {
    if (compareMode !== "split" || lastResult === null) return;
    splitDragging = true;
    // Cache the container rect once per drag: reading it on every pointermove
    // after a clip-path write forces a synchronous reflow each event.
    splitRect = dual.getBoundingClientRect();
    try {
      splitGrip.setPointerCapture(ev.pointerId);
    } catch {
      // Synthetic pointers (headless checks) may refuse capture; the
      // container-level move handler below covers that case.
    }
    ev.preventDefault();
  });
  dual.addEventListener("pointermove", (ev) => {
    if (!splitDragging) return;
    const rect = splitRect ?? (splitRect = dual.getBoundingClientRect());
    if (rect.width <= 0) return;
    splitPos = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    applySplit();
  });
  const endSplitDrag = (): void => {
    splitDragging = false;
    splitRect = null;
  };
  dual.addEventListener("pointerup", endSplitDrag);
  dual.addEventListener("pointercancel", endSplitDrag);

  /** A fresh result enables the Split option and re-centers the divider. */
  function setResult(res: OptimizeResult | null): void {
    if (res) {
      lastResult = res;
      splitPos = 50;
    } else {
      lastResult = null;
      compareMode = "side";
    }
    syncCompareUI();
  }

  /** Links the panes once both exist (the orbit sync returned by linkCameras). */
  function linkIfReady(): void {
    if (left && right && !stopLink) {
      stopLink = linkCameras(left, right);
    }
  }

  /** Creates the left (source) pane on first call; resumes afterwards. */
  function ensureLeft(): boolean {
    if (left) {
      left.resume();
      return true;
    }
    try {
      left = new ViewerScene(leftPane.canvas, "original");
      linkIfReady();
      return true;
    } catch (err) {
      notify(t("viewer.webglFail", { reason: errMessage(err) }), "error");
      return false;
    }
  }

  /**
   * Creates the right (result) pane on first split-view/result use and keeps
   * it for the tab lifetime, so an idle Optimize tab costs one engine instead
   * of two. Resumes afterwards.
   */
  function ensureRight(): boolean {
    if (right) {
      right.resume();
      return true;
    }
    try {
      right = new ViewerScene(rightPane.canvas, "optimized");
      linkIfReady();
      return true;
    } catch (err) {
      notify(t("viewer.webglFail", { reason: errMessage(err) }), "error");
      return false;
    }
  }

  function ensureScenes(): boolean {
    if (!ensureLeft()) return false;
    right?.resume();
    return true;
  }

  return {
    setResult,
    hasResult: () => lastResult !== null,
    compareMode: () => compareMode,
    splitPos: () => splitPos,
    setCompareMode,
    ensureScenes,
    scenes: () => (left ? { left, right } : null),
    pause: () => {
      left?.pause();
      right?.pause();
    },
    disposeScenes: () => {
      setSplitSync(false);
      stopLink?.();
      stopLink = null;
      left?.dispose();
      right?.dispose();
      left = null;
      right = null;
    },
    forceResize: () => {
      left?.forceResize();
      right?.forceResize();
    },
    loadLeftLive: (b64: string, ext?: ModelExt) => {
      if (!left && !ensureLeft()) return Promise.resolve();
      return (left as ViewerScene).loadBase64(b64, ext ?? ".glb");
    },
    loadLeftDemo: () => {
      if (!left && !ensureLeft()) return;
      left?.loadDemo();
    },
    loadRightLive: (b64: string, ext?: ModelExt) => {
      if (!right && !ensureRight()) return Promise.resolve();
      return (right as ViewerScene).loadBase64(b64, ext ?? ".glb");
    },
    loadRightDemo: () => {
      if (!right && !ensureRight()) return;
      right?.loadDemo();
    },
    showOpenHint: () => {
      openHint.hidden = false;
    },
    hideOpenHint: () => {
      openHint.hidden = true;
    },
    syncEmptyHint,
    resync: () => syncCompareUI(),
  };
}
