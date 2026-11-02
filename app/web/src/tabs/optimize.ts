import { app } from "../app";
import { isBusyError } from "../bridge";
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

const TEXTURE_MAX_SIZES: Array<[string, number]> = [
  ["no resize", 0],
  ["512", 512],
  ["1024", 1024],
  ["2048", 2048],
];

const ERROR_TOLERANCES: Array<[string, number]> = [
  ["0.05%", 0.0005],
  ["0.1%", 0.001],
  ["0.2%", 0.002],
  ["0.5%", 0.005],
  ["1%", 0.01],
];

interface StepState {
  prune: boolean;
  dedup: boolean;
  weld: boolean;
  weldTolerance: number;
  join: boolean;
  textures: boolean;
  textureFormat: string;
  textureQuality: number;
  textureMaxSize: number;
  textureMips: boolean;
  quantize: boolean;
  positionBits: number;
  uvBits: number;
  normalOct: boolean;
  simplify: boolean;
  targetRatio: number;
  errorTolerance: number;
  aggressive: boolean;
  lockBorders: boolean;
}

function defaultState(): StepState {
  return {
    prune: true,
    dedup: true,
    weld: true,
    weldTolerance: 0,
    join: true,
    textures: true,
    textureFormat: "auto",
    textureQuality: 128,
    textureMaxSize: 0,
    textureMips: true,
    quantize: true,
    positionBits: 14,
    uvBits: 12,
    normalOct: true,
    simplify: false,
    targetRatio: 0.5,
    errorTolerance: 0.001,
    aggressive: false,
    lockBorders: true,
  };
}

/** Named presets only prefill the per-step controls. */
const PRESET_PREFS: Record<string, Partial<StepState>> = {
  mobile: {
    textureFormat: "auto",
    textureQuality: 160,
    textureMaxSize: 2048,
    textureMips: true,
    positionBits: 14,
    uvBits: 12,
    normalOct: true,
    simplify: false,
    weldTolerance: 0,
  },
  desktop: {
    textureFormat: "auto",
    textureQuality: 255,
    textureMaxSize: 0,
    textureMips: true,
    positionBits: 14,
    uvBits: 12,
    normalOct: true,
    simplify: false,
    weldTolerance: 0,
  },
  web: {
    textureFormat: "etc1s",
    textureQuality: 128,
    textureMaxSize: 1024,
    textureMips: true,
    positionBits: 14,
    uvBits: 12,
    normalOct: true,
    simplify: false,
    weldTolerance: 0,
  },
};

function stat(stats: Stats | undefined, key: string): number | undefined {
  if (!stats) return undefined;
  const v = stats[key];
  return typeof v === "number" ? v : undefined;
}

/** The wire format understood by `optimizeCustom(path, spec)`. */
function buildSpec(state: StepState): Array<Record<string, unknown>> {
  const steps: Array<Record<string, unknown>> = [];
  if (state.prune) steps.push({ prune: {} });
  if (state.dedup) steps.push({ dedup: {} });
  if (state.weld) steps.push({ weld: { tolerance: state.weldTolerance } });
  if (state.join) steps.push({ join: {} });
  if (state.textures) {
    steps.push({
      textures: {
        format: state.textureFormat,
        quality: state.textureQuality,
        rdo_lambda: 1,
        generate_mips: state.textureMips,
        max_size: state.textureMaxSize,
      },
    });
  }
  if (state.quantize) {
    steps.push({
      quantize: {
        position_bits: state.positionBits,
        uv_bits: state.uvBits,
        normal_oct: state.normalOct,
      },
    });
  }
  if (state.simplify) {
    steps.push({
      simplify: {
        target_ratio: state.targetRatio,
        error_tolerance: state.errorTolerance,
        aggressive: state.aggressive,
        lock_borders: state.lockBorders,
      },
    });
  }
  return steps;
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

  const state = defaultState();
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

  const stepBoxes: Array<{ key: keyof StepState; box: HTMLInputElement; params: HTMLElement }> = [];
  const widgetSync: Array<() => void> = [];

  function syncAll(): void {
    for (const entry of stepBoxes) {
      entry.box.checked = Boolean(state[entry.key]);
      entry.params.hidden = !state[entry.key];
    }
    for (const sync of widgetSync) sync();
    runBtn.disabled = running || !app.bridge.live || !app.pathA;
  }

  function step(
    key: keyof StepState,
    label: string,
    hint: string,
    buildParams: () => HTMLElement[],
  ): HTMLElement {
    const box = el("input", { type: "checkbox" });
    box.checked = Boolean(state[key]);
    box.addEventListener("change", () => {
      (state as unknown as Record<string, unknown>)[key as string] = box.checked;
      syncAll();
    });
    const params = el("div", { class: "step-params" });
    params.append(...buildParams());
    params.hidden = !box.checked;
    stepBoxes.push({ key, box, params });
    return el(
      "div",
      { class: "step-block" },
      el(
        "label",
        { class: "step-toggle" },
        box,
        el("span", { class: "step-name", text: label }),
        el("span", { class: "step-hint", text: hint }),
      ),
      params,
    );
  }

  function select(
    values: Array<[string, string]>,
    get: () => string,
    set: (v: string) => void,
  ): HTMLSelectElement {
    const node = el("select", { class: "compact" });
    for (const [label, value] of values) {
      node.append(el("option", { value, text: label }));
    }
    node.value = get();
    node.addEventListener("change", () => set(node.value));
    widgetSync.push(() => {
      node.value = get();
    });
    return node;
  }

  function checkbox(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const box = el("input", { type: "checkbox" });
    box.checked = get();
    box.addEventListener("change", () => set(box.checked));
    widgetSync.push(() => {
      box.checked = get();
    });
    return el("label", { class: "inline-check" }, box, el("span", { text: label }));
  }

  function slider(
    min: number,
    max: number,
    stepSize: number,
    get: () => number,
    set: (v: number) => void,
    suffix = "",
  ): HTMLElement {
    const input = el("input", { type: "range", min, max, step: stepSize });
    const out = el("span", { class: "range-value mono" });
    const apply = () => {
      input.value = String(get());
      out.textContent = `${get()}${suffix}`;
    };
    input.addEventListener("input", () => {
      set(Number(input.value));
      out.textContent = `${Number(input.value)}${suffix}`;
    });
    widgetSync.push(apply);
    apply();
    return el("div", { class: "range-row" }, input, out);
  }

  const field = (label: string, control: HTMLElement, wide = false): HTMLElement =>
    el("div", { class: wide ? "field wide" : "field" }, el("span", { text: label }), control);

  const addStep = (...nodes: HTMLElement[]) => {
    for (const node of nodes) stepsBody.append(node);
  };

  const stepsPanel = el("div", { class: "panel" });
  const stepsBody = el("div", { class: "panel-body form" });
  stepsPanel.append(el("div", { class: "panel-head" }, el("span", { text: "Steps" })), stepsBody);
  side.append(stepsPanel);

  addStep(
    step("prune", "prune", "unused nodes / materials / textures", () => []),
    step("dedup", "dedup", "shared accessors, meshes, materials", () => []),
    step("weld", "weld", "merge duplicate vertices", () => [
      field(
        "tolerance",
        (() => {
          const input = el("input", {
            type: "number",
            min: 0,
            max: 1,
            step: 0.0001,
            class: "compact",
          });
          input.value = String(state.weldTolerance);
          input.addEventListener("input", () => {
            state.weldTolerance = Math.max(0, Number(input.value) || 0);
          });
          widgetSync.push(() => {
            input.value = String(state.weldTolerance);
          });
          return input;
        })(),
      ),
    ]),
    step("join", "join", "merge primitives sharing a material", () => []),
    step("textures", "textures", "KTX2 / basis encode", () => [
      field(
        "format",
        select(
          [
            ["auto", "auto"],
            ["ETC1S", "etc1s"],
            ["UASTC", "uastc"],
          ],
          () => state.textureFormat,
          (v) => {
            state.textureFormat = v;
          },
        ),
      ),
      field(
        "quality",
        slider(
          1,
          255,
          1,
          () => state.textureQuality,
          (v) => {
            state.textureQuality = v;
          },
        ),
        true,
      ),
      field(
        "max size",
        select(
          TEXTURE_MAX_SIZES.map(([label, v]): [string, string] => [label, String(v)]),
          () => String(state.textureMaxSize),
          (v) => {
            state.textureMaxSize = Number(v);
          },
        ),
      ),
      field(
        "mips",
        checkbox(
          "generate",
          () => state.textureMips,
          (v) => {
            state.textureMips = v;
          },
        ),
      ),
    ]),
    step("quantize", "quantize", "attribute bit packing", () => [
      field(
        "position bits",
        select(
          Array.from({ length: 6 }, (_, i): [string, string] => [String(11 + i), String(11 + i)]),
          () => String(state.positionBits),
          (v) => {
            state.positionBits = Number(v);
          },
        ),
      ),
      field(
        "uv bits",
        select(
          Array.from({ length: 9 }, (_, i): [string, string] => [String(8 + i), String(8 + i)]),
          () => String(state.uvBits),
          (v) => {
            state.uvBits = Number(v);
          },
        ),
      ),
      field(
        "normals",
        checkbox(
          "oct-encode",
          () => state.normalOct,
          (v) => {
            state.normalOct = v;
          },
        ),
      ),
    ]),
    step("simplify", "simplify", "decimate triangles", () => [
      field(
        "keep",
        slider(
          10,
          90,
          1,
          () => Math.round(state.targetRatio * 100),
          (v) => {
            state.targetRatio = v / 100;
          },
          "%",
        ),
        true,
      ),
      field(
        "max error",
        select(
          ERROR_TOLERANCES.map(([label, v]): [string, string] => [label, String(v)]),
          () => String(state.errorTolerance),
          (v) => {
            state.errorTolerance = Number(v);
          },
        ),
      ),
      field(
        "mode",
        checkbox(
          "aggressive",
          () => state.aggressive,
          (v) => {
            state.aggressive = v;
          },
        ),
      ),
      field(
        "borders",
        checkbox(
          "lock",
          () => state.lockBorders,
          (v) => {
            state.lockBorders = v;
          },
        ),
      ),
    ]),
  );
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
        el("span", { class: "muted mono", text: res.report.preset ?? "custom" }),
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
    if (prefs) Object.assign(state, prefs);
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
    const steps = buildSpec(state);
    if (steps.length === 0) {
      notify("pick at least one step", "error");
      return;
    }
    const specJson = JSON.stringify({ steps });
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
      void loadPresets();
      runBtn.disabled = running || !app.bridge.live || !app.pathA;
    },
    deactivate: () => {
      left?.pause();
      right?.pause();
    },
    dispose: () => {
      offPath();
      offLog();
      offDone();
      stopJob();
      left?.dispose();
      right?.dispose();
      left = null;
      right = null;
    },
  };
}
