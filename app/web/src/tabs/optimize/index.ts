/** Optimize tab mount: layout, step form, result state, subscriptions. */
import { app } from "../../app";
import { buildOptimizeForm, closeFieldHelp, fieldHelpButton } from "../../optimizeForm";
import { onLang, t } from "../../i18n";
import { getSettings, onSettingsChange, textureOverridesCount } from "../../settings";
import type { OptimizeSteps, TextureFormat } from "../../settings";
import { el, clear } from "../../ui";
import { notify } from "../../notify";
import type { OptimizeResult } from "../../types";
import type { TabHandle } from "../types";
import { createDualView } from "./dual";
import { createReport } from "./report";
import { createRunFlow } from "./run";

export function mountOptimize(): TabHandle {
  const root = el("div", { class: "tab-body wide-side" });
  const main = el("div", { class: "tab-main" });

  const dual = createDualView(main);
  const side = el("div", { class: "tab-side" });
  root.append(main, side);

  let lastResult: OptimizeResult | null = null;
  /** Last rendered report numbers. Survives a discard (only the artifact
   * goes) so the before/after table stays put; cleared by the next run. */
  let lastReport: OptimizeResult | null = null;

  const run = createRunFlow({
    dual,
    getResult: () => lastResult,
    onRunStarted: () => {
      lastResult = null;
      lastReport = null;
      report.reset();
    },
    onFinished: (res) => {
      lastResult = res;
      lastReport = res;
      report.render(res, true);
      dual.setResult(res);
    },
    onDiscarded: (outPath) => {
      // A new run may have superseded this result while the unlink was in flight.
      if (lastResult?.out_path !== outPath) return;
      lastResult = null;
      dual.setResult(null);
      if (lastReport) report.render(lastReport, false);
      syncAll();
      if (app.viewPath === outPath && app.sourcePath) app.setView(app.sourcePath);
      notify(t("opt.discarded"), "ok");
    },
    refreshTexExtra: () => syncTexExtra(),
  });
  side.append(run.panel);

  /* -------------------------------------------------------------- step rows */

  const stepsPanel = el("div", { class: "panel" });
  const stepsBody = el("div", { class: "panel-body form" });
  const stepsHead = el("span");
  stepsPanel.append(el("div", { class: "panel-head" }, stepsHead), stepsBody);
  side.append(stepsPanel);

  const texExtra = el("div", { class: "tex-extra" });

  // Step parameters live in the shared settings state (Settings tab edits the
  // same object); every change is applied in-app immediately and debounce-saved.
  const steps = (): OptimizeSteps => getSettings().optimize.steps;
  /** (Re)builds the shared step form in the active language. */
  let form = buildOptimizeForm(stepsBody, { get: steps, edit: run.edit });
  function buildForm(): void {
    clear(stepsBody);
    form = buildOptimizeForm(stepsBody, { get: steps, edit: run.edit });
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
              run.edit((s) => {
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

  /* ------------------------------------------------------------------ report */

  const report = createReport({
    onSaveAs: (path) => void run.saveAs(path),
    onDiscard: (path) => run.discardResult(path),
  });
  side.append(report.panel);
  side.append(run.exportNote);

  function syncStatic(): void {
    stepsHead.textContent = t("opt.stepsTitle");
    report.syncHead();
    dual.resync();
    run.syncTexts();
    dual.syncEmptyHint();
  }

  function syncAll(): void {
    form.sync();
    syncTexExtra();
    run.syncControls();
    syncStatic();
  }
  syncAll();

  const offSource = app.on("source", (d) => {
    void run.loadSource(d.path);
  });
  const offView = app.on("view", () => {
    run.syncSourceHead();
  });
  // Settings can change elsewhere (Settings tab / reload from file): keep the
  // controls in sync unless this tab is the origin of the change.
  const offSettings = onSettingsChange(() => {
    if (!run.isInternalEdit()) syncAll();
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
    if (lastReport) report.render(lastReport, lastResult?.out_path === lastReport.out_path);
    else report.reset();
    syncAll();
  });

  return {
    el: root,
    activate: () => {
      const first = dual.scenes() === null;
      const ready = dual.ensureScenes();
      if (ready && first) {
        const s = dual.scenes();
        if (s) {
          // Headless checks need both panes (the shared hook only exposes the
          // Viewer tab's scene) plus the compare-mode state.
          const dbg = (window as unknown as Record<string, unknown>)["__assetty"] as
            | Record<string, unknown>
            | undefined;
          if (dbg) {
            dbg["panes"] = () => dual.scenes();
            dbg["compare"] = () => ({
              mode: dual.compareMode(),
              split: dual.splitPos(),
              hasResult: dual.hasResult(),
            });
            dbg["setCompareMode"] = (mode: string) =>
              dual.setCompareMode(mode === "split" ? "split" : "side");
          }
          if (app.sourcePath) void run.loadSource(app.sourcePath);
          else if (!app.bridge.live) {
            dual.loadLeftDemo();
            dual.loadRightDemo();
          } else {
            dual.showOpenHint();
          }
        }
      }
      // The canvas was `display: none` while the tab was hidden: the observer's
      // 0×0 notifications were (correctly) ignored, so re-sync once the pane
      // actually has a box again.
      dual.forceResize();
      void run.loadPresets();
      syncAll();
      dual.resync();
    },
    deactivate: () => {
      closeFieldHelp();
      dual.pause();
    },
    dispose: () => {
      offSource();
      offView();
      offSettings();
      offLang();
      run.dispose();
      dual.disposeScenes();
    },
  };
}
