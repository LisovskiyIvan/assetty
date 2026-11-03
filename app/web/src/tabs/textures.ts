import { app } from "../app";
import { isBusyError } from "../bridge";
import { isMissingMethodError, notify } from "../notify";
import { closeFieldHelp, fieldHelpButton } from "../optimizeForm";
import { onLang, t } from "../i18n";
import {
  el,
  fmtBytes,
  fmtPct,
  deltaClass,
  kv,
  psnrBadge,
  section,
  clear,
  copyText,
  emptyState,
  statChip,
  statChipNode,
} from "../ui";
import {
  clearTextureOverride,
  describeTextureDeviation,
  effectiveTextureParams,
  getTextureOverrides,
  replaceTextureOverride,
  textureOverrideForImage,
  textureOverridesCount,
  getSettings,
  onSettingsChange,
} from "../settings";
import type { TextureFormat, TextureOverride } from "../settings";
import type {
  EncodeResult,
  EncodeSettings,
  ImageInfo,
  OptimizeResult,
  TexturePreview,
} from "../types";
import type { TabHandle } from "./types";

const ENCODE_TIMEOUT_MS = 10 * 60 * 1000;
const PREVIEW_TIMEOUT_MS = 20_000;

/** One in-flight encode; the token invalidates replies from an older request. */
interface ActiveEncode {
  token: number;
  index: number;
  path: string;
}

interface CompareImages {
  before: string | null;
  after: string | null;
}

export function mountTextures(): TabHandle {
  const root = el("div", { class: "tab-body textures-tab" });
  const main = el("div", { class: "tab-main" });
  const headLabel = el("span", { text: t("tex.images") });
  const headNote = el("span", { class: "muted mono", text: t("tex.viewApply") });
  const head = el("div", { class: "panel-head" }, headLabel, headNote);
  const listHost = el("div", { class: "texture-list" });

  /* Apply-to-model toolbar: sits above the list, next to the preview hint. */
  const applyBtn = el("button", { class: "primary", text: t("tex.apply") });
  const applyParams = el("span", { class: "muted mono" });
  const applyStatus = el("span", { class: "muted mono", text: t("common.idle") });
  /** Which file each action targets (preview sees the view, apply reads the source). */
  const previewActs = el("div", { class: "hint muted mono" });
  const applyActs = el("div", { class: "hint muted mono" });
  const overridesNote = el("div", { class: "hint muted mono" });
  const applyResultHost = el("div");
  const applyHint = el("div", { class: "hint", text: t("tex.previewDry") });
  const firstRunHint = el("div", { class: "hint", text: t("tex.firstRun") });
  const applyBar = el(
    "div",
    { class: "panel-body" },
    applyHint,
    el("div", { class: "row" }, applyBtn, applyParams),
    applyActs,
    overridesNote,
    firstRunHint,
    el("div", { class: "hint" }, applyStatus),
    applyResultHost,
  );

  function basenameShort(path: string | null): string {
    if (!path) return t("common.noFile");
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : path;
  }

  /** Refresh the "acts on <path>" lines under Preview / Apply. */
  function syncActsOn(): void {
    previewActs.textContent = t("tex.previewActs", { name: basenameShort(app.viewPath) });
    previewActs.title = app.viewPath ?? t("tex.noFileViewed");
    applyActs.textContent = t("tex.applyActs", { name: basenameShort(app.sourcePath) });
    applyActs.title = app.sourcePath ?? t("tex.noSource");
  }
  syncActsOn();
  main.append(head, applyBar, listHost);

  const side = el("div", { class: "tab-side" });
  root.append(main, side);

  let images: ImageInfo[] = [];
  let selected = -1;
  /** True while the row editor commits (skip the full list rebuild). */
  let selfEdit = false;

  /* ------------------------------------------------------------- preview state */

  /** Last decoded preview; only rendered when it belongs to the selected image. */
  let preview: TexturePreview | null = null;
  /** Index whose preview is in flight (spinner row badge). */
  let previewing: number | null = null;
  let previewError: string | null = null;
  let previewErrorIndex: number | null = null;
  let previewSeq = 0;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  /* -------------------------------------------------------------- encode state */

  let activeEncode: ActiveEncode | null = null;
  let encodeSeq = 0;
  let encodeTimer: ReturnType<typeof setTimeout> | null = null;
  const results = new Map<number, EncodeResult>();
  const compares = new Map<number, CompareImages>();
  /** Bumped when the model changes so late compare loads cannot land on it. */
  let compareGen = 0;

  const encodeBtn = el("button", {
    class: "primary",
    text: t("tex.encodeBtn"),
    disabled: true,
  });

  const b64DataUrl = (b64: string): string =>
    b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64.replace(/\s+/g, "")}`;

  /** `-590 KB` without the unreadable raw-byte form. */
  function signedBytes(delta: number): string {
    if (!Number.isFinite(delta)) return "—";
    const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
    return `${sign}${fmtBytes(Math.abs(delta))}`;
  }

  /** Data URL of the already-decoded preview for `index`, if it matches. */
  function previewUrl(index: number): string | null {
    return preview && preview.index === index && preview.b64 ? b64DataUrl(preview.b64) : null;
  }

  /* ---------------------------------------------------------------- detail pane */

  function previewLoadingInner(): HTMLElement {
    return el("div", { class: "detail-loading" }, el("span", { class: "spin" }), t("tex.decoding"));
  }

  function renderPreviewInner(img: ImageInfo, shot: TexturePreview): HTMLElement {
    const dims =
      shot.width > 0 && shot.height > 0
        ? `${shot.width}×${shot.height}`
        : `${img.width}×${img.height}`;
    return el(
      "div",
      { class: "preview-figure" },
      el("img", {
        class: "preview-img",
        src: b64DataUrl(shot.b64),
        alt: img.name ?? `image ${img.index}`,
        title: `${dims} · ${img.format}`,
      }),
      el(
        "div",
        { class: "preview-meta" },
        el("div", { class: "hint", text: t("tex.asStored") }),
        kv([
          [t("tex.kvFormat"), img.format],
          [t("tex.kvSize"), dims],
          [t("tex.kvDisk"), fmtBytes(img.disk)],
          [t("tex.kvVram"), fmtBytes(img.vram)],
          [t("tex.kvMips"), img.has_mips ? t("tex.yes") : t("tex.no")],
        ]),
      ),
    );
  }

  function pctOf(before: number, after: number): number | null {
    return before > 0 ? ((after - before) / before) * 100 : null;
  }

  function deltaChip(label: string, before: number, after: number): HTMLElement {
    const chip = statChip(label, `${fmtBytes(before)} → ${fmtBytes(after)}`);
    const pct = pctOf(before, after);
    if (pct != null) {
      chip.el.append(el("span", { class: `chip-delta ${deltaClass(pct)}`, text: fmtPct(pct, 0) }));
    }
    return chip.el;
  }

  function metricsRow(img: ImageInfo, res: EncodeResult): HTMLElement {
    const mips =
      res.mip_levels != null ? String(res.mip_levels) : img.has_mips ? t("tex.yes") : t("tex.no");
    return el(
      "div",
      { class: "stat-row" },
      deltaChip(t("tex.kvDisk"), img.disk, res.ktx2_size),
      statChipNode("PSNR", psnrBadge(res.psnr)),
      deltaChip(t("tex.kvVram"), img.vram, res.vram_after),
      statChip(t("tex.kvMips"), mips).el,
      res.width && res.height ? statChip(t("tex.kvSource"), `${res.width}×${res.height}`).el : null,
    );
  }

  function appliedLine(res: EncodeResult): HTMLElement {
    const settings = res.settings;
    const parts: string[] = [];
    if (settings?.format) parts.push(t("tex.fFormat", { v: settings.format }));
    if (settings?.quality != null) parts.push(t("tex.fQuality", { v: settings.quality }));
    if (settings?.max_size != null) {
      parts.push(
        settings.max_size === 0 ? t("tex.fMaxOrig") : t("tex.fMaxSize", { v: settings.max_size }),
      );
    }
    if (settings?.generate_mips != null) {
      parts.push(settings.generate_mips ? t("tex.fMipsOn") : t("tex.fMipsOff"));
    }
    if (parts.length === 0 && res.format)
      parts.push(t("tex.fCodec", { v: res.format.toLowerCase() }));
    return el(
      "div",
      { class: "applied-line" },
      el("span", { class: "k", text: t("tex.applied") }),
      el("span", {
        class: "v",
        text: parts.length > 0 ? parts.join(" · ") : t("tex.notReported"),
      }),
    );
  }

  function compareTitle(res: EncodeResult): string {
    const format = String(res.format ?? res.settings?.format ?? "ktx2").toUpperCase();
    const quality = res.settings?.quality;
    return `KTX2 (${format}${quality != null ? ` q${quality}` : ""})`;
  }

  function comparePane(label: string, url: string | null, fallback: string): HTMLElement {
    return el(
      "figure",
      { class: "compare-pane" },
      el("figcaption", { class: "compare-label", text: label }),
      url
        ? el("img", { class: "compare-img", src: url, alt: label })
        : el("div", { class: "compare-placeholder", text: fallback }),
    );
  }

  /** Compare content (no outer wrapper — lives inside the single side panel). */
  function compareNodes(img: ImageInfo, res: EncodeResult): HTMLElement[] {
    const loaded = compares.get(img.index);
    const beforeUrl = loaded?.before ?? previewUrl(img.index);
    const afterUrl = loaded?.after ?? null;
    const out: HTMLElement[] = [
      el("div", { class: "section-title", text: t("tex.compare", { title: compareTitle(res) }) }),
      el(
        "div",
        { class: "row" },
        el("button", {
          class: "small",
          text: t("tex.applyShortcut"),
          title: t("tex.applyShortcutTitle"),
          onclick: () => void startApply(res.settings),
        }),
        el("div", { class: "hint", text: t("tex.writesWith") }),
      ),
    ];
    if (beforeUrl || afterUrl) {
      out.push(
        el(
          "div",
          { class: "compare-grid" },
          comparePane(
            t("tex.original"),
            beforeUrl,
            loaded ? t("tex.previewUnavailable") : t("tex.loadingPreviewsShort"),
          ),
          comparePane(
            compareTitle(res),
            afterUrl,
            loaded ? t("tex.hostMetricsOnly") : t("tex.loadingPreviewsShort"),
          ),
        ),
      );
    } else {
      out.push(
        el("div", {
          class: "hint",
          text: loaded ? t("tex.noPreviews") : t("tex.loadingPreviews"),
        }),
      );
    }
    out.push(metricsRow(img, res), appliedLine(res));
    return out;
  }

  /* ------------------------------------------------------------------- list */

  function rowBadge(img: ImageInfo): HTMLElement {
    if (img.skipped) return el("span", { class: "badge dim", text: t("tex.skipped") });
    if (activeEncode?.index === img.index) {
      return el("span", { class: "badge yellow", text: t("tex.previewing") });
    }
    if (previewing === img.index) {
      return el("span", { class: "badge dim", text: t("tex.loading") });
    }
    return img.has_mips
      ? el("span", { class: "badge green", text: t("tex.mips") })
      : el("span", { class: "badge dim", text: t("tex.noMips") });
  }

  /** Deviation from base params for one row (`uastc · 512 · q200`, `skipped`). */
  function deviationBadge(img: ImageInfo): HTMLElement {
    const src = app.sourcePath;
    const dev = src ? describeTextureDeviation(src, img.index, img.name) : null;
    const badge = el("span", {
      class: `badge ${dev === t("tex.skipped") ? "dim" : "accent"}`,
      text: dev ?? "",
      dataset: { ovbadge: String(img.index) },
      title: t("tex.ovTitle"),
    });
    badge.hidden = !dev;
    return badge;
  }

  /** Updates row + side-panel badges in place (no rebuild, so editors keep focus). */
  function refreshOverrideBadges(): void {
    const src = app.sourcePath;
    const skippedLabel = t("tex.skipped");
    for (const node of Array.from(listHost.querySelectorAll("[data-ovbadge]"))) {
      const badge = node as HTMLElement;
      const img = images.find((i) => i.index === Number(badge.dataset.ovbadge));
      const dev = img && src ? describeTextureDeviation(src, img.index, img.name) : null;
      badge.hidden = !dev;
      if (dev) {
        badge.textContent = dev;
        badge.classList.toggle("dim", dev === skippedLabel);
        badge.classList.toggle("accent", dev !== skippedLabel);
      }
    }
    for (const node of Array.from(side.querySelectorAll("[data-sidebadge]"))) {
      const badge = node as HTMLElement;
      const img = images.find((i) => i.index === Number(badge.dataset.sidebadge));
      const dev = img && src ? describeTextureDeviation(src, img.index, img.name) : null;
      badge.hidden = !dev;
      if (dev) {
        badge.textContent = dev;
        badge.classList.toggle("dim", dev === skippedLabel);
        badge.classList.toggle("accent", dev !== skippedLabel);
      }
    }
  }

  function renderList(): void {
    clear(listHost);
    if (images.length === 0) {
      if (app.sourcePath) {
        listHost.append(el("div", { class: "empty", text: t("tex.noImages") }));
      } else if (app.viewPath) {
        listHost.append(
          emptyState(t("viewer.noSourceHint"), {
            label: t("common.open"),
            onClick: () => void app.pickAndOpen(),
          }),
        );
      } else {
        listHost.append(
          emptyState(t("viewer.openHint"), {
            label: t("common.open"),
            onClick: () => void app.pickAndOpen(),
          }),
        );
      }
      return;
    }
    const body: HTMLElement[] = [];
    for (const img of images) {
      const formatText = img.effective_format ?? img.format;
      const formatCell = el("td", { class: "mono", text: formatText });
      if (img.effective_format && img.effective_format !== img.format) {
        formatCell.title = `stored: ${img.format} → effective: ${img.effective_format}`;
      }
      body.push(
        el(
          "tr",
          {
            class: `clickable ${img.index === selected ? "selected" : ""} ${
              img.index === previewing ? "previewing" : ""
            } ${img.index === activeEncode?.index ? "encoding" : ""} ${
              img.skipped ? "skipped" : ""
            }`,
            onclick: () => selectImage(img.index),
          },
          el("td", { class: "mono", text: String(img.index) }),
          el("td", null, el("span", { text: img.name ?? "—" }), " ", deviationBadge(img)),
          formatCell,
          el("td", { class: "num", text: `${img.width}×${img.height}` }),
          el("td", { class: "num", text: fmtBytes(img.disk) }),
          el("td", { class: "num", text: fmtBytes(img.vram) }),
          el("td", null, rowBadge(img)),
        ),
      );
    }
    const rows = body;
    listHost.append(
      el(
        "table",
        { class: "texture-table" },
        el(
          "thead",
          null,
          el(
            "tr",
            null,
            el("th", { text: t("tex.colNum") }),
            el("th", { text: t("tex.colName") }),
            el("th", { text: t("tex.colFormat") }),
            el("th", { class: "num", text: t("tex.colSize") }),
            el("th", { class: "num", text: t("tex.colDisk") }),
            el("th", { class: "num", text: t("tex.colVram") }),
            el("th", { text: "" }),
          ),
        ),
        el("tbody", null, ...rows),
      ),
    );
  }

  /* ------------------------------------------- per-texture override editor */

  /** Row's effective params for preview/encode (base + this row's override). */
  function effectiveFor(img: ImageInfo): EncodeSettings {
    const src = app.sourcePath;
    if (!src) {
      const b = getSettings().optimize.steps.textures;
      return {
        format: b.format,
        quality: b.quality,
        max_size: b.max_size,
        generate_mips: b.generate_mips,
      };
    }
    const eff = effectiveTextureParams(src, img.index, img.name);
    const out: EncodeSettings = {
      format: eff.format,
      quality: eff.quality,
      max_size: eff.max_size,
      generate_mips: eff.generate_mips,
    };
    if (eff.normal_map !== undefined) out.normal_map = eff.normal_map;
    return out;
  }

  const OV_FORMATS: Array<[string, string]> = [
    ["base", "base"],
    ["auto", "auto"],
    ["ETC1S", "etc1s"],
    ["UASTC", "uastc"],
  ];
  const OV_SIZES: Array<[string, string]> = [
    ["base", "base"],
    ["original", "0"],
    ["256", "256"],
    ["512", "512"],
    ["1024", "1024"],
    ["2048", "2048"],
  ];
  const OV_BINARY: Array<[string, string]> = [
    ["base", "base"],
    ["on", "on"],
    ["off", "off"],
  ];
  const OV_TERNARY: Array<[string, string]> = [
    ["inherit", "base"],
    ["yes", "yes"],
    ["no", "no"],
  ];

  /** Localized caption for an override option value. */
  function ovLabel(group: "format" | "size" | "binary" | "ternary", value: string): string {
    if (value === "base") return t("common.base");
    if (group === "size" && value === "original") return t("common.original");
    if (group === "binary") return value === "on" ? t("common.on") : t("common.off");
    if (group === "ternary") return value === "yes" ? t("common.yes") : t("common.no");
    return value;
  }

  /** Expandable per-texture editor. Overrides are stored per source model. */
  function overrideEditor(img: ImageInfo): HTMLElement {
    const src = app.sourcePath;
    if (!src) {
      return el("div", { class: "hint", text: t("tex.openSourceHint") });
    }
    const base = getSettings().optimize.steps.textures;
    const found = textureOverrideForImage(src, img.index);
    const draft: TextureOverride = {};
    if (found) {
      if (found.format !== undefined) draft.format = found.format;
      if (found.quality !== undefined) draft.quality = found.quality;
      if (found.max_size !== undefined) draft.max_size = found.max_size;
      if (found.generate_mips !== undefined) draft.generate_mips = found.generate_mips;
      if (found.normal_map !== undefined) draft.normal_map = found.normal_map;
      if (found.skip !== undefined) draft.skip = found.skip;
    }

    const commit = (): void => {
      selfEdit = true;
      try {
        replaceTextureOverride(src, { ...draft, image: img.index });
      } finally {
        selfEdit = false;
      }
      refreshOverrideBadges();
      syncApplyBar();
    };

    const form = el("div", { class: "ov-editor" });

    const mkSelect = (
      label: string,
      options: Array<[string, string]>,
      group: "format" | "size" | "binary" | "ternary",
      get: () => string,
      set: (value: string) => void,
      title?: string,
      helpId?: string,
    ): HTMLElement => {
      const node = el("select", { class: "compact", title });
      for (const [text, value] of options)
        node.append(el("option", { value, text: ovLabel(group, text) }));
      node.value = get();
      node.addEventListener("change", () => {
        set(node.value);
        commit();
      });
      const lab = el("span", { text: label });
      if (helpId) lab.append(" ", fieldHelpButton(helpId));
      return el("label", { class: "ov-field" }, lab, node);
    };

    form.append(
      mkSelect(
        "format",
        OV_FORMATS,
        "format",
        () => draft.format ?? "base",
        (v) => {
          if (v === "base") delete draft.format;
          else draft.format = v as TextureFormat;
        },
        t("tex.baseTitle", { v: base.format }),
      ),
    );

    const qualityInput = el("input", {
      type: "number",
      min: 1,
      max: 255,
      step: 1,
      class: "compact",
      title: t("tex.baseTitle", { v: base.quality }),
      placeholder: t("tex.baseTitle", { v: base.quality }),
    });
    qualityInput.value = draft.quality !== undefined ? String(draft.quality) : "";
    qualityInput.addEventListener("change", () => {
      const raw = qualityInput.value.trim();
      const n = Number(raw);
      if (!raw || !Number.isFinite(n)) delete draft.quality;
      else draft.quality = Math.round(Math.min(255, Math.max(1, n)));
      qualityInput.value = draft.quality !== undefined ? String(draft.quality) : "";
      commit();
    });
    form.append(el("label", { class: "ov-field" }, el("span", { text: "quality" }), qualityInput));

    form.append(
      mkSelect(
        "max size",
        OV_SIZES,
        "size",
        () => (draft.max_size !== undefined ? String(draft.max_size) : "base"),
        (v) => {
          if (v === "base") delete draft.max_size;
          else draft.max_size = Number(v);
        },
        t("tex.baseTitle", { v: base.max_size === 0 ? t("common.original") : base.max_size }),
      ),
      mkSelect(
        "mips",
        OV_BINARY,
        "binary",
        () => (draft.generate_mips === undefined ? "base" : draft.generate_mips ? "on" : "off"),
        (v) => {
          if (v === "base") delete draft.generate_mips;
          else draft.generate_mips = v === "on";
        },
        base.generate_mips ? t("tex.baseMipsOn") : t("tex.baseMipsOff"),
      ),
      mkSelect(
        "normal",
        OV_TERNARY,
        "ternary",
        () => (draft.normal_map === undefined ? "base" : draft.normal_map ? "yes" : "no"),
        (v) => {
          if (v === "base") delete draft.normal_map;
          else draft.normal_map = v === "yes";
        },
        t("tex.normalHint"),
        "textures.normal_map",
      ),
    );

    const skipBox = el("input", { type: "checkbox", title: t("tex.skipHint") });
    skipBox.checked = draft.skip === true;
    skipBox.addEventListener("change", () => {
      if (skipBox.checked) draft.skip = true;
      else delete draft.skip;
      commit();
    });
    form.append(
      el(
        "label",
        { class: "inline-check", title: t("tex.skipHint") },
        skipBox,
        el("span", { text: t("tex.skipLabel") }),
      ),
    );

    const head = el(
      "div",
      { class: "row spread" },
      el("span", {
        class: "muted mono",
        text: t("tex.ovForImage", { index: img.index }),
        title: t("tex.ovStored", { src }),
      }),
      el("button", {
        class: "small",
        text: t("common.reset"),
        title: t("tex.ovReset"),
        onclick: () => {
          clearTextureOverride(src, img.index);
          renderList();
          renderSide();
          syncApplyBar();
        },
      }),
    );

    const nameBased = getTextureOverrides(src).filter(
      (o) =>
        o.image === undefined &&
        !!o.name &&
        !!img.name &&
        img.name.toLowerCase().includes(o.name.toLowerCase()),
    );

    const wrap = el("div", { class: "ov-wrap" }, head, form);
    if (nameBased.length > 0) {
      wrap.append(
        el("div", {
          class: "hint",
          text: t("tex.ovNameMatched", { n: nameBased.length }),
        }),
      );
    }
    return wrap;
  }

  /* ------------------------------------------------------------------ side */

  function renderSide(): void {
    clear(side);
    const img = images.find((i) => i.index === selected);
    if (!img) {
      side.append(
        section(t("tex.detailTitle"), el("div", { class: "empty", text: t("tex.selectTexture") })),
      );
      encodeBtn.disabled = true;
      return;
    }
    const src = app.sourcePath;
    const dev = src ? describeTextureDeviation(src, img.index, img.name) : null;
    const skippedLabel = t("tex.skipped");
    const devBadge = el("span", {
      class: `badge ${dev === skippedLabel ? "dim" : "accent"}`,
      text: dev ?? "",
      dataset: { sidebadge: String(img.index) },
      title: t("tex.ovTitle"),
    });
    devBadge.hidden = !dev;
    /* One coherent panel: header (ellipsized name) + a single padded body
     * holding facts, preview, settings, dry-run and compare — no detached
     * floating blocks. The side column itself scrolls. */
    const name = img.name ?? `image ${img.index}`;
    const body = el(
      "div",
      { class: "panel-body" },
      el("div", { class: "hint mono", text: t("tex.imageN", { index: img.index }) }),
      kv([
        [t("tex.kvFormat"), img.effective_format ?? img.format],
        [t("tex.kvStored"), img.format],
        [t("tex.kvSize"), `${img.width}×${img.height}`],
        [t("tex.kvDisk"), fmtBytes(img.disk)],
        [t("tex.kvVram"), fmtBytes(img.vram)],
        [t("tex.kvMips"), img.has_mips ? t("tex.yes") : t("tex.no")],
      ]),
    );

    /* Preview thumbnail (existing flow: loading / error / decoded image). */
    if (previewing === img.index) {
      body.append(
        el("div", { class: "section-title", text: t("tex.preview") }),
        previewLoadingInner(),
      );
    } else if (previewError && previewErrorIndex === img.index) {
      body.append(
        el("div", { class: "section-title", text: t("tex.preview") }),
        el("div", { class: "empty", text: t("tex.previewFail", { message: previewError }) }),
      );
    } else if (preview && preview.index === img.index) {
      body.append(
        el("div", { class: "section-title", text: t("tex.preview") }),
        renderPreviewInner(img, preview),
      );
    }

    /* Per-texture editor, moved here verbatim from the old inline row. */
    body.append(
      el("div", { class: "section-title", text: t("tex.texSettings") }),
      overrideEditor(img),
    );

    const dryRun: Array<Node | string> = [
      el("div", { class: "row" }, encodeBtn),
      previewActs,
      el("div", {
        class: "hint",
        text: t("tex.dryRunHint"),
      }),
    ];
    const result = results.get(img.index);
    if (activeEncode?.index === img.index) {
      dryRun.push(el("span", { class: "badge yellow", text: t("tex.previewing") }));
    } else if (result) {
      dryRun.push(
        el(
          "div",
          { class: "row spread" },
          el("span", { class: "muted", text: "PSNR" }),
          psnrBadge(result.psnr),
        ),
        kv([
          [t("tex.kvKtx2"), fmtBytes(result.ktx2_size)],
          [t("tex.kvVramAfter"), fmtBytes(result.vram_after)],
          [t("tex.kvDiskDelta"), signedBytes(result.ktx2_size - img.disk)],
          [t("tex.kvVramDelta"), signedBytes(result.vram_after - img.vram)],
        ]),
      );
    } else {
      dryRun.push(el("div", { class: "muted", text: t("tex.notEncoded") }));
    }
    encodeBtn.textContent = activeEncode === null ? t("tex.encodeBtn") : t("tex.previewing");
    encodeBtn.disabled = !app.bridge.live || activeEncode !== null;
    body.append(el("div", { class: "section-title", text: t("tex.dryRun") }), ...dryRun);
    if (result) body.append(...compareNodes(img, result));
    side.append(
      el(
        "div",
        { class: "panel" },
        el(
          "div",
          { class: "panel-head" },
          el("span", { class: "tex-name", text: name, title: name }),
          el(
            "span",
            { class: "row" },
            devBadge,
            el("button", {
              class: "small",
              text: "✕",
              title: t("tex.deselect"),
              onclick: () => deselect(),
            }),
          ),
        ),
        body,
      ),
    );
  }

  /* --------------------------------------------------------------- preview run */

  function clearPreviewTimer(): void {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function armPreviewTimeout(seq: number, index: number): void {
    clearPreviewTimer();
    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (seq !== previewSeq || previewing !== index) return;
      previewing = null;
      previewError = t("tex.timeoutMsg");
      previewErrorIndex = index;
      renderList();
      renderSide();
      notify(t("tex.previewTimeout"), "error");
    }, PREVIEW_TIMEOUT_MS);
  }

  function applyPreview(index: number, result: TexturePreview): void {
    clearPreviewTimer();
    previewing = null;
    preview = { ...result, index };
    previewError = result.b64 ? null : t("tex.previewUnavailable");
    previewErrorIndex = result.b64 ? null : index;
    renderList();
    renderSide();
  }

  async function requestPreview(index: number): Promise<void> {
    const path = app.viewPath ?? (!app.bridge.live ? "/demo/DamagedHelmet.glb" : null);
    if (!path) return;
    const seq = ++previewSeq;
    previewing = index;
    preview = null;
    previewError = null;
    previewErrorIndex = null;
    clearPreviewTimer();
    renderList();
    renderSide();
    try {
      const img = images.find((i) => i.index === index);
      const call = await app.bridge.texturePreview(
        path,
        index,
        img ? effectiveFor(img) : undefined,
      );
      if (seq !== previewSeq) return; // another row was clicked meanwhile
      if (call.started) {
        armPreviewTimeout(seq, index);
        return;
      }
      applyPreview(index, call.result);
    } catch (err) {
      if (seq !== previewSeq) return;
      previewing = null;
      clearPreviewTimer();
      const missing = isMissingMethodError(err);
      const busy = isBusyError(err);
      const message = busy ? t("tex.previewBusy") : (err as Error).message;
      previewError = missing ? t("tex.notSupported") : message;
      previewErrorIndex = index;
      notify(
        missing
          ? t("tex.previewNoHost")
          : busy
            ? t("tex.previewBusy")
            : t("tex.previewFail", { message }),
        "error",
      );
      renderList();
      renderSide();
    }
  }

  function selectImage(index: number): void {
    selected = index;
    previewSeq++; // cancel any in-flight preview from the previous row
    preview = null;
    previewing = null;
    previewError = null;
    previewErrorIndex = null;
    clearPreviewTimer();
    renderList();
    renderSide();
    const cached = results.get(index);
    if (cached) void loadCompare(index, cached);
    void requestPreview(index);
  }

  /** Close the detail panel (✕ button or Escape). */
  function deselect(): void {
    selected = -1;
    previewSeq++; // cancel any in-flight preview
    preview = null;
    previewing = null;
    previewError = null;
    previewErrorIndex = null;
    clearPreviewTimer();
    renderList();
    renderSide();
  }

  /* ---------------------------------------------------------------- encodes */

  function clearEncodeState(): void {
    if (encodeTimer) {
      clearTimeout(encodeTimer);
      encodeTimer = null;
    }
    activeEncode = null;
  }

  function applyEncode(index: number, result: EncodeResult): void {
    const image = images.find((i) => i.index === index);
    clearEncodeState();
    if (!image) return;
    results.set(index, result);
    compares.delete(index);
    renderList();
    renderSide();
    if (selected === index) void loadCompare(index, result);
    notify(
      t("tex.encodeDone", {
        index,
        size: fmtBytes(result.ktx2_size),
        psnr: result.psnr.toFixed(1),
      }),
      "ok",
    );
  }

  async function loadCompare(index: number, result: EncodeResult): Promise<void> {
    if (compares.has(index)) return;
    if (!result.before_png && !result.after_png) {
      // Legacy payload: no rendered previews, keep the decoded original if we have it.
      compares.set(index, { before: previewUrl(index), after: null });
      renderSide();
      return;
    }
    const gen = compareGen;
    const [before, after] = await Promise.all([
      result.before_png ? app.bridge.pngDataUrl(result.before_png) : Promise.resolve(null),
      result.after_png ? app.bridge.pngDataUrl(result.after_png) : Promise.resolve(null),
    ]);
    if (gen !== compareGen) return;
    compares.set(index, { before: before ?? previewUrl(index), after });
    if (selected === index) renderSide();
  }

  async function startEncode(): Promise<void> {
    const path = app.viewPath;
    const img = images.find((i) => i.index === selected);
    if (!path || !img || activeEncode) return;
    const token = ++encodeSeq;
    activeEncode = { token, index: img.index, path };
    renderList();
    renderSide();
    try {
      const call = await app.bridge.textureEncode(path, img.index, effectiveFor(img));
      if (token !== encodeSeq || activeEncode?.token !== token) return;
      if (call.started) {
        encodeTimer = setTimeout(() => {
          encodeTimer = null;
          if (token !== encodeSeq) return;
          activeEncode = null;
          renderList();
          renderSide();
          notify(t("tex.encodeTimeout"), "error");
        }, ENCODE_TIMEOUT_MS);
        return;
      }
      applyEncode(img.index, call.result);
    } catch (err) {
      if (token !== encodeSeq) return;
      clearEncodeState();
      renderList();
      renderSide();
      notify(
        isBusyError(err)
          ? t("tex.encodeBusy")
          : t("tex.encodeFail", { message: (err as Error).message }),
        "error",
      );
    }
  }

  const offPreviewDone = app.bridge.onTexturePreviewDone((event) => {
    const current = previewing;
    if (current === null) return;
    if (event.index >= 0 && event.index !== current) return;
    if (!event.ok) {
      clearPreviewTimer();
      previewing = null;
      previewError = event.error;
      previewErrorIndex = current;
      renderList();
      renderSide();
      notify(t("tex.previewFail", { message: event.error }), "error");
      return;
    }
    applyPreview(event.index >= 0 ? event.index : current, event.result);
  });

  // Background encode: the call resolves with `{ started: true }` and the real
  // result arrives here (new hosts). Old hosts return the result directly.
  const offDone = app.bridge.onTextureEncodeDone((event) => {
    const active = activeEncode;
    if (!active) return;
    if (event.index >= 0 && event.index !== active.index) return;
    if (active.path !== app.viewPath) {
      // Model changed while the job ran: the result no longer applies.
      clearEncodeState();
      renderList();
      renderSide();
      return;
    }
    if (!event.ok) {
      clearEncodeState();
      renderList();
      renderSide();
      notify(t("tex.encodeFail", { message: event.error }), "error");
      return;
    }
    applyEncode(event.index >= 0 ? event.index : active.index, event.result);
  });

  encodeBtn.addEventListener("click", () => void startEncode());

  /* ------------------------------------------------------------ apply to model */

  const APPLY_TIMEOUT_MS = 10 * 60 * 1000;

  let applyRunning = false;
  let applySeq = 0;
  let applyTimer: ReturnType<typeof setTimeout> | null = null;
  let stopApplyProgress: (() => void) | null = null;
  /** True while an exportTo copy is in flight; `pendingDst` matches its event. */
  let exporting = false;
  let pendingDst: string | null = null;

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
    return n > 0 ? `${base} · ${t("tex.paramsOv", { n })}` : base;
  }

  function fmtSecs(secs: number | undefined): string {
    if (secs == null || !Number.isFinite(secs)) return "—";
    return secs < 1 ? `${Math.round(secs * 1000)} ms` : `${secs.toFixed(2)} s`;
  }

  function setApplyStatus(text: string): void {
    applyStatus.textContent = text;
  }

  function syncApplyBar(): void {
    applyParams.textContent = describeTextureParams();
    const src = app.sourcePath;
    const n = textureOverridesCount(src);
    overridesNote.textContent = src
      ? n > 0
        ? t("tex.overridesCount", { n })
        : t("tex.overridesNone")
      : t("tex.overridesNone");
    overridesNote.title = src ?? t("tex.noSource");
    applyBtn.disabled = applyRunning || !app.sourcePath;
    if (!applyRunning) applyBtn.textContent = t("tex.apply");
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
    syncApplyBar();
  }

  function finishApplyError(message: string): void {
    stopApplyJob();
    setApplyStatus(t("common.failed"));
    notify(message, "error");
  }

  function renderApplyResult(res: OptimizeResult): void {
    clear(applyResultHost);
    const before = res.report.before.disk_total ?? res.report.before.disk_bytes;
    const after = res.report.after.disk_total ?? res.report.after.disk_bytes;
    const metrics =
      before != null && after != null
        ? `disk ${fmtBytes(before)} → ${fmtBytes(after)}`
        : t("common.done");
    const secs = fmtSecs(res.report.total_secs);
    applyResultHost.append(
      el(
        "div",
        { class: "row" },
        el("span", { class: "badge green", text: t("tex.ktx2Written") }),
        el("span", { class: "mono wrap", text: res.out_path, title: res.out_path }),
      ),
      el("div", { class: "hint", text: `${metrics} · ${t("tex.total", { secs })}` }),
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
        el("button", {
          class: "small",
          text: t("tex.reveal"),
          title: t("tex.revealTitle", { path: res.out_path }),
          onclick: async () => {
            const ok = await copyText(res.out_path);
            notify(
              ok ? t("common.copied", { path: res.out_path }) : res.out_path,
              ok ? "ok" : "info",
            );
          },
        }),
      ),
    );
  }

  function finishApply(res: OptimizeResult): void {
    stopApplyJob();
    setApplyStatus(t("common.done"));
    renderApplyResult(res);
    notify(t("tex.writtenTo", { path: res.out_path }), "ok");
  }

  /** Last segment of a path (the save panel's suggested file name). */
  function basename(path: string): string {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : path;
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
    exporting = true;
    pendingDst = pick.path;
    setApplyStatus(t("tex.stExporting", { path: pick.path }));
    try {
      await app.bridge.exportTo(outPath, pick.path);
    } catch (err) {
      pendingDst = null;
      exporting = false;
      setApplyStatus(t("common.failed"));
      if (isBusyError(err)) {
        notify(t("opt.exportBusy"), "error");
      } else if (isMissingMethodError(err)) {
        notify(t("opt.exportNoHost"), "error");
      } else {
        notify(t("opt.exportFail", { message: (err as Error).message }), "error");
      }
    }
  }

  async function startApply(override?: EncodeSettings): Promise<void> {
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
    const token = ++applySeq;
    applyRunning = true;
    applyBtn.disabled = true;
    applyBtn.textContent = t("tex.applying");
    setApplyStatus(t("tex.stStarting"));
    clear(applyResultHost);
    const specJson = JSON.stringify({ steps: [{ textures: textureStep(override) }] });
    try {
      const call = await app.bridge.optimizeCustom(path, specJson, "desktop", (p) => {
        if (token === applySeq && applyRunning)
          setApplyStatus(`${p.step || t("opt.runningShort")} ${p.pct}%`);
      });
      if (token !== applySeq || !applyRunning) return; // superseded while awaiting
      if (call.started) {
        stopApplyProgress = call.stopProgress;
        setApplyStatus(t("tex.stRunning"));
        applyTimer = setTimeout(() => {
          applyTimer = null;
          if (token !== applySeq) return;
          finishApplyError(t("tex.applyTimeout"));
        }, APPLY_TIMEOUT_MS);
        return;
      }
      // Older hosts: the call itself returned the finished report.
      finishApply(call.result);
    } catch (err) {
      if (token !== applySeq) return;
      stopApplyJob();
      setApplyStatus(t("common.failed"));
      notify(
        isBusyError(err)
          ? t("tex.applyBusy")
          : t("tex.applyFail", { message: (err as Error).message }),
        "error",
      );
    }
  }

  applyBtn.addEventListener("click", () => void startApply());

  const offApplyDone = app.bridge.onOptimizeDone((event) => {
    if (!applyRunning) return;
    if (!event.ok) {
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
        pendingDst = null;
        exporting = false;
        setApplyStatus(t("common.done"));
        notify(t("opt.savedTo", { path: event.dst }), "ok");
      } else if (!event.ok) {
        pendingDst = null;
        exporting = false;
        setApplyStatus(t("common.failed"));
        notify(t("opt.exportFail", { message: event.error }), "error");
      }
    }
  });

  const offApplySettings = onSettingsChange(() => {
    if (!selfEdit) {
      renderList();
      renderSide();
    }
    syncApplyBar();
  });

  // Instant language switch: every string in this tab re-renders from the
  // active dictionary (the row editor keeps no static text of its own).
  const offLang = onLang(() => {
    headLabel.textContent = t("tex.images");
    headNote.textContent = t("tex.viewApply");
    applyHint.textContent = t("tex.previewDry");
    firstRunHint.textContent = t("tex.firstRun");
    if (!applyRunning) {
      applyBtn.textContent = t("tex.apply");
      setApplyStatus(t("common.idle"));
    } else {
      applyBtn.textContent = t("tex.applying");
    }
    syncApplyBar();
    renderList();
    renderSide();
  });

  /* ------------------------------------------------------------------ reload */

  async function reload(): Promise<void> {
    const path = app.viewPath;
    const keep = selected;
    images = [];
    selected = -1;
    preview = null;
    previewing = null;
    previewError = null;
    previewErrorIndex = null;
    clearPreviewTimer();
    previewSeq++;
    compareGen++;
    encodeSeq++;
    clearEncodeState();
    applySeq++;
    if (applyTimer) {
      clearTimeout(applyTimer);
      applyTimer = null;
    }
    stopApplyProgress?.();
    stopApplyProgress = null;
    applyRunning = false;
    exporting = false;
    pendingDst = null;
    syncApplyBar();
    syncActsOn();
    results.clear();
    compares.clear();
    renderList();
    renderSide();
    if (path || !app.bridge.live) {
      try {
        const res = await app.bridge.textures(path ?? "/demo/DamagedHelmet.glb");
        images = res.images.slice().sort((a, b) => a.index - b.index);
      } catch (err) {
        notify(t("tex.texturesFail", { message: (err as Error).message }), "error");
      }
    }
    /* Keep the selection when the same image survives the reload, else deselect. */
    selected = images.some((i) => i.index === keep) ? keep : -1;
    renderList();
    renderSide();
    if (selected >= 0) void requestPreview(selected);
  }

  const offView = app.on("view", () => {
    void reload();
  });
  const offSource = app.on("source", () => {
    syncApplyBar();
    syncActsOn();
    refreshOverrideBadges();
    renderList();
    renderSide();
  });

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && selected >= 0) deselect();
  };
  document.addEventListener("keydown", onKey);

  return {
    el: root,
    activate: () => {
      void reload();
    },
    deactivate: () => {
      closeFieldHelp();
    },
    dispose: () => {
      document.removeEventListener("keydown", onKey);
      offView();
      offSource();
      offDone();
      offPreviewDone();
      offApplyDone();
      offExportDone();
      offApplySettings();
      offLang();
      clearEncodeState();
      clearPreviewTimer();
      if (applyTimer) {
        clearTimeout(applyTimer);
        applyTimer = null;
      }
      stopApplyProgress?.();
      stopApplyProgress = null;
      applyRunning = false;
      previewSeq++;
      encodeSeq++;
      applySeq++;
      compareGen++;
    },
  };
}
