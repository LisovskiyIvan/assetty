/**
 * Textures tab: side detail panel (preview, facts, override editor, dry-run,
 * before/after compare). Stateless renders over caller-owned state.
 */
import { app } from "../../app";
import { fieldHelpButton } from "../../optimizeForm";
import { t } from "../../i18n";
import {
  el,
  fmtBytes,
  fmtPct,
  deltaClass,
  kv,
  psnrBadge,
  section,
  clear,
  statChip,
  statChipNode,
} from "../../ui";
import {
  describeTextureDeviation,
  effectiveTextureParams,
  getSettings,
  getTextureOverrides,
} from "../../settings";
import type { Supercompression, TextureFormat, TextureOverride } from "../../settings";
import type { EncodeResult, EncodeSettings, ImageInfo, TexturePreview } from "../../types";

export interface CompareImages {
  before: string | null;
  after: string | null;
}

export interface SidePanelState {
  images: ImageInfo[];
  selected: number;
  preview: TexturePreview | null;
  previewing: number | null;
  previewError: string | null;
  previewErrorIndex: number | null;
  results: Map<number, EncodeResult>;
  /** Dry-run encode in flight (button shows the busy label). */
  encoding: boolean;
  encodeBtn: HTMLButtonElement;
  /** "Acts on <view>" muted hint (owned by the apply bar, shown in dry-run). */
  previewActs: HTMLElement;
}

export interface SidePanelCbs {
  onDeselect(): void;
  onEncode(): void;
  onApplyShortcut(settings?: EncodeSettings): void;
  commitOverride(src: string, patch: TextureOverride): void;
  resetOverride(src: string, img: ImageInfo): void;
}

const b64DataUrl = (b64: string): string =>
  b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64.replace(/\s+/g, "")}`;

/** Data URL of the already-decoded preview for `index`, if it matches. */
export function previewUrlFor(preview: TexturePreview | null, index: number): string | null {
  return preview && preview.index === index && preview.b64 ? b64DataUrl(preview.b64) : null;
}

/** Row's effective params for preview/encode (base + this row's override). */
export function effectiveFor(img: ImageInfo): EncodeSettings {
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

/** `-590 KB` without the unreadable raw-byte form. */
function signedBytes(delta: number): string {
  if (!Number.isFinite(delta)) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${fmtBytes(Math.abs(delta))}`;
}

function previewLoadingInner(): HTMLElement {
  return el("div", { class: "detail-loading" }, el("span", { class: "spin" }), t("tex.decoding"));
}

function renderPreviewInner(img: ImageInfo, shot: TexturePreview): HTMLElement {
  const dims =
    shot.width > 0 && shot.height > 0
      ? `${shot.width}×${shot.height}`
      : `${img.width}×${img.height}`;
  // Image only: the facts block below carries format/size/disk/vram/mips,
  // so the figure stays a pure top-of-panel preview.
  return el(
    "div",
    { class: "preview-figure" },
    el("img", {
      class: "preview-img",
      src: b64DataUrl(shot.b64),
      alt: img.name ?? `image ${img.index}`,
      title: `${dims} · ${img.format}`,
    }),
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
function compareNodes(
  img: ImageInfo,
  res: EncodeResult,
  loaded: CompareImages | null | undefined,
  previewFallback: string | null,
  onApplyShortcut: (settings?: EncodeSettings) => void,
): HTMLElement[] {
  const beforeUrl = loaded?.before ?? previewFallback;
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
        onclick: () => onApplyShortcut(res.settings),
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
const OV_ZSTD: Array<[string, string]> = [
  ["base", "base"],
  ["none", "none"],
  ["zstd", "zstd"],
];

/** Localized caption for an override option value. */
function ovLabel(group: "format" | "size" | "binary" | "ternary" | "zstd", value: string): string {
  if (value === "base") return t("common.base");
  if (group === "size" && value === "original") return t("common.original");
  if (group === "binary") return value === "on" ? t("common.on") : t("common.off");
  if (group === "ternary") return value === "yes" ? t("common.yes") : t("common.no");
  return value;
}

/** Expandable per-texture editor. Overrides are stored per source model. */
function overrideEditor(img: ImageInfo, cbs: SidePanelCbs): HTMLElement {
  const src = app.sourcePath;
  if (!src) {
    return el("div", { class: "hint", text: t("tex.openSourceHint") });
  }
  const base = getSettings().optimize.steps.textures;
  const found = getTextureOverrides(src).find((o) => o.image === img.index);
  const draft: TextureOverride = {};
  if (found) {
    if (found.format !== undefined) draft.format = found.format;
    if (found.quality !== undefined) draft.quality = found.quality;
    if (found.max_size !== undefined) draft.max_size = found.max_size;
    if (found.generate_mips !== undefined) draft.generate_mips = found.generate_mips;
    if (found.normal_map !== undefined) draft.normal_map = found.normal_map;
    if (found.supercompression !== undefined) draft.supercompression = found.supercompression;
    if (found.skip !== undefined) draft.skip = found.skip;
  }

  const commit = (): void => {
    cbs.commitOverride(src, { ...draft, image: img.index });
  };

  const form = el("div", { class: "ov-editor" });

  const mkSelect = (
    label: string,
    options: Array<[string, string]>,
    group: "format" | "size" | "binary" | "ternary" | "zstd",
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
    mkSelect(
      "zstd",
      OV_ZSTD,
      "zstd",
      () => draft.supercompression ?? "base",
      (v) => {
        if (v === "base") delete draft.supercompression;
        else draft.supercompression = v as Supercompression;
      },
      t("tex.zstdHint"),
      "textures.supercompression",
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
      onclick: () => cbs.resetOverride(src, img),
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

export function renderSidePanel(
  side: HTMLElement,
  state: SidePanelState,
  cbs: SidePanelCbs,
  compares: Map<number, CompareImages>,
): void {
  const {
    images,
    selected,
    preview,
    previewing,
    previewError,
    previewErrorIndex,
    results,
    encoding,
    encodeBtn,
    previewActs,
  } = state;
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
  /* One coherent panel: header (ellipsized name) + a single padded body.
   * Order is deliberate: the PREVIEW IMAGE sits directly under the header,
   * then the kv facts, then Texture settings, dry-run and compare. The
   * side column itself scrolls. */
  const name = img.name ?? `image ${img.index}`;
  const body = el("div", { class: "panel-body" });

  /* Preview image first (loading / error / decoded states share the slot). */
  if (previewing === img.index) {
    body.append(previewLoadingInner());
  } else if (previewError && previewErrorIndex === img.index) {
    body.append(
      el("div", { class: "empty", text: t("tex.previewFail", { message: previewError }) }),
    );
  } else if (preview && preview.index === img.index) {
    body.append(renderPreviewInner(img, preview));
  }

  body.append(
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

  /* Per-texture editor, moved here verbatim from the old inline row. */
  body.append(
    el("div", { class: "section-title", text: t("tex.texSettings") }),
    overrideEditor(img, cbs),
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
  if (encoding) {
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
  encodeBtn.textContent = !encoding ? t("tex.encodeBtn") : t("tex.previewing");
  encodeBtn.disabled = !app.bridge.live || encoding;
  body.append(el("div", { class: "section-title", text: t("tex.dryRun") }), ...dryRun);
  if (result)
    body.append(
      ...compareNodes(
        img,
        result,
        compares.get(img.index),
        previewUrlFor(preview, img.index),
        (s) => cbs.onApplyShortcut(s),
      ),
    );
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
            onclick: () => cbs.onDeselect(),
          }),
        ),
      ),
      body,
    ),
  );
}
