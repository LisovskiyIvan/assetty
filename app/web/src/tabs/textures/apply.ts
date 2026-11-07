/**
 * Textures tab: Apply-to-model flow (textures-only optimize + result banner).
 * Owns its run state, timers, and export subscriptions.
 */
import { app } from "../../app";
import { notify } from "../../notify";
import { t } from "../../i18n";
import { el, fmtBytes, fmtSecs, clear, displayName } from "../../ui";
import { bannerButton, revealButton } from "../../ui/banner";
import {
  createSeq,
  isCancelledError,
  notifyExportError,
  notifyJobError,
  pickSaveTarget,
} from "../../guards";
import {
  claimJob,
  getJob,
  jobLabelKey,
  onJobChange,
  releaseJob,
  setJobCancelling,
} from "../../jobs";
import { getSettings, getTextureOverrides, textureOverridesCount } from "../../settings";
import type { EncodeSettings, OptimizeResult } from "../../types";

export interface ApplyBarNodes {
  bar: HTMLElement;
  applyHint: HTMLElement;
  firstRunHint: HTMLElement;
  applyBtn: HTMLButtonElement;
  applyCancel: HTMLButtonElement;
  applyBlockHint: HTMLElement;
  applyParams: HTMLElement;
  applyStatus: HTMLElement;
  applySubLine: HTMLElement;
  previewActs: HTMLElement;
  applyActs: HTMLElement;
  overridesNote: HTMLElement;
  resultHost: HTMLElement;
}

export function buildApplyBar(): ApplyBarNodes {
  const applyBtn = el("button", { class: "primary", text: t("tex.apply") });
  const applyCancel = el("button", {
    text: t("common.cancel"),
    title: t("job.cancelTitle"),
    disabled: true,
  });
  const applyBlockHint = el("div", { class: "hint", id: "tex-apply-hint" });
  applyBlockHint.hidden = true;
  const applyParams = el("span", { class: "muted mono" });
  const applyStatus = el("span", { class: "muted mono", text: t("common.idle") });
  /** Compact "texture 3/7" line while a textures-only run is in flight. */
  const applySubLine = el("div", { class: "hint mono" });
  applySubLine.hidden = true;
  /** Which file each action targets (preview sees the view, apply reads the source). */
  const previewActs = el("div", { class: "hint muted mono" });
  const applyActs = el("div", { class: "hint muted mono" });
  const overridesNote = el("div", { class: "hint muted mono" });
  const resultHost = el("div");
  const applyHint = el("div", { class: "hint", text: t("tex.previewDry") });
  const firstRunHint = el("div", { class: "hint", text: t("tex.firstRun") });
  const bar = el(
    "div",
    { class: "panel-body" },
    applyHint,
    el("div", { class: "row" }, applyBtn, applyCancel, applyParams),
    applyBlockHint,
    applySubLine,
    applyActs,
    overridesNote,
    firstRunHint,
    el("div", { class: "hint" }, applyStatus),
    resultHost,
  );
  return {
    bar,
    applyHint,
    firstRunHint,
    applyBtn,
    applyCancel,
    applyBlockHint,
    applyParams,
    applyStatus,
    applySubLine,
    previewActs,
    applyActs,
    overridesNote,
    resultHost,
  };
}

const APPLY_TIMEOUT_MS = 10 * 60 * 1000;

export interface ApplyFlow {
  sync(): void;
  syncActsOn(): void;
  syncLang(): void;
  /** Clears in-flight apply/export state (reload); keeps subscriptions alive. */
  reset(): void;
  start(override?: EncodeSettings): Promise<void>;
  /** True while a textures-only apply owns the backend gate. */
  isRunning(): boolean;
  /** Asks the host to stop the in-flight apply; frees on its done event. */
  cancel(): Promise<void>;
  dispose(): void;
}

export function createApplyFlow(nodes: ApplyBarNodes): ApplyFlow {
  const {
    applyBtn,
    applyCancel,
    applyBlockHint,
    applyParams,
    applyStatus,
    applySubLine,
    applyActs,
    overridesNote,
    resultHost,
  } = nodes;

  const seq = createSeq();
  let applyRunning = false;
  /** Cancel requested: the terminal done event is still pending. */
  let cancelling = false;
  let applyTimer: ReturnType<typeof setTimeout> | null = null;
  let stopApplyProgress: (() => void) | null = null;
  /** Texture sub-progress for the in-flight apply (max kept, -1 = none). */
  let applyDone = -1;
  let applyTotal = 0;

  function renderApplySub(): void {
    if (applyRunning && applyDone >= 0) {
      applySubLine.hidden = false;
      applySubLine.textContent = t("progress.texture", { done: applyDone, total: applyTotal });
    } else {
      applySubLine.hidden = true;
      applySubLine.textContent = "";
    }
  }

  function resetApplySub(): void {
    applyDone = -1;
    applyTotal = 0;
    renderApplySub();
  }
  /** True while an exportTo copy is in flight; `pendingDst` matches its event. */
  let exporting = false;
  let pendingDst: string | null = null;
  let exportTimer: ReturnType<typeof setTimeout> | null = null;

  function clearExportTimer(): void {
    if (exportTimer) {
      clearTimeout(exportTimer);
      exportTimer = null;
    }
  }

  /** Export timeout never frees the gate: keep waiting for the done event. */
  function armExportTimer(): void {
    clearExportTimer();
    exportTimer = setTimeout(() => {
      exportTimer = null;
      if (!exporting) return;
      setApplyStatus(t("job.stillRunning"));
      notify(t("job.stillRunning"), "info");
      armExportTimer();
    }, APPLY_TIMEOUT_MS);
  }

  function stopExporting(): void {
    clearExportTimer();
    pendingDst = null;
    releaseJob("export");
    exporting = false;
    sync();
  }

  /** Texture step from the shared optimize defaults, optionally overridden
   *  by a preview's applied settings (the compare-pane shortcut), plus this
   *  source model's per-texture overrides merged in array order. */
  function textureStep(override?: EncodeSettings): Record<string, unknown> {
    const b = getSettings().optimize.steps.textures;
    const spec: Record<string, unknown> = {
      format: override?.format ?? b.format,
      quality: override?.quality ?? b.quality,
      rdo_lambda: 1,
      generate_mips: override?.generate_mips ?? b.generate_mips,
      max_size: override?.max_size ?? b.max_size,
    };
    if (b.supercompression !== "none") spec.supercompression = b.supercompression;
    if (override?.normal_map !== undefined) spec.normal_map = override.normal_map;
    const src = app.sourcePath;
    const list = getTextureOverrides(src);
    if (list.length > 0) spec.overrides = list.map((o) => ({ ...o }));
    return spec;
  }

  function describeTextureParams(): string {
    const b = getSettings().optimize.steps.textures;
    const size = b.max_size === 0 ? t("common.original") : String(b.max_size);
    const n = textureOverridesCount(app.sourcePath);
    const base = `${b.format} · q${b.quality} · ${size} · mips ${b.generate_mips ? t("common.on") : t("common.off")}`;
    const zstd = b.supercompression === "zstd" ? ` · ${t("tex.devZstd")}` : "";
    return n > 0 ? `${base}${zstd} · ${t("tex.paramsOv", { n })}` : `${base}${zstd}`;
  }

  function setApplyStatus(text: string): void {
    applyStatus.textContent = text;
  }

  /** Refresh the "acts on <path>" lines under Preview / Apply. */
  function syncActsOn(): void {
    nodes.previewActs.textContent = t("tex.previewActs", { name: displayName(app.viewPath) });
    nodes.previewActs.title = app.viewPath ?? t("tex.noFileViewed");
    applyActs.textContent = t("tex.applyActs", { name: displayName(app.sourcePath) });
    applyActs.title = app.sourcePath ?? t("tex.noSource");
  }

  function sync(): void {
    applyParams.textContent = describeTextureParams();
    const src = app.sourcePath;
    const n = textureOverridesCount(src);
    overridesNote.textContent = src
      ? n > 0
        ? t("tex.overridesCount", { n })
        : t("tex.overridesNone")
      : t("tex.overridesNone");
    overridesNote.title = src ?? t("tex.noSource");
    const bus = getJob();
    const otherBusy = !applyRunning && bus.kind !== null && bus.kind !== "apply";
    let reason: string | null = null;
    if (!applyRunning) {
      if (otherBusy && bus.kind) reason = t("job.busyNote", { job: t(jobLabelKey(bus.kind)) });
      else if (!app.bridge.live) reason = t("job.noHost");
      else if (!src) reason = t("tex.applyNoSource");
    }
    applyBlockHint.textContent = reason ?? "";
    applyBlockHint.hidden = reason == null;
    applyBtn.disabled = applyRunning || otherBusy || !src || !app.bridge.live;
    if (reason) {
      applyBtn.title = reason;
      applyBtn.setAttribute("aria-describedby", "tex-apply-hint");
    } else {
      applyBtn.title = t("tex.applyShortcutTitle");
      applyBtn.removeAttribute("aria-describedby");
    }
    if (!applyRunning) applyBtn.textContent = t("tex.apply");
    // Visible only while this tab's apply owns the gate.
    applyCancel.hidden = !applyRunning;
    applyCancel.disabled = !applyRunning || cancelling;
    if (!applyRunning) applyCancel.textContent = t("common.cancel");
    applyCancel.title = t("job.cancelTitle");
    nodes.bar.setAttribute("aria-busy", applyRunning ? "true" : "false");
    syncActsOn();
  }

  function stopApplyJob(): void {
    if (applyTimer) {
      clearTimeout(applyTimer);
      applyTimer = null;
    }
    stopApplyProgress?.();
    stopApplyProgress = null;
    applyRunning = false;
    cancelling = false;
    releaseJob("apply");
    resetApplySub();
    sync();
  }

  /** Reload path: the backend keeps working, so an in-flight apply/export
   * keeps its claim — the terminal event still finalizes it. Only the
   * progress subscription (seq-gated) is dropped. */
  function reset(): void {
    seq.bump();
    if (!applyRunning && applyTimer) {
      clearTimeout(applyTimer);
      applyTimer = null;
    }
    stopApplyProgress?.();
    stopApplyProgress = null;
    if (!applyRunning && !exporting) resetApplySub();
    sync();
  }

  /** Language switch: the button + idle status re-render, then the bar. */
  function syncLang(): void {
    if (!applyRunning) {
      applyBtn.textContent = t("tex.apply");
      setApplyStatus(t("common.idle"));
    } else {
      applyBtn.textContent = t("tex.applying");
      applyCancel.textContent = cancelling ? t("common.cancelling") : t("common.cancel");
    }
    applyCancel.title = t("job.cancelTitle");
    sync();
    renderApplySub();
  }

  function finishApplyError(message: string): void {
    stopApplyJob();
    setApplyStatus(t("common.failed"));
    notify(message, "error");
  }

  /** Neutral end of a user-cancelled apply: info, never error; result kept. */
  function finishApplyCancelled(): void {
    stopApplyJob();
    setApplyStatus(t("job.cancelled"));
    notify(t("job.cancelled"), "info");
  }

  function renderApplyResult(res: OptimizeResult): void {
    clear(resultHost);
    const before = res.report.before.disk_total ?? res.report.before.disk_bytes;
    const after = res.report.after.disk_total ?? res.report.after.disk_bytes;
    const metrics =
      before != null && after != null
        ? `disk ${fmtBytes(before)} → ${fmtBytes(after)}`
        : t("common.done");
    const secs = fmtSecs(res.report.total_secs);
    resultHost.append(
      el(
        "div",
        { class: "row" },
        el("span", { class: "badge green", text: t("tex.ktx2Written") }),
        el("span", { class: "mono wrap", text: res.out_path, title: res.out_path }),
      ),
      el("div", { class: "hint", text: `${metrics} · ${t("tex.total", { secs })}` }),
      el("div", { class: "row" }, ...actionButtons(res.out_path)),
    );
  }

  function actionButtons(outPath: string): HTMLElement[] {
    return [
      bannerButton(t("common.view"), t("opt.viewTitle"), {
        primary: true,
        onClick: () => {
          app.setView(outPath);
          notify(t("opt.viewing", { path: outPath }), "ok");
        },
      }),
      bannerButton(t("common.useAsSource"), t("opt.useTitle"), {
        onClick: () => {
          app.useAsSource(outPath);
          notify(t("opt.sourceSet", { path: outPath }), "ok");
        },
      }),
      bannerButton(t("common.saveAs"), t("opt.saveTitle"), {
        onClick: () => void saveAs(outPath),
      }),
      revealButton(outPath),
    ];
  }

  function finishApply(res: OptimizeResult): void {
    stopApplyJob();
    setApplyStatus(t("common.done"));
    renderApplyResult(res);
    notify(t("tex.writtenTo", { path: res.out_path }), "ok");
  }

  /**
   * Explicit export of an apply result: the apply always starts from the
   * source model and writes into `.zig-cache/…` — this copies the finished
   * file wherever the user wants it.
   */
  async function saveAs(outPath: string): Promise<void> {
    if (exporting) {
      notify(t("opt.exportBusy"), "error");
      return;
    }
    const other = getJob();
    if (other.kind !== null) {
      notify(t("job.busyNote", { job: t(jobLabelKey(other.kind)) }), "error");
      return;
    }
    const dst = await pickSaveTarget(outPath);
    if (!dst) return; // cancel, no host, or dialog failure (already toasted)
    if (!claimJob("export")) {
      const owner = getJob().kind;
      notify(
        owner ? t("job.busyNote", { job: t(jobLabelKey(owner)) }) : t("opt.exportBusy"),
        "error",
      );
      return;
    }
    exporting = true;
    pendingDst = dst;
    armExportTimer();
    setApplyStatus(t("tex.stExporting", { path: dst }));
    try {
      await app.bridge.exportTo(outPath, dst);
    } catch (err) {
      stopExporting();
      setApplyStatus(t("common.failed"));
      notifyExportError(err);
    }
  }

  async function start(override?: EncodeSettings): Promise<void> {
    if (!app.bridge.live) {
      notify(t("tex.applyDemo"), "error");
      return;
    }
    const path = app.sourcePath;
    if (!path) {
      notify(t("tex.applyNoSource"), "error");
      return;
    }
    if (applyRunning) {
      notify(t("tex.applyBusy"), "error");
      return;
    }
    const other = getJob();
    if (other.kind !== null) {
      notify(t("job.busyNote", { job: t(jobLabelKey(other.kind)) }), "error");
      return;
    }
    const token = seq.next();
    claimJob("apply");
    applyRunning = true;
    cancelling = false;
    applyDone = -1;
    applyTotal = 0;
    renderApplySub();
    applyBtn.disabled = true;
    applyBtn.textContent = t("tex.applying");
    applyBtn.removeAttribute("aria-describedby");
    applyCancel.disabled = false;
    applyCancel.textContent = t("common.cancel");
    nodes.bar.setAttribute("aria-busy", "true");
    setApplyStatus(t("tex.stStarting"));
    // The previous result stays until the new one lands (no loss on cancel).
    const specJson = JSON.stringify({ steps: [{ textures: textureStep(override) }] });
    try {
      const call = await app.bridge.optimizeCustom(path, specJson, "desktop", (p) => {
        if (seq.check(token) && applyRunning) {
          setApplyStatus(
            cancelling ? t("job.cancelling") : `${p.step || t("opt.runningShort")} ${p.pct}%`,
          );
          if (p.sub?.label === "texture") {
            applyDone = Math.max(applyDone, p.sub.done);
            applyTotal = p.sub.total;
            renderApplySub();
          } else {
            resetApplySub();
          }
        }
      });
      if (!seq.check(token) || !applyRunning) return; // superseded while awaiting
      if (call.started) {
        stopApplyProgress = call.stopProgress;
        setApplyStatus(t("tex.stRunning"));
        armApplyTimer(token);
        return;
      }
      // Older hosts: the call itself returned the finished report.
      finishApply(call.result);
    } catch (err) {
      if (!seq.check(token)) return;
      stopApplyJob();
      setApplyStatus(t("common.failed"));
      notifyJobError(err, t("tex.applyBusy"), (message) => t("tex.applyFail", { message }));
    }
  }

  /** Timeout never frees the gate: the terminal event is still owed, so keep
   * waiting (and keep Cancel available) instead of releasing prematurely. */
  function armApplyTimer(token: number): void {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      applyTimer = null;
      if (!seq.check(token) || !applyRunning) return;
      setApplyStatus(t("job.stillRunning"));
      notify(t("job.stillRunning"), "info");
      armApplyTimer(token);
    }, APPLY_TIMEOUT_MS);
  }

  /**
   * Asks the host to stop the in-flight apply. The gate frees only on the
   * terminal done event, so nothing releases here. A refused/failed request
   * restores Cancel while the job keeps running; the running guard keeps a
   * late RPC from touching a job that already finished meanwhile.
   */
  async function cancel(): Promise<void> {
    if (!applyRunning || cancelling) return;
    cancelling = true;
    setJobCancelling("apply", true);
    applyCancel.textContent = t("common.cancelling");
    applyCancel.disabled = true;
    setApplyStatus(t("job.cancelling"));
    let accepted = false;
    let failed = false;
    try {
      accepted = (await app.bridge.cancelJob()).cancelled;
    } catch (err) {
      failed = true;
      notify(t("job.cancelFail", { message: (err as Error).message }), "error");
    }
    if (!applyRunning) return; // finished while the RPC flew
    if (!accepted) {
      cancelling = false;
      setJobCancelling("apply", false);
      sync(); // restores Cancel availability
      setApplyStatus(t("job.stillRunning"));
      if (!failed) notify(t("job.stillRunning"), "info");
    }
  }

  applyBtn.addEventListener("click", () => void start());

  applyCancel.addEventListener("click", () => void cancel());

  const offApplyDone = app.bridge.onOptimizeDone((event) => {
    if (!applyRunning) return;
    if (!event.ok) {
      if (isCancelledError(event.error)) {
        finishApplyCancelled();
        return;
      }
      finishApplyError(t("tex.applyFail", { message: event.error }));
      return;
    }
    finishApply(event.result);
  });

  // The copy this tab asked for (matched by dst so the Optimize tab's exports
  // don't double-notify here). `notify` fans out to the toast + status bar.
  const offExportDone = app.bridge.onExportDone((event) => {
    if (exporting && pendingDst != null) {
      if (event.ok && event.dst === pendingDst) {
        stopExporting();
        setApplyStatus(t("common.done"));
        notify(t("opt.savedTo", { path: event.dst }), "ok");
      } else if (!event.ok) {
        stopExporting();
        setApplyStatus(t("common.failed"));
        notify(t("opt.exportFail", { message: event.error }), "error");
      }
    }
  });

  sync();

  // Another tab claimed the gate (optimize/LODs/encode): reflect it here.
  const offJob = onJobChange(() => sync());

  /** Dispose path: like reset() but without touching bar DOM. An in-flight
   * gate is never freed here — the backend still owns it. */
  function teardown(): void {
    seq.bump();
    stopApplyProgress?.();
    stopApplyProgress = null;
    if (applyRunning || exporting) return;
    if (applyTimer) {
      clearTimeout(applyTimer);
      applyTimer = null;
    }
    clearExportTimer();
    applyDone = -1;
    applyTotal = 0;
    renderApplySub();
  }

  return {
    sync,
    syncActsOn,
    syncLang,
    reset,
    start,
    isRunning: () => applyRunning,
    cancel,
    dispose: () => {
      offApplyDone();
      offExportDone();
      offJob();
      teardown();
    },
  };
}
