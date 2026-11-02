import { app } from "../app";
import { isBusyError } from "../bridge";
import { buildOptimizeForm } from "../optimizeForm";
import { getSettings, onSettingsChange, updateSettings } from "../settings";
import type { OptimizeSteps } from "../settings";
import {
  el,
  fmtBytes,
  fmtNum,
  fmtPct,
  deltaClass,
  section,
  copyText,
  emptyState,
  OPEN_HINT,
} from "../ui";
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
  label: string;
  bytes?: boolean;
  deltaKey?: string;
}

const ROWS: RowSpec[] = [
  { key: "triangles", label: "triangles" },
  { key: "vertices", label: "vertices" },
  { key: "draw_calls", label: "draw calls" },
  { key: "vram_total", label: "VRAM est", bytes: true, deltaKey: "vram_bytes" },
  { key: "disk_total", label: "disk size", bytes: true, deltaKey: "disk_bytes" },
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
    out.push({
      textures: {
        format: steps.textures.format,
        quality: steps.textures.quality,
        rdo_lambda: 1,
        generate_mips: steps.textures.generate_mips,
        max_size: steps.textures.max_size,
      },
    });
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
  const mkPane = (title: string) => {
    const wrap = el("div", { class: "canvas-wrap" });
    const canvas = el("canvas");
    wrap.append(canvas, el("div", { class: "canvas-label", text: title }));
    dual.append(wrap);
    return { wrap, canvas };
  };
  const leftPane = mkPane("original");
  const rightPane = mkPane("optimized");
  // No bottom panel here: progress + report live in the right panel.
  main.append(dual);

  const openHint = emptyState(OPEN_HINT, { label: "Open…", onClick: () => void app.pickAndOpen() });
  openHint.classList.add("overlay");
  openHint.hidden = true;
  main.append(openHint);

  /** "No source model" when a view exists without a source; else the Open hint. */
  function syncEmptyHint(): void {
    const label = openHint.querySelector(".empty-state-text");
    if (label) {
      label.textContent =
        !app.sourcePath && app.viewPath
          ? "No source model — open one (⌘O) or use as source"
          : OPEN_HINT;
    }
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
  let doneTimer: ReturnType<typeof setTimeout> | null = null;
  let stopProgress: (() => void) | null = null;

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

  const sourceLabel = el("div", {
    class: "mono muted wrap",
    text: `Source: ${app.sourcePath ?? "no file selected"}`,
  });
  const viewNote = el("div", {
    class: "amber-note",
    text: "Viewing a different file (results are not the source)",
  });
  viewNote.hidden = true;
  const presetRow = el("div", { class: "preset-row" });
  const runBtn = el("button", { class: "primary", text: "Run optimize", disabled: true });
  const exportBtn = el("button", { text: "Export", disabled: true });
  /** Pre-run guard: shown when the source has no encodable images left. */
  const guardBox = el("div", { class: "guard-box" });
  guardBox.hidden = true;

  function syncSourceHead(): void {
    sourceLabel.textContent = `Source: ${app.sourcePath ?? "no file selected"}`;
    sourceLabel.title = app.sourcePath ?? "";
    const diverged = !!app.viewPath && !!app.sourcePath && app.viewPath !== app.sourcePath;
    viewNote.hidden = !diverged;
    if (diverged) viewNote.title = `viewing ${app.viewPath}`;
  }
  syncSourceHead();

  side.append(
    section(
      "Optimize",
      sourceLabel,
      viewNote,
      guardBox,
      presetRow,
      el("div", { class: "row" }, runBtn, exportBtn),
    ),
  );

  /* -------------------------------------------------------------- step rows */

  const stepsPanel = el("div", { class: "panel" });
  const stepsBody = el("div", { class: "panel-body form" });
  stepsPanel.append(el("div", { class: "panel-head" }, el("span", { text: "Steps" })), stepsBody);
  side.append(stepsPanel);

  const form = buildOptimizeForm(stepsBody, { get: steps, edit });

  function syncAll(): void {
    form.sync();
    runBtn.disabled = running || !app.bridge.live || !app.sourcePath;
    syncSourceHead();
    syncEmptyHint();
  }
  syncAll();

  /* ---------------------------------------------------------------- progress */

  const progressStep = el("span", { text: "idle" });
  const progressPct = el("span", { text: "0%" });
  const progressFill = el("div");
  const progressBar = el("div", { class: "progress" }, progressFill);
  const logLine = el("div", { class: "logline mono", text: "—" });
  const progressPanel = section(
    "Progress",
    el("div", { class: "progress-meta" }, progressStep, progressPct),
    progressBar,
    logLine,
  );
  side.append(progressPanel);

  /* ------------------------------------------------------------------ report */

  const reportPanel = section(
    "Report",
    el("div", { class: "empty", text: "run an optimization to see before/after" }),
  );
  side.append(reportPanel);
  side.append(
    el("div", {
      class: "hint",
      text: "Results are written to .zig-cache/…; the source file is never modified. Use Save as… to place a copy.",
    }),
  );

  function setProgress(step: string, pct: number): void {
    progressStep.textContent = step || "working…";
    const clamped = Math.max(0, Math.min(100, pct));
    progressPct.textContent = `${Math.round(clamped)}%`;
    progressFill.style.width = `${clamped}%`;
  }

  function setLog(message: string): void {
    logLine.textContent = message;
    logLine.title = message;
  }

  function setRunning(on: boolean): void {
    running = on;
    runBtn.textContent = on ? "Running…" : "Run optimize";
    runBtn.disabled = on || !app.bridge.live || !app.sourcePath;
    exportBtn.disabled = on || exporting || !lastResult;
    progressBar.classList.toggle("running", on);
  }

  function setExporting(on: boolean): void {
    exporting = on;
    exportBtn.textContent = on ? "Exporting…" : "Export";
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
      notify("export already running — wait for it to finish", "error");
      return;
    }
    let pick: { path: string | null };
    try {
      pick = await app.bridge.pickSavePath(basename(outPath));
    } catch (err) {
      notify(`save dialog failed: ${(err as Error).message}`, "error");
      return;
    }
    if (!pick.path) return; // cancel
    if (!app.bridge.live) {
      notify("demo mode — export needs the assetty binary", "error");
      return;
    }
    setExporting(true);
    pendingDst = pick.path;
    setLog(`exporting to ${pick.path}…`);
    try {
      await app.bridge.exportTo(outPath, pick.path);
    } catch (err) {
      pendingDst = null;
      setExporting(false);
      if (isBusyError(err)) {
        notify("export already running — wait for it to finish", "error");
      } else if (isMissingMethodError(err)) {
        notify("export unavailable — rebuild the assetty binary", "error");
      } else {
        notify(`export failed: ${(err as Error).message}`, "error");
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
    setProgress("failed", 0);
    notify(`optimize failed: ${message}`, "error");
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
            el("th", { text: "metric" }),
            el("th", { class: "num", text: "before" }),
            el("th", { class: "num", text: "after" }),
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
              el("td", { text: row.label }),
              el("td", { class: "num", text: show(b) }),
              el("td", { class: "num", text: show(a) }),
              el("td", { class: `num ${deltaClass(pct)}`, text: fmtPct(pct) }),
            );
          }),
        ),
      ),
    );

    if (steps.length > 0) {
      body.append(el("div", { class: "section-title", text: "steps run" }));
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
          notify(ok ? `copied ${res.out_path}` : res.out_path, ok ? "ok" : "info");
        },
      }),
      el(
        "div",
        { class: "row" },
        el("button", {
          class: "small primary",
          text: "View result",
          title: "Load this result into the viewer (the optimize source is unchanged)",
          onclick: () => {
            app.setView(res.out_path);
            notify(`viewing ${res.out_path}`, "ok");
          },
        }),
        el("button", {
          class: "small",
          text: "Use as source",
          title: "Run further experiments starting from this result",
          onclick: () => {
            app.useAsSource(res.out_path);
            notify(`source: ${res.out_path}`, "ok");
          },
        }),
        el("button", {
          class: "small",
          text: "Save as…",
          title: "Copy this result wherever you want it (the source model is never modified)",
          onclick: () => void saveAs(res.out_path),
        }),
      ),
    );

    reportPanel.replaceChildren(
      el(
        "div",
        { class: "panel-head" },
        el("span", { text: "Report" }),
        el("span", {
          class: "muted mono",
          text: [
            res.report.preset ?? "custom",
            fmtSecs(res.report.total_secs) && `total ${fmtSecs(res.report.total_secs)}`,
          ]
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
      notify(`load optimized failed: ${(err as Error).message}`, "error");
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
    setProgress("done", 100);
    renderReport(event.result);
    void loadOptimized(event.result.out_path);
    notify("optimization finished", "ok");
  });

  // The copy this tab asked for (matched by dst so the Textures tab's exports
  // don't double-notify here). `notify` fans out to the toast + status bar.
  const offExport = app.bridge.onExportDone((event) => {
    if (exporting && pendingDst != null) {
      if (event.ok && event.dst === pendingDst) {
        pendingDst = null;
        setExporting(false);
        setLog(`saved to ${event.dst}`);
        notify(`saved to ${event.dst}`, "ok");
      } else if (!event.ok) {
        pendingDst = null;
        setExporting(false);
        notify(`export failed: ${event.error}`, "error");
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
    setLog(
      prefs
        ? `preset "${name}" prefilled the step settings`
        : `preset "${name}" (no known prefill; used as fallback)`,
    );
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
          title: `prefill the steps from the "${name}" preset`,
          onclick: () => applyPreset(name),
        }),
      ),
    );
  }

  async function loadSource(path: string): Promise<void> {
    sourceLabel.textContent = `Source: ${path}`;
    sourceLabel.title = path;
    syncSourceHead();
    syncEmptyHint();
    if (!left) return;
    try {
      if (app.bridge.live) await left.loadBase64(await app.bridge.loadBytes(path));
      else left.loadDemo();
      openHint.hidden = true;
    } catch (err) {
      notify(`load failed: ${(err as Error).message}`, "error");
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
          text: "Run anyway",
          onclick: () => {
            guardBox.hidden = true;
            guardBox.replaceChildren();
            onRun();
          },
        }),
        el("button", {
          class: "small",
          text: "Cancel",
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
        showGuard(
          "All textures in the source are already KTX2 — texture settings will not apply.",
          () => void doRun(),
        );
        setLog("run blocked: source textures are all KTX2 (confirm to run anyway)");
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
      notify("pick at least one step", "error");
      return;
    }
    const specJson = JSON.stringify({ steps: specSteps });
    stopProgress?.();
    stopProgress = null;
    setRunning(true);
    setProgress("starting…", 0);
    try {
      const call = await app.bridge.optimizeCustom(
        path,
        specJson,
        activePreset || "desktop",
        (p) => {
          if (running) setProgress(p.step || "running…", p.pct);
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
        setProgress("running…", 0);
        setLog("optimization running in the background…");
        doneTimer = setTimeout(() => {
          doneTimer = null;
          finishJobError("no completion event within 10 minutes — timed out");
        }, RUN_TIMEOUT_MS);
        return;
      }

      // Older hosts: the call itself returned the finished report.
      lastResult = call.result;
      stopJob();
      setProgress("done", 100);
      renderReport(call.result);
      void loadOptimized(call.result.out_path);
      notify("optimization finished", "ok");
    } catch (err) {
      stopJob();
      if (isBusyError(err)) {
        setProgress("busy", 0);
        notify("optimize already running — wait for it to finish", "error");
      } else {
        setProgress("failed", 0);
        notify(`optimize failed: ${(err as Error).message}`, "error");
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
          // Viewer tab's scene).
          const dbg = (window as unknown as Record<string, unknown>)["__assetty"] as
            | Record<string, unknown>
            | undefined;
          if (dbg) dbg["panes"] = () => ({ left, right });
          if (app.sourcePath) void loadSource(app.sourcePath);
          else if (!app.bridge.live) {
            left.loadDemo();
            right.loadDemo();
          } else {
            openHint.hidden = false;
          }
        } catch (err) {
          notify(`WebGL unavailable: ${(err as Error).message}`, "error");
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
    },
    deactivate: () => {
      left?.pause();
      right?.pause();
    },
    dispose: () => {
      offSource();
      offView();
      offLog();
      offSettings();
      offDone();
      offExport();
      stopJob();
      left?.dispose();
      right?.dispose();
      left = null;
      right = null;
    },
  };
}
