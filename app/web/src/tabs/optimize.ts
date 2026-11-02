import { app } from "../app";
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
import { ViewerScene, linkCameras } from "../viewer";
import type { OptimizeResult, Stats } from "../types";
import type { TabHandle } from "./types";

interface RowSpec {
  key: string;
  label: string;
  bytes?: boolean;
}

const ROWS: RowSpec[] = [
  { key: "triangles", label: "triangles" },
  { key: "vertices", label: "vertices" },
  { key: "draw_calls", label: "draw calls" },
  { key: "vram_total", label: "VRAM est", bytes: true },
  { key: "disk_total", label: "disk size", bytes: true },
];

function stat(stats: Stats | undefined, key: string): number | undefined {
  if (!stats) return undefined;
  const v = stats[key];
  return typeof v === "number" ? v : undefined;
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

  const openHint = emptyState(OPEN_HINT, { label: "Open…", onClick: () => void app.pickAndOpen() });
  openHint.classList.add("overlay");
  openHint.hidden = true;
  main.append(openHint);

  // progress overlay for the run
  const progressWrap = el("div", { class: "panel-body" });
  const progressBar = el("div", { class: "progress" }, el("div"));
  const progressStep = el("span", { text: "idle" });
  const progressPct = el("span", { text: "0%" });
  progressWrap.append(
    el("div", { class: "progress-meta" }, progressStep, progressPct),
    progressBar,
  );
  main.append(dual, el("div", { class: "panel" }, progressWrap));

  const side = el("div", { class: "tab-side" });
  root.append(main, side);

  let left: ViewerScene | null = null;
  let right: ViewerScene | null = null;
  let linked = false;
  let lastResult: OptimizeResult | null = null;
  let busy = false;

  const presetSelect = el("select", { disabled: !app.bridge.live });
  const runBtn = el("button", { class: "primary", text: "Run optimize", disabled: true });
  const exportBtn = el("button", { text: "Export", disabled: true });
  const pathLabel = el("div", { class: "mono muted", text: app.pathA ?? "no file selected" });

  side.append(
    section(
      "Optimize",
      pathLabel,
      el("div", { class: "row" }, presetSelect),
      el("div", { class: "row" }, runBtn, exportBtn),
    ),
    section(
      "Report",
      el("div", { class: "empty", text: "run an optimization to see before/after" }),
    ),
  );
  const reportPanel = side.lastElementChild as HTMLElement;

  async function loadPresets(): Promise<void> {
    try {
      const names = await app.bridge.presets();
      presetSelect.replaceChildren(...names.map((n) => el("option", { value: n, text: n })));
      runBtn.disabled = !app.bridge.live || !app.pathA;
    } catch (err) {
      app.toast(`presets failed: ${(err as Error).message}`, "error");
    }
  }

  async function loadSource(path: string): Promise<void> {
    pathLabel.textContent = path;
    if (!left) return;
    try {
      if (app.bridge.live) await left.loadBase64(await app.bridge.loadBytes(path));
      else left.loadDemo();
      openHint.hidden = true;
    } catch (err) {
      app.toast(`load failed: ${(err as Error).message}`, "error");
      openHint.hidden = false;
    }
    runBtn.disabled = busy || !app.bridge.live;
  }

  function setProgress(step: string, pct: number): void {
    progressStep.textContent = step || "working…";
    const clamped = Math.max(0, Math.min(100, pct));
    progressPct.textContent = `${Math.round(clamped)}%`;
    (progressBar.firstElementChild as HTMLElement).style.width = `${clamped}%`;
  }

  function renderReport(res: OptimizeResult): void {
    const { before, after, deltas, steps } = res.report;
    const body = el("div", null);
    const table = el(
      "table",
      null,
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
          const d = deltas?.[row.key];
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
    );
    body.append(table);

    if (steps.length > 0) {
      body.append(el("div", { class: "section-title", text: "steps" }));
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

    body.append(el("div", { class: "hint mono", text: `out: ${res.out_path}` }));
    reportPanel.replaceChildren(
      el(
        "div",
        { class: "panel-head" },
        el("span", { text: "Report" }),
        el("span", { class: "muted mono", text: res.report.preset ?? "" }),
      ),
      el("div", { class: "panel-body" }, body),
    );
  }

  runBtn.addEventListener("click", async () => {
    const path = app.pathA;
    if (!path || busy) return;
    const preset = presetSelect.value || "desktop";
    busy = true;
    runBtn.disabled = true;
    exportBtn.disabled = true;
    setProgress("starting…", 0);
    try {
      const res = await app.bridge.optimize(path, preset, (p) => setProgress(p.step, p.pct));
      lastResult = res;
      setProgress("done", 100);
      renderReport(res);
      exportBtn.disabled = false;
      if (right) {
        if (app.bridge.live) {
          try {
            await right.loadBase64(await app.bridge.loadBytes(res.out_path));
          } catch (err) {
            app.toast(`load optimized failed: ${(err as Error).message}`, "error");
          }
        } else {
          right.loadDemo();
        }
      }
      app.toast("optimization finished", "ok");
    } catch (err) {
      setProgress("failed", 0);
      app.toast(`optimize failed: ${(err as Error).message}`, "error");
    } finally {
      busy = false;
      runBtn.disabled = !app.bridge.live || !app.pathA;
    }
  });

  exportBtn.addEventListener("click", async () => {
    if (!lastResult) return;
    const ok = await copyText(lastResult.out_path);
    app.toast(
      ok ? `copied path: ${lastResult.out_path}` : `output: ${lastResult.out_path}`,
      ok ? "ok" : "info",
    );
  });

  const offPath = app.on("path", (d) => {
    void loadSource(d.path);
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
          if (app.pathA) void loadSource(app.pathA);
          else if (!app.bridge.live) {
            left.loadDemo();
            right.loadDemo();
          } else {
            openHint.hidden = false;
          }
          void loadPresets();
        } catch (err) {
          app.toast(`WebGL unavailable: ${(err as Error).message}`, "error");
        }
      } else {
        left.resume();
        right?.resume();
      }
      runBtn.disabled = busy || !app.bridge.live || !app.pathA;
    },
    deactivate: () => {
      left?.pause();
      right?.pause();
    },
    dispose: () => {
      offPath();
      left?.dispose();
      right?.dispose();
      left = null;
      right = null;
    },
  };
}
