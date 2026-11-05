/**
 * Optimize tab: run/export/discard flows, progress strip, log line, presets,
 * and the options panel. Owns the job state and backend subscriptions.
 */
import { app } from "../../app";
import { isBusyError, notifyExportError, pickSaveTarget } from "../../guards";
import { t } from "../../i18n";
import { el, fmtSecs } from "../../ui";
import { getSettings, getTextureOverrides, updateSettings } from "../../settings";
import type { OptimizeSteps, TextureOverride } from "../../settings";
import { notify, onLog } from "../../notify";
import type { ImageInfo, Info, OptimizeResult } from "../../types";
import type { LodsItem, PresetEntry } from "../../bridge";
import type { DualApi } from "./dual";

/** Pipeline stages shown as chips. Geometry merges every mesh-op step kind
 * the backend reports (prune/dedup/weld/join/simplify/quantize); textures and
 * write map 1:1. Unknown future step names resolve to null (chip stays put). */
type StageId = "load" | "geometry" | "textures" | "write" | "done";

const GEOMETRY_KINDS = new Set(["prune", "dedup", "weld", "join", "simplify", "quantize"]);

function stageForStep(raw: string): StageId | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "load" || s.startsWith("load")) return "load";
  if (s === "write" || s.startsWith("writ")) return "write";
  if (s === "done" || s === "complete" || s === "finished") return "done";
  if (GEOMETRY_KINDS.has(s)) return "geometry";
  if (
    s.includes("texture") ||
    s.includes("ktx") ||
    s.includes("basis") ||
    s.includes("image") ||
    s.includes("encode")
  )
    return "textures";
  if (
    s.includes("geometr") ||
    s.includes("mesh") ||
    s.includes("prune") ||
    s.includes("dedup") ||
    s.includes("weld") ||
    s.includes("join") ||
    s.includes("simplif") ||
    s.includes("quant")
  )
    return "geometry";
  return null;
}

/** Stages that will run, inferred from the spec at Run time (no future-step
 * announcements on the wire): load + write + done always, geometry iff any
 * mesh-op step is checked, textures iff the textures step is checked. */
function planStages(spec: Array<Record<string, unknown>>): StageId[] {
  const kinds = new Set(spec.map((s) => String(Object.keys(s)[0] ?? "").toLowerCase()));
  const plan: StageId[] = ["load"];
  if ([...kinds].some((k) => GEOMETRY_KINDS.has(k))) plan.push("geometry");
  if (kinds.has("textures")) plan.push("textures");
  plan.push("write", "done");
  return plan;
}

function stageLabel(id: StageId): string {
  switch (id) {
    case "load":
      return t("opt.stageLoad");
    case "geometry":
      return t("opt.stageGeometry");
    case "textures":
      return t("opt.stageTextures");
    case "write":
      return t("opt.stageWrite");
    case "done":
      return t("opt.stageDone");
  }
}

/** Live elapsed clock (mm:ss, tabular). */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

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
    const prune: Record<string, unknown> = {
      unused_nodes: steps.prune.unused_nodes,
      unused_materials: steps.prune.unused_materials,
      unused_textures: steps.prune.unused_textures,
    };
    // Backend default keeps animations; only send the flag when stripping.
    if (!steps.prune.animations) prune["animations"] = false;
    out.push({ prune });
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
  /** A ladder started: clear the previous LOD table. */
  onLodsStarted(): void;
  /** A ladder finished: render the per-ratio table. */
  onLodsFinished(items: LodsItem[]): void;
  refreshTexExtra(): void;
  /** Re-reads settings into the step form (after programmatic edits). */
  syncStepsForm(): void;
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
  /** Loads a finished file (optimize result or LOD rung) into the viewer. */
  viewResult(outPath: string): Promise<void>;
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
  // Last built-in chip (user presets are specs the fallback path can't name).
  let fallbackPreset = "desktop";

  const sourceLabel = el("div", { class: "mono muted wrap" });
  const viewNote = el("div", { class: "amber-note" });
  viewNote.hidden = true;
  const presetRow = el("div", { class: "preset-row" });
  const runBtn = el("button", { class: "primary", disabled: true });
  const lodBtn = el("button", {
    disabled: true,
    title: t("opt.lodsTitle"),
    onclick: () => void generateLods(),
  });
  const exportBtn = el("button", { disabled: true });
  /** Compact progress strip: lives with the Run button so it stays visible. */
  const progressFill = el("div");
  const progressMeta = el("span", { class: "run-progress-meta" });
  const progressBar = el("div", { class: "progress grow" }, progressFill);
  /** Stage chips (`load → geometry → textures → write → done`): one row above
   * the numeric bar. Always in the DOM (reserved min-height) so the report
   * below never shifts; empty until the first run plans it. */
  const chipsRow = el("div", { class: "stage-row" });
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
      el("div", { class: "row" }, runBtn, lodBtn, exportBtn),
      chipsRow,
      el("div", { class: "row run-progress" }, progressBar, progressMeta),
      logLine,
    ),
  );

  const offLog = onLog((message) => setLog(message));

  /** True while a background job owns the backend (Run stays disabled). */
  let running = false;
  /** Which job owns the gate: an optimize run or an LOD ladder. */
  let jobKind: "optimize" | "lods" | null = null;
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
  /** LOD ladder sub-progress (`{label:"lods"}`): current rung, max kept. */
  let lodsDone = -1;
  let lodsTotal = 0;
  let doneTimer: ReturnType<typeof setTimeout> | null = null;
  let stopProgress: (() => void) | null = null;
  /** Stage chips: the plan (hidden-if-not-run) + the active stage. Done-all
   * persists until the next run; a source change clears the plan. */
  let stagePlan: StageId[] = [];
  let stageActive: StageId | null = null;
  let stageDoneAll = false;
  /** Elapsed clock: 1 Hz while running, frozen total at completion. */
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let runStartMs = 0;
  let elapsedFrozen: string | null = null;
  /** Last source the chips were planned/cleared for (loadSource also fires on
   * plain tab switches — only a real path change resets the chips). */
  let chipSource: string | null = null;

  function stopClock(): void {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function startClock(): void {
    stopClock();
    runStartMs = Date.now();
    elapsedFrozen = null;
    elapsedTimer = setInterval(() => {
      if (running) renderProgress();
    }, 1000);
  }

  /** Freeze the clock: report total_secs preferred, live timer fallback. */
  function freezeClock(totalSecs?: number): void {
    stopClock();
    elapsedFrozen =
      totalSecs != null && Number.isFinite(totalSecs)
        ? fmtSecs(totalSecs)
        : fmtElapsed(Date.now() - runStartMs);
    renderProgress();
  }

  /** Renders the stage chips from the plan + active stage + texture sub. */
  function renderChips(): void {
    chipsRow.replaceChildren();
    chipsRow.title = running ? t("opt.workingNow") : "";
    if (stagePlan.length === 0) return;
    const activeIdx = stageActive != null ? stagePlan.indexOf(stageActive) : -1;
    stagePlan.forEach((id, i) => {
      if (i > 0) chipsRow.append(el("span", { class: "stage-sep", text: "→" }));
      const done = stageDoneAll || (activeIdx >= 0 && i < activeIdx);
      const active = !stageDoneAll && running && i === activeIdx;
      const chip = el("span", {
        class: `stage-chip${done ? " done" : ""}${active ? " active" : ""}`,
      });
      chip.dataset.stage = id;
      if (active) chip.append(el("span", { class: "stage-spin", "aria-hidden": "true" }));
      chip.append(el("span", { class: "stage-label", text: stageLabel(id) }));
      if (done) chip.append(el("span", { class: "stage-mark", text: "✓" }));
      if (id === "textures" && progressDone >= 0) {
        const frac = progressTotal > 0 ? Math.max(0, Math.min(1, progressDone / progressTotal)) : 0;
        const mini = el(
          "span",
          { class: "stage-subbar" },
          el("span", { style: { width: `${frac * 100}%` } }),
        );
        chip.append(
          el("span", {
            class: "stage-sub",
            text: t("progress.texture", { done: progressDone, total: progressTotal }),
          }),
          mini,
        );
      }
      // LOD ladders ride the same chips; the rung counter hangs off the
      // active one (rungs report their own step names underneath).
      if (active && lodsDone >= 0 && lodsTotal > 0) {
        const shown = Math.min(lodsDone + 1, lodsTotal);
        const frac = shown / lodsTotal;
        const mini = el(
          "span",
          { class: "stage-subbar" },
          el("span", { style: { width: `${frac * 100}%` } }),
        );
        chip.append(
          el("span", {
            class: "stage-sub",
            text: t("progress.lods", { done: shown, total: lodsTotal }),
          }),
          mini,
        );
      }
      chipsRow.append(chip);
    });
  }

  /** Clears the chips (new run plans them again; failures blank them). */
  function resetStages(): void {
    stagePlan = [];
    stageActive = null;
    stageDoneAll = false;
    stopClock();
    elapsedFrozen = null;
    renderProgress();
    renderChips();
  }

  /** Renders the progress strip from the last known state. */
  function renderProgress(): void {
    const base =
      progressStep || progressPct > 0
        ? `${progressStep || t("opt.working")} · ${Math.round(progressPct)}%`
        : t("opt.progressIdle");
    const clock = elapsedFrozen ?? (running ? fmtElapsed(Date.now() - runStartMs) : null);
    progressMeta.textContent = clock ? `${base} · ${clock}` : base;
    progressMeta.title = clock ? t("opt.elapsedTitle") : "";
    progressFill.style.width = `${progressPct}%`;
  }

  function setProgress(
    step: string,
    pct: number,
    sub?: { label: string; done: number; total: number },
  ): void {
    const clamped = Math.max(0, Math.min(100, pct));
    progressStep = step;
    progressPct = clamped;
    // Backend steps are raw ("load", mesh-op kinds, "textures", "write");
    // localized frame strings ("starting…", "running…") resolve to null.
    const st = stageForStep(step);
    if (st && st !== "done" && stagePlan.includes(st)) stageActive = st;
    if (sub) {
      if (sub.label === "lods") {
        lodsDone = Math.max(lodsDone, sub.done);
        lodsTotal = sub.total;
      } else if (sub.label === "texture") {
        progressDone = Math.max(progressDone, sub.done);
        progressTotal = sub.total;
      }
    } else {
      // Outside the textures step the payload carries no sub: revert to plain.
      resetSub();
    }
    renderProgress();
    renderChips();
  }

  /** Clears the texture + LOD sub-progress (new run / finished job). */
  function resetSub(): void {
    progressDone = -1;
    progressTotal = 0;
    lodsDone = -1;
    lodsTotal = 0;
  }

  function setLog(message: string): void {
    logLine.textContent = message;
    logLine.title = message;
  }

  function setRunning(on: boolean): void {
    running = on;
    if (on) startClock();
    else stopClock();
    runBtn.textContent = on ? t("opt.running") : t("opt.run");
    lodBtn.textContent = on ? t("opt.lodsRunning") : t("opt.lods");
    runBtn.disabled = on || !app.bridge.live || !app.sourcePath;
    lodBtn.disabled = on || !app.bridge.live || !app.sourcePath;
    exportBtn.disabled = on || exporting || !deps.getResult();
    progressBar.classList.toggle("running", on);
    renderChips();
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
    jobKind = null;
    setRunning(false);
  }

  function finishJobError(message: string): void {
    stopJob();
    resetSub();
    resetStages();
    freezeClock();
    setProgress(t("common.failed"), 0);
    notify(t("opt.failedMsg", { message }), "error");
  }

  async function loadOptimized(outPath: string): Promise<void> {
    return viewResult(outPath);
  }

  /** Loads a finished file into the right compare pane (result or LOD rung). */
  async function viewResult(outPath: string): Promise<void> {
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
    if (!running || jobKind !== "optimize") return;
    if (!event.ok) {
      finishJobError(event.error);
      return;
    }
    stopJob();
    resetSub();
    stageActive = "done";
    stageDoneAll = true;
    freezeClock(event.result.report.total_secs);
    setProgress(t("common.done"), 100);
    deps.onFinished(event.result);
    void loadOptimized(event.result.out_path);
    notify(t("opt.finished"), "ok");
  });

  // The ladder this tab asked for reports back here (same threading notes as
  // the optimize run above). Rungs arrive as `progress` with
  // `sub: {label:"lods", done, total}`; the table lands in one `lodsDone`.
  const offLodsDone = app.bridge.onLodsDone((event) => {
    if (!running || jobKind !== "lods") return;
    if (!event.ok) {
      stopJob();
      resetSub();
      resetStages();
      freezeClock();
      setProgress(t("common.failed"), 0);
      notify(t("opt.lodsFailedMsg", { message: event.error }), "error");
      return;
    }
    stopJob();
    resetSub();
    stageActive = "done";
    stageDoneAll = true;
    const total = event.results.reduce((acc, item) => acc + (item.secs ?? 0), 0);
    freezeClock(total > 0 ? total : undefined);
    setProgress(t("common.done"), 100);
    deps.onLodsFinished(event.results);
    notify(t("opt.lodsFinished"), "ok");
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
    fallbackPreset = name;
    const prefs = PRESET_PREFS[name.toLowerCase()];
    if (prefs) edit(prefs);
    renderPresetRow();
    deps.syncStepsForm();
    setLog(prefs ? t("opt.presetPrefill", { name }) : t("opt.presetUnknown", { name }));
  }

  /* ------------------------------------------- user presets (JSON, on disk) */

  let builtinNames: string[] = ["mobile", "desktop", "web"];
  let userNames: string[] = [];
  let menuOpen = false;
  /** Delete button awaiting its second click (inline confirm, never confirm()). */
  let confirmDelete: string | null = null;
  let saveOpen = false;
  /** Save input, preserved across re-renders; defaults to the last saved name. */
  let saveName = "";

  /** True when user presets can be saved: live host with the binding, or demo. */
  function canSaveUserPresets(): boolean {
    if (!app.bridge.live) return true;
    return app.bridge.native?.methods.includes("presetSaveJson") ?? false;
  }

  async function loadPresets(): Promise<void> {
    let entries: PresetEntry[] = [];
    try {
      entries = await app.bridge.presets();
    } catch {
      entries = [];
    }
    if (entries.length === 0) {
      entries = ["mobile", "desktop", "web"].map((name) => ({
        name,
        kind: "builtin" as const,
        file: `${name}.zon`,
      }));
    }
    builtinNames = entries.filter((e) => e.kind !== "user").map((e) => e.name);
    if (builtinNames.length === 0) builtinNames = ["mobile", "desktop", "web"];
    userNames = entries.filter((e) => e.kind === "user").map((e) => e.name);
    renderPresetRow();
  }

  /** Rebuilds the preset row from state: builtin chips, My presets, Save. */
  function renderPresetRow(): void {
    const chips = builtinNames.map((name) =>
      el("button", {
        class: `small preset${name === activePreset ? " active" : ""}`,
        text: name,
        title: t("opt.presetTitle", { name }),
        onclick: () => applyPreset(name),
      }),
    );

    const menu = el("div", { class: "preset-menu", hidden: !menuOpen, role: "menu" });
    if (userNames.length === 0) {
      menu.append(el("div", { class: "preset-menu-empty", text: t("opt.myPresetsEmpty") }));
    } else {
      for (const name of userNames) {
        const row = el("div", { class: "preset-menu-row", role: "menuitem" });
        row.append(
          el("button", {
            class: "preset-load",
            text: name,
            title: t("opt.presetTitle", { name }),
            onclick: () => {
              menuOpen = false;
              confirmDelete = null;
              void loadUserPreset(name);
            },
          }),
          confirmDelete === name
            ? el("button", {
                class: "small danger",
                text: t("opt.presetDeleteSure"),
                title: t("opt.presetDeleteTitle", { name }),
                onclick: () => void deleteUserPreset(name),
              })
            : el("button", {
                class: "small preset-del",
                text: "×",
                title: t("opt.presetDeleteTitle", { name }),
                "aria-label": t("opt.presetDeleteTitle", { name }),
                onclick: (ev: Event) => {
                  ev.stopPropagation();
                  confirmDelete = name;
                  renderPresetRow();
                },
              }),
        );
        menu.append(row);
      }
    }
    const myBtn = el("button", {
      class: "small",
      text: t("opt.myPresets", { n: userNames.length }),
      title: t("opt.myPresetsTitle"),
      "aria-expanded": menuOpen ? "true" : "false",
      onclick: (ev: Event) => {
        ev.stopPropagation();
        menuOpen = !menuOpen;
        confirmDelete = null;
        renderPresetRow();
      },
    });
    const myWrap = el("div", { class: "preset-menu-wrap" }, myBtn, menu);

    const saveBtn = el("button", {
      class: "small",
      text: t("opt.presetSaveShow"),
      title: canSaveUserPresets() ? t("opt.presetSaveTitle") : t("opt.presetNoSaveHost"),
      disabled: !canSaveUserPresets(),
      onclick: (ev: Event) => {
        ev.stopPropagation();
        saveOpen = !saveOpen;
        renderPresetRow();
        saveInput()?.focus();
      },
    });
    const saveWrap = el("div", { class: "preset-save-wrap" }, saveBtn);
    if (saveOpen) {
      const input = el("input", {
        class: "compact preset-name",
        type: "text",
        value: saveName,
        placeholder: t("opt.presetNamePh"),
        "aria-label": t("opt.presetNamePh"),
        maxlength: 64,
        oninput: (ev: Event) => {
          saveName = (ev.target as HTMLInputElement).value;
        },
        onkeydown: (ev: KeyboardEvent) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            void saveUserPreset();
          } else if (ev.key === "Escape") {
            saveOpen = false;
            renderPresetRow();
          }
        },
      });
      saveWrap.append(
        input,
        el("button", {
          class: "small primary",
          text: t("opt.presetSaveBtn"),
          onclick: () => void saveUserPreset(),
        }),
      );
    }
    presetRow.replaceChildren(...chips, myWrap, saveWrap);
  }

  function saveInput(): HTMLInputElement | null {
    return presetRow.querySelector("input.preset-name");
  }

  /** Clicks outside the row close the open menu (and disarm a delete). */
  document.addEventListener("click", (ev) => {
    if (!menuOpen && confirmDelete == null) return;
    const target = ev.target as Node | null;
    if (target && presetRow.contains(target)) return;
    menuOpen = false;
    confirmDelete = null;
    renderPresetRow();
  });

  /** Copies one step's params from a loaded spec (tolerant: wrong types keep current). */
  function applySpecSteps(entries: unknown[]): void {
    const overrides: TextureOverride[] = [];
    edit((steps) => {
      steps.prune.enabled = false;
      steps.dedup.enabled = false;
      steps.weld.enabled = false;
      steps.join.enabled = false;
      steps.textures.enabled = false;
      steps.quantize.enabled = false;
      steps.simplify.enabled = false;
      const flag = (v: unknown, fallback: boolean): boolean =>
        typeof v === "boolean" ? v : fallback;
      const num = (v: unknown, fallback: number, min: number, max: number): number =>
        typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const keys = Object.keys(entry);
        if (keys.length === 0) continue;
        const kind = keys[0];
        const raw = (entry as Record<string, unknown>)[kind];
        const p = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<
          string,
          unknown
        >;
        switch (kind) {
          case "prune":
            steps.prune.enabled = true;
            steps.prune.unused_nodes = flag(p.unused_nodes, true);
            steps.prune.unused_materials = flag(p.unused_materials, true);
            steps.prune.unused_textures = flag(p.unused_textures, true);
            steps.prune.animations = flag(p.animations, true);
            break;
          case "dedup":
            steps.dedup.enabled = true;
            steps.dedup.accessors = flag(p.accessors, true);
            steps.dedup.meshes = flag(p.meshes, true);
            steps.dedup.materials = flag(p.materials, true);
            break;
          case "weld":
            steps.weld.enabled = true;
            steps.weld.tolerance = num(p.tolerance, 0, 0, 1);
            break;
          case "join":
            steps.join.enabled = true;
            break;
          case "textures": {
            steps.textures.enabled = true;
            const format = p.format;
            if (format === "auto" || format === "etc1s" || format === "uastc") {
              steps.textures.format = format;
            }
            steps.textures.quality = Math.round(num(p.quality, 128, 1, 255));
            steps.textures.max_size = Math.round(num(p.max_size, 0, 0, 8192));
            steps.textures.generate_mips = flag(p.generate_mips, true);
            const list = p.overrides;
            if (Array.isArray(list)) {
              for (const item of list) {
                if (!item || typeof item !== "object" || Array.isArray(item)) continue;
                const fields = item as Record<string, unknown>;
                const ov: TextureOverride = {};
                if (
                  typeof fields.image === "number" &&
                  Number.isFinite(fields.image) &&
                  Math.round(fields.image) >= 0
                ) {
                  ov.image = Math.round(fields.image);
                }
                if (typeof fields.name === "string" && fields.name.trim()) {
                  ov.name = fields.name;
                }
                if (
                  fields.format === "auto" ||
                  fields.format === "etc1s" ||
                  fields.format === "uastc"
                ) {
                  ov.format = fields.format;
                }
                if (typeof fields.quality === "number" && Number.isFinite(fields.quality)) {
                  ov.quality = Math.round(Math.min(255, Math.max(1, fields.quality)));
                }
                if (typeof fields.max_size === "number" && Number.isFinite(fields.max_size)) {
                  ov.max_size = Math.round(Math.min(8192, Math.max(0, fields.max_size)));
                }
                for (const key of ["generate_mips", "skip", "normal_map"] as const) {
                  if (typeof fields[key] === "boolean") ov[key] = fields[key] as boolean;
                }
                if (Object.keys(ov).length > 0) overrides.push(ov);
              }
            }
            break;
          }
          case "quantize":
            steps.quantize.enabled = true;
            steps.quantize.position_bits = Math.round(num(p.position_bits, 14, 8, 16));
            steps.quantize.uv_bits = Math.round(num(p.uv_bits, 12, 8, 16));
            steps.quantize.normal_oct = flag(p.normal_oct, true);
            break;
          case "simplify":
            steps.simplify.enabled = true;
            steps.simplify.target_ratio = num(p.target_ratio, 0.5, 0.1, 1);
            steps.simplify.error_tolerance = num(p.error_tolerance, 0.001, 0.0001, 0.05);
            steps.simplify.aggressive = flag(p.aggressive, false);
            steps.simplify.lock_borders = flag(p.lock_borders, true);
            steps.simplify.use_attributes = flag(p.use_attributes, false);
            steps.simplify.weight_normal = num(p.weight_normal, 1, 0, 10);
            steps.simplify.weight_uv = num(p.weight_uv, 1, 0, 10);
            break;
          default:
            break; // unknown future kinds: ignore (forward-compat)
        }
      }
    });
    // Overrides ride in the spec (buildSpec merges them); put them back on
    // this source when the preset carries some, leave this model's own alone
    // otherwise.
    if (overrides.length > 0 && app.sourcePath) {
      const src = app.sourcePath;
      updateSettings((settings) => {
        settings.optimize.per_model[src] = { textures: { overrides } };
      });
    }
    deps.syncStepsForm();
  }

  /** Loads a user preset into the step form (the form stays the editor). */
  async function loadUserPreset(name: string): Promise<void> {
    let text: string;
    try {
      text = await app.bridge.presetLoad(name);
    } catch (err) {
      notify(t("opt.presetLoadFail", { message: (err as Error).message }), "error");
      return;
    }
    let spec: unknown;
    try {
      spec = JSON.parse(text);
    } catch {
      notify(t("opt.presetInvalid"), "error");
      return;
    }
    const entries = (spec as { steps?: unknown })?.steps;
    if (!Array.isArray(entries) || entries.length === 0) {
      notify(t("opt.presetInvalid"), "error");
      return;
    }
    activePreset = name;
    saveName = name;
    applySpecSteps(entries);
    renderPresetRow();
    setLog(t("opt.presetLoaded", { name }));
    notify(t("opt.presetLoaded", { name }), "ok");
  }

  /** Saves the CURRENT form state as `{"name","steps"}` (the optimize spec). */
  async function saveUserPreset(): Promise<void> {
    const name = saveName.trim();
    if (!name) {
      notify(t("opt.presetNameEmpty"), "error");
      return;
    }
    const specSteps = buildSpec(steps());
    if (specSteps.length === 0) {
      notify(t("opt.pickStep"), "error");
      return;
    }
    try {
      await app.bridge.presetSaveJson(name, JSON.stringify({ name, steps: specSteps }));
    } catch (err) {
      notify(t("opt.presetSaveFail", { message: (err as Error).message }), "error");
      return;
    }
    activePreset = name;
    saveOpen = false;
    notify(t("opt.presetSaved", { name }), "ok");
    setLog(t("opt.presetSaved", { name }));
    await loadPresets();
  }

  /** Deletes a user preset (builtin names never reach here: no button). */
  async function deleteUserPreset(name: string): Promise<void> {
    confirmDelete = null;
    try {
      await app.bridge.presetDelete(name);
    } catch (err) {
      notify(t("opt.presetDeleteFail", { message: (err as Error).message }), "error");
      await loadPresets();
      return;
    }
    if (activePreset === name) activePreset = "";
    if (saveName === name) saveName = "";
    notify(t("opt.presetDeleted", { name }), "ok");
    await loadPresets();
  }

  async function loadSource(path: string): Promise<void> {
    if (chipSource !== path) {
      chipSource = path;
      resetStages();
    }
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
    lodBtn.disabled = running || !app.bridge.live || !app.sourcePath;
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

  /** Rungs from the source: `optimizeLODs(path, spec, "[0.5,0.25,0.1]")`. */
  const LOD_LADDER = [0.5, 0.25, 0.1];

  function forwardSub(p: {
    sub?: { label: string; done: number; total: number };
  }): { label: string; done: number; total: number } | undefined {
    if (p.sub?.label === "texture" || p.sub?.label === "lods") {
      return { label: p.sub.label, done: p.sub.done, total: p.sub.total };
    }
    return undefined;
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
    jobKind = "optimize";
    setRunning(true);
    /* The run supersedes the previous result: drop it before doing any work. */
    deps.onRunStarted();
    resetSub();
    stagePlan = planStages(specSteps);
    stageActive = "load";
    stageDoneAll = false;
    renderChips();
    setProgress(t("opt.starting"), 0);
    try {
      const call = await app.bridge.optimizeCustom(path, specJson, fallbackPreset, (p) => {
        if (running) setProgress(p.step || t("opt.runningShort"), p.pct, forwardSub(p));
      });
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
      stageActive = "done";
      stageDoneAll = true;
      freezeClock(call.result.report.total_secs);
      setProgress(t("common.done"), 100);
      deps.onFinished(call.result);
      void loadOptimized(call.result.out_path);
      notify(t("opt.finished"), "ok");
    } catch (err) {
      stopJob();
      resetSub();
      resetStages();
      if (isBusyError(err)) {
        setProgress(t("opt.runningShort"), 0);
        notify(t("opt.busyMsg"), "error");
      } else {
        freezeClock();
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

  /* ------------------------------------------------------------ LOD ladder */

  async function generateLods(): Promise<void> {
    const path = app.sourcePath;
    if (!path || running) return;
    if (!app.bridge.live) {
      notify(t("opt.lodsDemo"), "error");
      return;
    }
    // The current form spec is the base: same steps, simplify overridden per
    // rung on the host. Each rung starts from the source — no compounding.
    const specSteps = buildSpec(steps());
    if (specSteps.length === 0) {
      notify(t("opt.pickStep"), "error");
      return;
    }
    const specJson = JSON.stringify({ steps: specSteps });
    stopProgress?.();
    stopProgress = null;
    jobKind = "lods";
    setRunning(true);
    deps.onLodsStarted();
    resetSub();
    stagePlan = planStages(specSteps);
    stageActive = "load";
    stageDoneAll = false;
    renderChips();
    setProgress(t("opt.starting"), 0);
    try {
      const call = await app.bridge.optimizeLODs(
        path,
        specJson,
        JSON.stringify(LOD_LADDER),
        (p) => {
          if (running) setProgress(p.step || t("opt.runningShort"), p.pct, forwardSub(p));
        },
      );
      if (call.started) {
        // Background job: both buttons stay disabled until lodsDone arrives.
        stopProgress = call.stopProgress;
        if (!running) {
          stopProgress();
          stopProgress = null;
          return;
        }
        setProgress(t("opt.runningShort"), 0);
        setLog(t("opt.runningBg"));
        doneTimer = setTimeout(() => {
          doneTimer = null;
          stopJob();
          resetSub();
          resetStages();
          freezeClock();
          setProgress(t("common.failed"), 0);
          notify(t("opt.lodsFailedMsg", { message: t("opt.jobTimeout") }), "error");
        }, RUN_TIMEOUT_MS);
        return;
      }

      // Older hosts: the call itself returned the finished ladder.
      stopJob();
      resetSub();
      stageActive = "done";
      stageDoneAll = true;
      const total = call.result.reduce((acc, item) => acc + (item.secs ?? 0), 0);
      freezeClock(total > 0 ? total : undefined);
      setProgress(t("common.done"), 100);
      deps.onLodsFinished(call.result);
      notify(t("opt.lodsFinished"), "ok");
    } catch (err) {
      stopJob();
      resetSub();
      resetStages();
      if (isBusyError(err)) {
        setProgress(t("opt.runningShort"), 0);
        notify(t("opt.busyMsg"), "error");
      } else {
        freezeClock();
        setProgress(t("common.failed"), 0);
        notify(t("opt.lodsFailedMsg", { message: (err as Error).message }), "error");
      }
    }
  }

  return {
    panel,
    exportNote,
    edit,
    isInternalEdit: () => internalEdit,
    syncControls: () => {
      runBtn.disabled = running || !app.bridge.live || !app.sourcePath;
      lodBtn.disabled = running || !app.bridge.live || !app.sourcePath;
      exportBtn.disabled = running || exporting || !deps.getResult();
    },
    syncSourceHead,
    syncTexts: () => {
      optSectionHead.textContent = t("opt.section");
      syncSourceHead();
      renderPresetRow();
      runBtn.textContent = running ? t("opt.running") : t("opt.run");
      lodBtn.textContent = running ? t("opt.lodsRunning") : t("opt.lods");
      lodBtn.title = t("opt.lodsTitle");
      exportBtn.textContent = exporting ? t("opt.exporting") : t("opt.export");
      exportNote.textContent = t("opt.exportNote");
      renderProgress();
      renderChips();
    },
    loadSource,
    loadPresets,
    saveAs,
    discardResult,
    viewResult,
    dispose: () => {
      offDone();
      offLodsDone();
      offExport();
      offLog();
      stopJob();
    },
  };
}
