/**
 * Optimize tab: run/export/discard flows, progress strip, log line, presets,
 * and the options panel. Owns the job state and backend subscriptions.
 */
import { app } from "../../app";
import { isBusyError, notifyExportError, pickSaveTarget } from "../../guards";
import { t } from "../../i18n";
import { el } from "../../ui";
import { getSettings, getTextureOverrides, updateSettings } from "../../settings";
import type { OptimizeSteps } from "../../settings";
import { notify, onLog } from "../../notify";
import type { ImageInfo, Info, OptimizeResult } from "../../types";
import type { DualApi } from "./dual";

/** Encodable by the textures step: anything that is not already KTX2/basis. */
export function isEncodableImage(img: ImageInfo): boolean {
  return !/ktx2|basis/i.test(img.format ?? "");
}

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

const RUN_TIMEOUT_MS = 10 * 60 * 1000;

export interface RunDeps {
  dual: DualApi;
  getResult(): OptimizeResult | null;
  /** A run started: forget the previous result/report (numbers clear). */
  onRunStarted(): void;
  /** A run finished: store + render + compare the new result. */
  onFinished(res: OptimizeResult): void;
  /** Discard confirmed on the host: forget the artifact, keep the numbers. */
  onDiscarded(outPath: string): void;
  refreshTexExtra(): void;
}

export interface RunApi {
  panel: HTMLElement;
  exportNote: HTMLElement;
  edit(mutate: (steps: OptimizeSteps) => void): void;
  isInternalEdit(): boolean;
  /** Step edits from elsewhere (Settings tab) pull the Run button state along. */
  syncControls(): void;
  syncTexts(): void;
  syncSourceHead(): void;
  loadSource(path: string): Promise<void>;
  loadPresets(): Promise<void>;
  saveAs(outPath: string): Promise<void>;
  discardResult(outPath: string): Promise<void>;
  dispose(): void;
}

export function createRunFlow(deps: RunDeps): RunApi {
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
  const exportNote = el("div", { class: "hint", text: t("opt.exportNote") });

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
  const panel = el(
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
  );

  const offLog = onLog((message) => setLog(message));

  /** True while a background job owns the backend (Run stays disabled). */
  let running = false;
  /** True while an exportTo copy is in flight (Save as… stays disabled). */
  let exporting = false;
  /** `dst` of the in-flight export; only the matching exportDone notifies. */
  let pendingDst: string | null = null;
  /** Last progress state, so a language switch can re-render the strip. */
  let progressStep = "";
  let progressPct = 0;
  /** Texture sub-progress (optimize-textures step): `{done,total}`, max kept. */
  let progressDone = -1;
  let progressTotal = 0;
  let doneTimer: ReturnType<typeof setTimeout> | null = null;
  let stopProgress: (() => void) | null = null;

  /** Renders the progress strip from the last known state. */
  function renderProgress(): void {
    const base =
      progressStep || progressPct > 0
        ? `${progressStep || t("opt.working")} · ${Math.round(progressPct)}%`
        : t("opt.progressIdle");
    progressMeta.textContent =
      progressDone >= 0
        ? `${base} · ${t("progress.texture", { done: progressDone, total: progressTotal })}`
        : base;
    progressFill.style.width = `${progressPct}%`;
  }

  function setProgress(step: string, pct: number, sub?: { done: number; total: number }): void {
    const clamped = Math.max(0, Math.min(100, pct));
    progressStep = step;
    progressPct = clamped;
    if (sub) {
      progressDone = Math.max(progressDone, sub.done);
      progressTotal = sub.total;
    } else {
      // Outside the textures step the payload carries no sub: revert to plain.
      resetSub();
    }
    renderProgress();
  }

  /** Clears the texture sub-progress (new run / finished job). */
  function resetSub(): void {
    progressDone = -1;
    progressTotal = 0;
  }

  function setLog(message: string): void {
    logLine.textContent = message;
    logLine.title = message;
  }

  function setRunning(on: boolean): void {
    running = on;
    runBtn.textContent = on ? t("opt.running") : t("opt.run");
    runBtn.disabled = on || !app.bridge.live || !app.sourcePath;
    exportBtn.disabled = on || exporting || !deps.getResult();
    progressBar.classList.toggle("running", on);
  }

  function setExporting(on: boolean): void {
    exporting = on;
    exportBtn.textContent = on ? t("opt.exporting") : t("opt.export");
    exportBtn.disabled = running || on || !deps.getResult();
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
    const dst = await pickSaveTarget(outPath);
    if (!dst) return; // cancel, no host, or dialog failure (already toasted)
    setExporting(true);
    pendingDst = dst;
    setLog(t("opt.exportingTo", { path: dst }));
    try {
      await app.bridge.exportTo(outPath, dst);
    } catch (err) {
      pendingDst = null;
      setExporting(false);
      notifyExportError(err);
    }
  }

  /**
   * "This optimization didn't please me": deletes the result file on the host
   * and forgets the artifact. The report numbers stay — only the file (and
   * everything pointing at it) goes: the banner hides, Export disables,
   * Split falls back to side-by-side, and a view of the deleted file returns
   * to the source.
   */
  async function discardResult(outPath: string): Promise<void> {
    try {
      await app.bridge.discardFile(outPath);
    } catch (err) {
      notify(t("opt.discardFail", { message: (err as Error).message }), "error");
      return;
    }
    deps.onDiscarded(outPath);
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
    resetSub();
    setProgress(t("common.failed"), 0);
    notify(t("opt.failedMsg", { message }), "error");
  }

  async function loadOptimized(outPath: string): Promise<void> {
    if (!app.bridge.live) {
      deps.dual.loadRightDemo();
      return;
    }
    try {
      await deps.dual.loadRightLive(await app.bridge.loadBytes(outPath));
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
    stopJob();
    resetSub();
    setProgress(t("common.done"), 100);
    deps.onFinished(event.result);
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
    deps.dual.syncEmptyHint();
    deps.refreshTexExtra();
    try {
      if (app.bridge.live) await deps.dual.loadLeftLive(await app.bridge.loadBytes(path));
      else deps.dual.loadLeftDemo();
      deps.dual.hideOpenHint();
    } catch (err) {
      notify(t("opt.loadFail", { message: (err as Error).message }), "error");
      deps.dual.showOpenHint();
    }
    runBtn.disabled = running || !app.bridge.live || !app.sourcePath;
  }

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
    deps.onRunStarted();
    resetSub();
    setProgress(t("opt.starting"), 0);
    try {
      const call = await app.bridge.optimizeCustom(
        path,
        specJson,
        activePreset || "desktop",
        (p) => {
          if (running)
            setProgress(
              p.step || t("opt.runningShort"),
              p.pct,
              p.sub?.label === "texture" ? { done: p.sub.done, total: p.sub.total } : undefined,
            );
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
      stopJob();
      resetSub();
      setProgress(t("common.done"), 100);
      deps.onFinished(call.result);
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
    const res = deps.getResult();
    if (res) void saveAs(res.out_path);
  });

  return {
    panel,
    exportNote,
    edit,
    isInternalEdit: () => internalEdit,
    syncControls: () => {
      runBtn.disabled = running || !app.bridge.live || !app.sourcePath;
      exportBtn.disabled = running || exporting || !deps.getResult();
    },
    syncSourceHead,
    syncTexts: () => {
      optSectionHead.textContent = t("opt.section");
      syncSourceHead();
      runBtn.textContent = running ? t("opt.running") : t("opt.run");
      exportBtn.textContent = exporting ? t("opt.exporting") : t("opt.export");
      exportNote.textContent = t("opt.exportNote");
      renderProgress();
    },
    loadSource,
    loadPresets,
    saveAs,
    discardResult,
    dispose: () => {
      offDone();
      offExport();
      offLog();
      stopJob();
    },
  };
}
