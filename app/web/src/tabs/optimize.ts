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
import { notify, onLog } from "../notify";
import { ViewerScene, linkCameras } from "../viewer";
import type { OptimizeResult, Stats } from "../types";
import type { TabHandle } from "./types";

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

  const side = el("div", { class: "tab-side" });
  root.append(main, side);

  let left: ViewerScene | null = null;
  let right: ViewerScene | null = null;
  let linked = false;
  let lastResult: OptimizeResult | null = null;
  /** True while a background job owns the backend (Run stays disabled). */
  let running = false;
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

  const pathLabel = el("div", { class: "mono muted wrap", text: app.pathA ?? "no file selected" });
  const presetRow = el("div", { class: "preset-row" });
  const runBtn = el("button", { class: "primary", text: "Run optimize", disabled: true });
  const exportBtn = el("button", { text: "Export", disabled: true });

  side.append(
    section("Optimize", pathLabel, presetRow, el("div", { class: "row" }, runBtn, exportBtn)),
  );

  /* -------------------------------------------------------------- step rows */

  const stepsPanel = el("div", { class: "panel" });
  const stepsBody = el("div", { class: "panel-body form" });
  stepsPanel.append(el("div", { class: "panel-head" }, el("span", { text: "Steps" })), stepsBody);
  side.append(stepsPanel);

  const form = buildOptimizeForm(stepsBody, { get: steps, edit });

  function syncAll(): void {
    form.sync();
    runBtn.disabled = running || !app.bridge.live || !app.pathA;
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
    runBtn.disabled = on || !app.bridge.live || !app.pathA;
    exportBtn.disabled = on || !lastResult;
    progressBar.classList.toggle("running", on);
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
    pathLabel.textContent = path;
    if (!left) return;
    try {
      if (app.bridge.live) await left.loadBase64(await app.bridge.loadBytes(path));
      else left.loadDemo();
      openHint.hidden = true;
    } catch (err) {
      notify(`load failed: ${(err as Error).message}`, "error");
      openHint.hidden = false;
    }
    runBtn.disabled = running || !app.bridge.live || !app.pathA;
  }

  const RUN_TIMEOUT_MS = 10 * 60 * 1000;

  runBtn.addEventListener("click", async () => {
    const path = app.pathA;
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
  });

  exportBtn.addEventListener("click", async () => {
    if (!lastResult) return;
    const ok = await copyText(lastResult.out_path);
    notify(
      ok ? `copied path: ${lastResult.out_path}` : `output: ${lastResult.out_path}`,
      ok ? "ok" : "info",
    );
  });

  const offPath = app.on("path", (d) => {
    void loadSource(d.path);
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
          if (app.pathA) void loadSource(app.pathA);
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
      offPath();
      offLog();
      offSettings();
      offDone();
      stopJob();
      left?.dispose();
      right?.dispose();
      left = null;
      right = null;
    },
  };
}
