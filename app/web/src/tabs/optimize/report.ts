/**
 * Optimize tab: report rendering (before/after table, step list, step images,
 * result banner). Stateless over the passed result.
 */
import { t } from "../../i18n";
import { el, fmtBytes, fmtNum, fmtPct, deltaClass } from "../../ui";
import { bannerButton, resultBanner } from "../../ui/banner";
import type { OptimizeResult, Stats } from "../../types";

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
  { key: "animations", labelKey: "opt.rowAnimations" },
];

function stat(stats: Stats | undefined, key: string): number | undefined {
  if (!stats) return undefined;
  const v = stats[key];
  return typeof v === "number" ? v : undefined;
}

/** Local duration format: empty when unknown (the shared ui fmtSecs shows "—"). */
function fmtSecs(secs: number | undefined): string {
  if (secs == null || !Number.isFinite(secs)) return "";
  return secs < 1 ? `${Math.round(secs * 1000)} ms` : `${secs.toFixed(2)} s`;
}

export interface ReportCbs {
  onSaveAs(path: string): void;
  onDiscard(path: string): Promise<void>;
}

export interface ReportApi {
  panel: HTMLElement;
  render(res: OptimizeResult, artifactLive: boolean): void;
  reset(): void;
  syncHead(): void;
}

export function createReport(cbs: ReportCbs): ReportApi {
  const reportHead = el("span");
  const reportBodyHost = el("div", { class: "panel-body" });
  const panel = el(
    "div",
    { class: "panel" },
    el("div", { class: "panel-head" }, reportHead),
    reportBodyHost,
  );

  /** Back to the empty state: a new run supersedes the previous report. */
  function reset(): void {
    reportHead.textContent = t("opt.report");
    reportBodyHost.replaceChildren(el("div", { class: "empty", text: t("opt.reportEmpty") }));
  }
  reset();

  function render(res: OptimizeResult, artifactLive: boolean): void {
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
            { class: `step ${s.applied ? "applied" : ""} ${s.failed ? "failed" : ""}` },
            el("span", { class: "mark", text: s.applied ? "✓" : s.failed ? "!" : "–" }),
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

    // The action banner lives only while the artifact does: after a discard
    // the numbers stay but there is no file left to save or copy a path of.
    if (artifactLive) {
      body.append(
        resultBanner(
          res.out_path,
          bannerButton(t("common.saveAs"), t("opt.saveTitle"), {
            primary: true,
            onClick: () => cbs.onSaveAs(res.out_path),
          }),
          bannerButton(t("opt.discard"), t("opt.discardTitle"), {
            danger: true,
            onClick: (ev: Event) => {
              const btn = ev.currentTarget as HTMLButtonElement | null;
              if (btn) btn.disabled = true;
              void cbs.onDiscard(res.out_path).finally(() => {
                if (btn?.isConnected) btn.disabled = false;
              });
            },
          }),
        ),
      );
    }

    reportHead.textContent = t("opt.report");
    const secs = fmtSecs(res.report.total_secs);
    panel.replaceChildren(
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

  function syncHead(): void {
    reportHead.textContent = t("opt.report");
  }

  return { panel, render, reset, syncHead };
}
