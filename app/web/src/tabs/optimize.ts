import { app } from "../app";
import { isBusyError } from "../bridge";
import { buildOptimizeForm, closeFieldHelp, fieldHelpButton } from "../optimizeForm";
import { onLang, t } from "../i18n";
import {
  getSettings,
  getTextureOverrides,
  onSettingsChange,
  textureOverridesCount,
  updateSettings,
} from "../settings";
import type { OptimizeSteps, TextureFormat } from "../settings";
import { el, fmtBytes, fmtNum, fmtPct, deltaClass, clear, copyText, emptyState } from "../ui";
import { isMissingMethodError, notify, onLog } from "../notify";
import { ViewerScene, linkCameras } from "../viewer";
import type { ImageInfo, Info, OptimizeResult, Stats } from "../types";
import type { TabHandle } from "./types";

/** Encodable by the textures step: anything that is not already KTX2/basis. */
export function isEncodableImage(img: ImageInfo): boolean {
  return !/ktx2|basis/i.test(img.format ?? "");
}

interface RowSpec {
  key: string;
  labelKey: string;
  bytes?: boolean;
  deltaKey?: string;
}

const ROWS: RowSpec[] = [
  { key: "triangles", labelKey: "opt.rowTriangles" },
  { key: "vertices", labelKey: "opt.rowVertices" },
  { key: "draw_calls", labelKey: "opt.rowDraws" },
  { key: "vram_total", labelKey: "opt.rowVram", bytes: true, deltaKey: "vram_bytes" },
  { key: "disk_total", labelKey: "opt.rowDisk", bytes: true, deltaKey: "disk_bytes" },
];

/** Named presets only prefill the per-step controls (the result is saved as settings). */
const PRESET_PREFS: Record<string, ((steps: OptimizeSteps) => void) | undefined> = {
  mobile: (steps) => {
    steps.textures.format = "auto";
    steps.textures.quality = 160;
    steps.textures.max_size = 2048;
    steps.textures.generate_mips = true;
    steps.quantize.position_bits = 14;
    steps.quantize.uv_bits = 12;
    steps.quantize.normal_oct = true;
    steps.simplify.enabled = false;
    steps.weld.tolerance = 0;
  },
  desktop: (steps) => {
    steps.textures.format = "auto";
    steps.textures.quality = 255;
    steps.textures.max_size = 0;
    steps.textures.generate_mips = true;
    steps.quantize.position_bits = 14;
    steps.quantize.uv_bits = 12;
    steps.quantize.normal_oct = true;
    steps.simplify.enabled = false;
    steps.weld.tolerance = 0;
  },
  web: (steps) => {
    steps.textures.format = "etc1s";
    steps.textures.quality = 128;
    steps.textures.max_size = 1024;
    steps.textures.generate_mips = true;
    steps.quantize.position_bits = 14;
    steps.quantize.uv_bits = 12;
    steps.quantize.normal_oct = true;
    steps.simplify.enabled = false;
    steps.weld.tolerance = 0;
  },
};

function stat(stats: Stats | undefined, key: string): number | undefined {
  if (!stats) return undefined;
  const v = stats[key];
  return typeof v === "number" ? v : undefined;
}

function fmtSecs(secs: number | undefined): string {
  if (secs == null || !Number.isFinite(secs)) return "";
  return secs < 1 ? `${Math.round(secs * 1000)} ms` : `${secs.toFixed(2)} s`;
}

/**
 * The wire format understood by `optimizeCustom(path, spec)`: only enabled
 * steps are listed, and parameters are omitted when the backend default should
 * apply (mode bits default true on the host, so those are always explicit).
 */
function buildSpec(steps: OptimizeSteps): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (steps.prune.enabled) {
    out.push({
      prune: {
        unused_nodes: steps.prune.unused_nodes,
        unused_materials: steps.prune.unused_materials,
        unused_textures: steps.prune.unused_textures,
      },
    });
  }
  if (steps.dedup.enabled) {
    out.push({
      dedup: {
        accessors: steps.dedup.accessors,
        meshes: steps.dedup.meshes,
        materials: steps.dedup.materials,
      },
    });
  }
  if (steps.weld.enabled) out.push({ weld: { tolerance: steps.weld.tolerance } });
  if (steps.join.enabled) out.push({ join: {} });
  if (steps.textures.enabled) {
    const textures: Record<string, unknown> = {
      format: steps.textures.format,
      quality: steps.textures.quality,
      rdo_lambda: 1,
      generate_mips: steps.textures.generate_mips,
      max_size: steps.textures.max_size,
    };
    const overrides = getTextureOverrides(app.sourcePath);
    if (overrides.length > 0) textures.overrides = overrides.map((o) => ({ ...o }));
    out.push({ textures });
  }
  if (steps.quantize.enabled) {
    out.push({
      quantize: {
        position_bits: steps.quantize.position_bits,
        uv_bits: steps.quantize.uv_bits,
        normal_oct: steps.quantize.normal_oct,
      },
    });
  }
  if (steps.simplify.enabled) {
    const simplify: Record<string, unknown> = {
      target_ratio: steps.simplify.target_ratio,
      error_tolerance: steps.simplify.error_tolerance,
      aggressive: steps.simplify.aggressive,
      lock_borders: steps.simplify.lock_borders,
      use_attributes: steps.simplify.use_attributes,
    };
    // Weights only matter when attribute errors are weighed; omitting them lets
    // the backend use its defaults.
    if (steps.simplify.use_attributes) {
      simplify["weight_normal"] = steps.simplify.weight_normal;
      simplify["weight_uv"] = steps.simplify.weight_uv;
    }
    out.push({ simplify });
  }
  return out;
}

export function mountOptimize(): TabHandle {
  const root = el("div", { class: "tab-body wide-side" });
  const main = el("div", { class: "tab-main" });

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

  /** Before/after view mode. "side" is the classic two canvases; "split"
   * stacks both scenes in one viewport with a draggable wipe divider (the
   * TOP canvas shows the result, clipped to the right of the divider). */
  type CompareMode = "side" | "split";
  let compareMode: CompareMode = "side";
  /** Divider position in % (left = SOURCE, right = OPTIMIZED). Persists across
   * renders of the same result; reset to 50% on every new result. */
  let splitPos = 50;

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

  const side = el("div", { class: "tab-side" });
  root.append(main, side);

  let left: ViewerScene | null = null;
  let right: ViewerScene | null = null;
  let linked = false;
  let lastResult: OptimizeResult | null = null;
  /** True while a background job owns the backend (Run stays disabled). */
  let running = false;
  /** True while an exportTo copy is in flight (Save as… stays disabled). */
  let exporting = false;
  /** `dst` of the in-flight export; only the matching exportDone notifies. */
  let pendingDst: string | null = null;
  /** Last progress state, so a language switch can re-render the strip. */
  let progressStep = "";
  let progressPct = 0;
  let doneTimer: ReturnType<typeof setTimeout> | null = null;
  let stopProgress: (() => void) | null = null;
  /** Removes the split-mode master→slave camera sync (null when inactive). */
  let stopSplitSync: (() => void) | null = null;

  /** Applies the divider position: the TOP canvas (result) is clipped so only
   * its right part shows; the BOTTOM canvas (source) shows through on the left. */
  function applySplit(): void {
    const x = Math.max(0, Math.min(100, splitPos));
    rightPane.wrap.style.clipPath = `inset(0 0 0 ${x}%)`;
    splitLine.style.left = `${x}%`;
    splitGrip.style.left = `${x}%`;
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
    compareMode = mode;
    syncCompareUI();
  }

  sideBtn.addEventListener("click", () => setCompareMode("side"));
  splitBtn.addEventListener("click", () => setCompareMode("split"));

  /** Dragging the 28px grip strip moves the divider. Moves are handled on the
   * container (not the grip): with pointer capture they retarget to the grip
   * and bubble up here; without capture (or when the cursor outruns the
   * strip) the container still sees them. The strip sits above both canvases,
   * so these pointerdowns never reach the master camera. */
  let splitDragging = false;
  splitGrip.addEventListener("pointerdown", (ev) => {
    if (compareMode !== "split" || lastResult === null) return;
    splitDragging = true;
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
    const rect = dual.getBoundingClientRect();
    if (rect.width <= 0) return;
    splitPos = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    applySplit();
  });
  const endSplitDrag = (): void => {
    splitDragging = false;
  };
  dual.addEventListener("pointerup", endSplitDrag);
  dual.addEventListener("pointercancel", endSplitDrag);

  /** A fresh result enables the Split option and re-centers the divider. */
  function noteResult(res: OptimizeResult): void {
    lastResult = res;
    splitPos = 50;
    syncCompareUI();
  }

  // Step parameters live in the shared settings state (Settings tab edits the
  // same object); every change is applied in-app immediately and debounce-saved.
  const steps = (): OptimizeSteps => getSettings().optimize.steps;
  let internalEdit = false;
  function edit(mutate: (steps: OptimizeSteps) => void): void {
    internalEdit = true;
    try {
      updateSettings((settings) => mutate(settings.optimize.steps));
    } finally {
      internalEdit = false;
    }
  }
  // "" = hand-tuned settings (no preset pill highlighted). The named preset is
  // only used as a fallback if the host predates `optimizeCustom`.
  let activePreset = "";

  const sourceLabel = el("div", { class: "mono muted wrap" });
  const viewNote = el("div", { class: "amber-note" });
  viewNote.hidden = true;
  const presetRow = el("div", { class: "preset-row" });
  const runBtn = el("button", { class: "primary", disabled: true });
  const exportBtn = el("button", { disabled: true });
  /** Compact progress strip: lives with the Run button so it stays visible. */
  const progressFill = el("div");
  const progressMeta = el("span", { class: "run-progress-meta" });
  const progressBar = el("div", { class: "progress grow" }, progressFill);
  const logLine = el("div", { class: "logline mono", text: "—" });
  /** Pre-run guard: shown when the source has no encodable images left. */
  const guardBox = el("div", { class: "guard-box" });
  guardBox.hidden = true;

  function syncSourceHead(): void {
    sourceLabel.textContent = app.sourcePath
      ? t("opt.sourceLabel", { path: app.sourcePath })
      : t("opt.sourceLabel", { path: t("opt.noFile") });
    sourceLabel.title = app.sourcePath ?? "";
    viewNote.textContent = t("opt.diverged");
    const diverged = !!app.viewPath && !!app.sourcePath && app.viewPath !== app.sourcePath;
    viewNote.hidden = !diverged;
    if (diverged) viewNote.title = t("opt.viewing", { path: app.viewPath ?? "" });
  }
  syncSourceHead();

  const optSectionHead = el("span");
  side.append(
    el(
      "div",
      { class: "panel" },
      el("div", { class: "panel-head" }, optSectionHead),
      el(
        "div",
        { class: "panel-body" },
        sourceLabel,
        viewNote,
        guardBox,
        presetRow,
        el("div", { class: "row" }, runBtn, exportBtn),
        el("div", { class: "row run-progress" }, progressBar, progressMeta),
        logLine,
      ),
    ),
  );

  /* -------------------------------------------------------------- step rows */

  const stepsPanel = el("div", { class: "panel" });
  const stepsBody = el("div", { class: "panel-body form" });
  const stepsHead = el("span");
  stepsPanel.append(el("div", { class: "panel-head" }, stepsHead), stepsBody);
  side.append(stepsPanel);

  const texExtra = el("div", { class: "tex-extra" });

  /** (Re)builds the shared step form in the active language. */
  let form = buildOptimizeForm(stepsBody, { get: steps, edit });
  function buildForm(): void {
    clear(stepsBody);
    form = buildOptimizeForm(stepsBody, { get: steps, edit });
    // Inside the textures step block so the chips read as part of the step;
    // falls back to a standalone block if the form layout ever changes.
    for (const block of Array.from(stepsBody.querySelectorAll(".step-block"))) {
      if (block.querySelector(".step-name")?.textContent === "textures") {
        block.append(texExtra);
        break;
      }
    }
    if (!texExtra.parentElement) stepsPanel.append(texExtra);
  }
  buildForm();

  /* --------------------------------------- textures: auto presets + overrides */

  /** Seeds for the textures BASE params (per-texture overrides stay untouched). */
  const TEXTURE_AUTO: Array<{
    nameKey: string;
    format: TextureFormat;
    quality: number;
    max_size: number;
    mips: boolean;
    tipKey: string;
  }> = [
    {
      nameKey: "opt.autoMobile",
      format: "etc1s",
      quality: 128,
      max_size: 1024,
      mips: true,
      tipKey: "opt.autoMobileTip",
    },
    {
      nameKey: "opt.autoDesktop",
      format: "etc1s",
      quality: 160,
      max_size: 0,
      mips: true,
      tipKey: "opt.autoDesktopTip",
    },
    {
      nameKey: "opt.autoWeb",
      format: "etc1s",
      quality: 96,
      max_size: 2048,
      mips: true,
      tipKey: "opt.autoWebTip",
    },
  ];

  function syncTexExtra(): void {
    clear(texExtra);
    texExtra.append(
      el(
        "div",
        { class: "chip-row" },
        el("span", { class: "muted", text: t("opt.autoLabel") }),
        ...TEXTURE_AUTO.map((p) =>
          el("button", {
            class: "small",
            text: t(p.nameKey),
            title: t(p.tipKey),
            onclick: () => {
              edit((s) => {
                s.textures.format = p.format;
                s.textures.quality = p.quality;
                s.textures.max_size = p.max_size;
                s.textures.generate_mips = p.mips;
              });
              syncTexExtra();
            },
          }),
        ),
      ),
      el(
        "div",
        { class: "hint" },
        el("span", {
          text: (() => {
            const n = textureOverridesCount(app.sourcePath);
            return n > 0 ? t("opt.overridesCount", { n }) : t("opt.noOverrides");
          })(),
          title: t("opt.overridesTitle"),
        }),
        " ",
        el("button", {
          class: "small",
          text: t("opt.editInTextures"),
          title: t("opt.editInTexturesTitle"),
          onclick: () => {
            window.dispatchEvent(new CustomEvent("assetty:select-tab", { detail: "textures" }));
          },
        }),
        fieldHelpButton("textures.overrides_note"),
      ),
    );
  }

  syncTexExtra();

  function syncStatic(): void {
    optSectionHead.textContent = t("opt.section");
    stepsHead.textContent = t("opt.stepsTitle");
    reportHead.textContent = t("opt.report");
    syncCompareUI();
    syncSourceHead();
    syncEmptyHint();
    runBtn.textContent = running ? t("opt.running") : t("opt.run");
    exportBtn.textContent = exporting ? t("opt.exporting") : t("opt.export");
    exportNote.textContent = t("opt.exportNote");
    renderProgress();
  }

  function syncAll(): void {
    form.sync();
    syncTexExtra();
    runBtn.disabled = running || !app.bridge.live || !app.sourcePath;
    exportBtn.disabled = running || exporting || !lastResult;
    syncStatic();
  }

  /* ------------------------------------------------------------------ report */

  const reportHead = el("span");
  const reportBodyHost = el("div", { class: "panel-body" });
  const reportPanel = el(
    "div",
    { class: "panel" },
    el("div", { class: "panel-head" }, reportHead),
    reportBodyHost,
  );
  side.append(reportPanel);

  /** Back to the empty state: a new run supersedes the previous report. */
  function resetReport(): void {
    reportHead.textContent = t("opt.report");
    reportBodyHost.replaceChildren(el("div", { class: "empty", text: t("opt.reportEmpty") }));
  }
  resetReport();
  const exportNote = el("div", { class: "hint", text: t("opt.exportNote") });
  side.append(exportNote);
  syncAll();

  /** Renders the progress strip from the last known state. */
  function renderProgress(): void {
    progressMeta.textContent =
      progressStep || progressPct > 0
        ? `${progressStep || t("opt.working")} · ${Math.round(progressPct)}%`
        : t("opt.progressIdle");
    progressFill.style.width = `${progressPct}%`;
  }

  function setProgress(step: string, pct: number): void {
    const clamped = Math.max(0, Math.min(100, pct));
    progressStep = step;
    progressPct = clamped;
    renderProgress();
  }

  function setLog(message: string): void {
    logLine.textContent = message;
    logLine.title = message;
  }

  function setRunning(on: boolean): void {
    running = on;
    runBtn.textContent = on ? t("opt.running") : t("opt.run");
    runBtn.disabled = on || !app.bridge.live || !app.sourcePath;
    exportBtn.disabled = on || exporting || !lastResult;
    progressBar.classList.toggle("running", on);
  }

  function setExporting(on: boolean): void {
    exporting = on;
    exportBtn.textContent = on ? t("opt.exporting") : t("opt.export");
    exportBtn.disabled = running || on || !lastResult;
  }

  /** Last segment of a path (the save panel's suggested file name). */
  function basename(path: string): string {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : path;
  }

  /**
   * Explicit export: the pipeline always starts from the source model and
   * writes into `.zig-cache/…` (the source is never modified) — this copies
   * the finished file wherever the user wants it.
   */
  async function saveAs(outPath: string): Promise<void> {
    if (exporting) {
      notify(t("opt.exportBusy"), "error");
      return;
    }
    let pick: { path: string | null };
    try {
      pick = await app.bridge.pickSavePath(basename(outPath));
    } catch (err) {
      notify(t("opt.saveDlgFail", { message: (err as Error).message }), "error");
      return;
    }
    if (!pick.path) return; // cancel
    if (!app.bridge.live) {
      notify(t("opt.exportDemo"), "error");
      return;
    }
    setExporting(true);
    pendingDst = pick.path;
    setLog(t("opt.exportingTo", { path: pick.path }));
    try {
      await app.bridge.exportTo(outPath, pick.path);
    } catch (err) {
      pendingDst = null;
      setExporting(false);
      if (isBusyError(err)) {
        notify(t("opt.exportBusy"), "error");
      } else if (isMissingMethodError(err)) {
        notify(t("opt.exportNoHost"), "error");
      } else {
        notify(t("opt.exportFail", { message: (err as Error).message }), "error");
      }
    }
  }

  function stopJob(): void {
    if (doneTimer) {
      clearTimeout(doneTimer);
      doneTimer = null;
    }
    stopProgress?.();
    stopProgress = null;
    setRunning(false);
  }

  function finishJobError(message: string): void {
    stopJob();
    setProgress(t("common.failed"), 0);
    notify(t("opt.failedMsg", { message }), "error");
  }

  function renderReport(res: OptimizeResult): void {
    const { before, after, deltas, steps } = res.report;
    const body = el("div", null);
    body.append(
      el(
        "table",
        { class: "fixed" },
        el(
          "thead",
          null,
          el(
            "tr",
            null,
            el("th", { text: t("opt.colMetric") }),
            el("th", { class: "num", text: t("opt.colBefore") }),
            el("th", { class: "num", text: t("opt.colAfter") }),
            el("th", { class: "num", text: "Δ" }),
          ),
        ),
        el(
          "tbody",
          null,
          ...ROWS.map((row) => {
            const b = stat(before, row.key);
            const a = stat(after, row.key);
            const d = deltas?.[row.deltaKey ?? row.key];
            const pct = d?.pct ?? (b != null && a != null && b !== 0 ? ((a - b) / b) * 100 : null);
            const show = (n?: number) => (n == null ? "—" : row.bytes ? fmtBytes(n) : fmtNum(n));
            return el(
              "tr",
              null,
              el("td", { text: t(row.labelKey) }),
              el("td", { class: "num", text: show(b) }),
              el("td", { class: "num", text: show(a) }),
              el("td", { class: `num ${deltaClass(pct)}`, text: fmtPct(pct) }),
            );
          }),
        ),
      ),
    );

    if (steps.length > 0) {
      body.append(el("div", { class: "section-title", text: t("opt.stepsRun") }));
      const list = el("div", { class: "steps" });
      for (const s of steps) {
        list.append(
          el(
            "div",
            { class: `step ${s.applied ? "applied" : ""}` },
            el("span", { class: "mark", text: s.applied ? "✓" : "–" }),
            el("span", { text: s.kind }),
            el("span", { class: "secs", text: fmtSecs(s.secs) }),
            s.note && s.note !== "ok" ? el("span", { class: "note", text: s.note }) : null,
          ),
        );
        // Per-image rows (newer hosts): skipped state + effective format.
        if (s.kind === "textures" && s.images && s.images.length > 0) {
          for (const im of s.images) {
            const idx = im.image ?? im.index ?? -1;
            const label = [`#${idx}`, im.name ?? null].filter((p) => p).join(" ");
            list.append(
              el(
                "div",
                { class: `step-image ${im.skipped ? "skipped" : ""}` },
                el("span", { class: "mark", text: im.skipped ? "–" : "·" }),
                el("span", {
                  text: im.skipped
                    ? t("opt.imgSkipped", { label })
                    : `${label} → ${im.effective_format ?? im.format ?? "?"}`,
                  title: im.skipped ? t("opt.imgSkippedTitle") : t("opt.imgEffectiveTitle"),
                }),
              ),
            );
          }
        }
      }
      body.append(list);
    }

    body.append(
      el("button", {
        class: "path-button mono",
        text: res.out_path,
        title: `${res.out_path}\nclick to copy`,
        onclick: async () => {
          const ok = await copyText(res.out_path);
          notify(
            ok ? t("common.copied", { path: res.out_path }) : res.out_path,
            ok ? "ok" : "info",
          );
        },
      }),
      el(
        "div",
        { class: "row" },
        el("button", {
          class: "small primary",
          text: t("common.view"),
          title: t("opt.viewTitle"),
          onclick: () => {
            app.setView(res.out_path);
            notify(t("opt.viewing", { path: res.out_path }), "ok");
          },
        }),
        el("button", {
          class: "small",
          text: t("common.useAsSource"),
          title: t("opt.useTitle"),
          onclick: () => {
            app.useAsSource(res.out_path);
            notify(t("opt.sourceSet", { path: res.out_path }), "ok");
          },
        }),
        el("button", {
          class: "small",
          text: t("common.saveAs"),
          title: t("opt.saveTitle"),
          onclick: () => void saveAs(res.out_path),
        }),
      ),
    );

    reportHead.textContent = t("opt.report");
    const secs = fmtSecs(res.report.total_secs);
    reportPanel.replaceChildren(
      el(
        "div",
        { class: "panel-head" },
        reportHead,
        el("span", {
          class: "muted mono",
          text: [res.report.preset ?? "custom", secs && t("opt.totalTime", { secs })]
            .filter(Boolean)
            .join(" · "),
        }),
      ),
      el("div", { class: "panel-body" }, body),
    );
  }

  async function loadOptimized(outPath: string): Promise<void> {
    if (!right) return;
    if (!app.bridge.live) {
      right.loadDemo();
      return;
    }
    try {
      await right.loadBase64(await app.bridge.loadBytes(outPath));
    } catch (err) {
      notify(t("opt.loadOptFail", { message: (err as Error).message }), "error");
    }
  }

  // The host runs the pipeline off the UI thread and reports back here. This
  // fires even when the user switched tabs meanwhile; the closure state is
  // kept alive by the mounted tab.
  const offDone = app.bridge.onOptimizeDone((event) => {
    if (!running) return;
    if (!event.ok) {
      finishJobError(event.error);
      return;
    }
    lastResult = event.result;
    stopJob();
    setProgress(t("common.done"), 100);
    renderReport(event.result);
    noteResult(event.result);
    void loadOptimized(event.result.out_path);
    notify(t("opt.finished"), "ok");
  });

  // The copy this tab asked for (matched by dst so the Textures tab's exports
  // don't double-notify here). `notify` fans out to the toast + status bar.
  const offExport = app.bridge.onExportDone((event) => {
    if (exporting && pendingDst != null) {
      if (event.ok && event.dst === pendingDst) {
        pendingDst = null;
        setExporting(false);
        setLog(t("opt.savedTo", { path: event.dst }));
        notify(t("opt.savedTo", { path: event.dst }), "ok");
      } else if (!event.ok) {
        pendingDst = null;
        setExporting(false);
        notify(t("opt.exportFail", { message: event.error }), "error");
      }
    }
  });

  /* --------------------------------------------------------------------- run */

  function applyPreset(name: string): void {
    activePreset = name;
    const prefs = PRESET_PREFS[name.toLowerCase()];
    if (prefs) edit(prefs);
    for (const button of Array.from(presetRow.children)) {
      button.classList.toggle("active", (button as HTMLElement).textContent === name);
    }
    syncAll();
    setLog(prefs ? t("opt.presetPrefill", { name }) : t("opt.presetUnknown", { name }));
  }

  async function loadPresets(): Promise<void> {
    let names: string[] = [];
    try {
      names = await app.bridge.presets();
    } catch {
      names = [];
    }
    if (names.length === 0) names = ["mobile", "desktop", "web"];
    presetRow.replaceChildren(
      ...names.map((name) =>
        el("button", {
          class: `small preset ${name === activePreset ? "active" : ""}`,
          text: name,
          title: t("opt.presetTitle", { name }),
          onclick: () => applyPreset(name),
        }),
      ),
    );
  }

  async function loadSource(path: string): Promise<void> {
    sourceLabel.textContent = t("opt.sourceLabel", { path });
    sourceLabel.title = path;
    syncSourceHead();
    syncEmptyHint();
    syncTexExtra();
    if (!left) return;
    try {
      if (app.bridge.live) await left.loadBase64(await app.bridge.loadBytes(path));
      else left.loadDemo();
      openHint.hidden = true;
    } catch (err) {
      notify(t("opt.loadFail", { message: (err as Error).message }), "error");
      openHint.hidden = false;
    }
    runBtn.disabled = running || !app.bridge.live || !app.sourcePath;
  }

  const RUN_TIMEOUT_MS = 10 * 60 * 1000;

  /** Images of the optimize source (cached info when it matches, else fresh). */
  async function sourceImages(): Promise<ImageInfo[] | null> {
    const src = app.sourcePath;
    if (!src) return null;
    try {
      const info: Info | null =
        app.info && app.info.file === src ? app.info : await app.bridge.info(src);
      return info?.vram.images ?? null;
    } catch {
      return null;
    }
  }

  /** Guard: textures step on an already-KTX2 source would silently skip. */
  function showGuard(note: string, onRun: () => void): void {
    guardBox.replaceChildren(
      el("div", { text: note }),
      el(
        "div",
        { class: "row" },
        el("button", {
          class: "small primary",
          text: t("common.runAnyway"),
          onclick: () => {
            guardBox.hidden = true;
            guardBox.replaceChildren();
            onRun();
          },
        }),
        el("button", {
          class: "small",
          text: t("common.cancel"),
          onclick: () => {
            guardBox.hidden = true;
            guardBox.replaceChildren();
          },
        }),
      ),
    );
    guardBox.hidden = false;
  }

  async function maybeRun(): Promise<void> {
    const path = app.sourcePath;
    if (!path || running) return;
    if (steps().textures.enabled) {
      const images = await sourceImages();
      if (images && images.length > 0 && !images.some(isEncodableImage)) {
        showGuard(t("opt.ktx2Guard"), () => void doRun());
        setLog(t("opt.guardBlocked"));
        return;
      }
    }
    await doRun();
  }

  async function doRun(): Promise<void> {
    const path = app.sourcePath;
    if (!path || running) return;
    const specSteps = buildSpec(steps());
    if (specSteps.length === 0) {
      notify(t("opt.pickStep"), "error");
      return;
    }
    const specJson = JSON.stringify({ steps: specSteps });
    stopProgress?.();
    stopProgress = null;
    setRunning(true);
    /* The run supersedes the previous result: drop it before doing any work. */
    lastResult = null;
    resetReport();
    setProgress(t("opt.starting"), 0);
    try {
      const call = await app.bridge.optimizeCustom(
        path,
        specJson,
        activePreset || "desktop",
        (p) => {
          if (running) setProgress(p.step || t("opt.runningShort"), p.pct);
        },
      );
      if (call.started) {
        // Background job: Run stays disabled until optimizeDone arrives.
        stopProgress = call.stopProgress;
        if (!running) {
          // Timed out/re-enabled while the call was in flight.
          stopProgress();
          stopProgress = null;
          return;
        }
        setProgress(t("opt.runningShort"), 0);
        setLog(t("opt.runningBg"));
        doneTimer = setTimeout(() => {
          doneTimer = null;
          finishJobError(t("opt.jobTimeout"));
        }, RUN_TIMEOUT_MS);
        return;
      }

      // Older hosts: the call itself returned the finished report.
      lastResult = call.result;
      stopJob();
      setProgress(t("common.done"), 100);
      renderReport(call.result);
      noteResult(call.result);
      void loadOptimized(call.result.out_path);
      notify(t("opt.finished"), "ok");
    } catch (err) {
      stopJob();
      if (isBusyError(err)) {
        setProgress(t("opt.runningShort"), 0);
        notify(t("opt.busyMsg"), "error");
      } else {
        setProgress(t("common.failed"), 0);
        notify(t("opt.failedMsg", { message: (err as Error).message }), "error");
      }
    }
  }

  runBtn.addEventListener("click", () => void maybeRun());

  exportBtn.addEventListener("click", () => {
    if (lastResult) void saveAs(lastResult.out_path);
  });

  const offSource = app.on("source", (d) => {
    void loadSource(d.path);
  });
  const offView = app.on("view", () => {
    syncSourceHead();
  });
  const offLog = onLog((message) => setLog(message));
  // Settings can change elsewhere (Settings tab / reload from file): keep the
  // controls in sync unless this tab is the origin of the change.
  const offSettings = onSettingsChange(() => {
    if (!internalEdit) syncAll();
  });
  // Instant language switch: rebuild the shared step form (static labels),
  // then re-render every dynamic surface incl. the last report.
  const offLang = onLang(() => {
    for (const btn of Array.from(root.querySelectorAll(".help-btn"))) {
      const anchor = btn as HTMLElement;
      anchor.title = t("help.whatDoes");
      anchor.setAttribute("aria-label", t("help.aria", { id: anchor.dataset.help ?? "" }));
    }
    buildForm();
    if (lastResult) renderReport(lastResult);
    else resetReport();
    syncAll();
  });

  return {
    el: root,
    activate: () => {
      if (!left) {
        try {
          left = new ViewerScene(leftPane.canvas, "original");
          right = new ViewerScene(rightPane.canvas, "optimized");
          if (!linked) {
            linked = true;
            linkCameras(left, right);
          }
          // Headless checks need both panes (the shared hook only exposes the
          // Viewer tab's scene) plus the compare-mode state.
          const dbg = (window as unknown as Record<string, unknown>)["__assetty"] as
            | Record<string, unknown>
            | undefined;
          if (dbg) {
            dbg["panes"] = () => ({ left, right });
            dbg["compare"] = () => ({
              mode: compareMode,
              split: splitPos,
              hasResult: lastResult !== null,
            });
            dbg["setCompareMode"] = (mode: string) =>
              setCompareMode(mode === "split" ? "split" : "side");
          }
          if (app.sourcePath) void loadSource(app.sourcePath);
          else if (!app.bridge.live) {
            left.loadDemo();
            right.loadDemo();
          } else {
            openHint.hidden = false;
          }
        } catch (err) {
          notify(t("viewer.webglFail", { reason: (err as Error).message }), "error");
        }
      } else {
        left.resume();
        right?.resume();
      }
      // The canvas was `display: none` while the tab was hidden: the observer's
      // 0×0 notifications were (correctly) ignored, so re-sync once the pane
      // actually has a box again.
      left?.forceResize();
      right?.forceResize();
      void loadPresets();
      syncAll();
      syncCompareUI();
    },
    deactivate: () => {
      closeFieldHelp();
      left?.pause();
      right?.pause();
    },
    dispose: () => {
      offSource();
      offView();
      offLog();
      offSettings();
      offLang();
      offDone();
      offExport();
      stopJob();
      setSplitSync(false);
      left?.dispose();
      right?.dispose();
      left = null;
      right = null;
    },
  };
}
