import { app } from "../app";
import { isBusyError } from "../bridge";
import { isMissingMethodError, notify } from "../notify";
import { closeFieldHelp, fieldHelpButton } from "../optimizeForm";
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
  OPEN_HINT,
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
  const head = el(
    "div",
    { class: "panel-head" },
    el("span", { text: "images" }),
    el("span", { class: "muted mono", text: "images: view · apply: source" }),
  );
  const listHost = el("div", { class: "texture-list" });

  /* Apply-to-model toolbar: sits above the list, next to the preview hint. */
  const applyBtn = el("button", { class: "primary", text: "Apply to model…" });
  const applyParams = el("span", { class: "muted mono" });
  const applyStatus = el("span", { class: "muted mono", text: "idle" });
  /** Which file each action targets (preview sees the view, apply reads the source). */
  const previewActs = el("div", { class: "hint muted mono" });
  const applyActs = el("div", { class: "hint muted mono" });
  const overridesNote = el("div", { class: "hint muted mono" });
  const applyResultHost = el("div");
  const applyBar = el(
    "div",
    { class: "panel-body" },
    el("div", {
      class: "hint",
      text: "Preview = dry run. The model file is not modified. To write KTX2 into a new file use Apply to model.",
    }),
    el("div", { class: "row" }, applyBtn, applyParams),
    applyActs,
    overridesNote,
    el("div", {
      class: "hint",
      text: "First run on 7×2048² textures takes ~30–40s; re-running on KTX2 is fast (skipped).",
    }),
    el("div", { class: "hint" }, applyStatus),
    applyResultHost,
  );

  function basenameShort(path: string | null): string {
    if (!path) return "—";
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : path;
  }

  /** Refresh the "acts on <path>" lines under Preview / Apply. */
  function syncActsOn(): void {
    previewActs.textContent = `preview acts on view: ${basenameShort(app.viewPath)}`;
    previewActs.title = app.viewPath ?? "no file viewed";
    applyActs.textContent = `apply acts on source: ${basenameShort(app.sourcePath)}`;
    applyActs.title = app.sourcePath ?? "no source model";
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
    text: "Preview KTX2",
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

  function detailHead(title: string, img: ImageInfo): HTMLElement {
    return el(
      "div",
      { class: "detail-head" },
      el("span", { class: "detail-title", text: title }),
      el("span", {
        class: "muted mono",
        text: `image ${img.index}${img.name ? ` — ${img.name}` : ""}`,
      }),
    );
  }

  function previewLoading(img: ImageInfo): HTMLElement {
    return el(
      "div",
      { class: "detail-block" },
      detailHead("Preview", img),
      el("div", { class: "detail-loading" }, el("span", { class: "spin" }), "decoding image…"),
    );
  }

  function previewMessage(img: ImageInfo, message: string): HTMLElement {
    return el(
      "div",
      { class: "detail-block" },
      detailHead("Preview", img),
      el("div", { class: "empty", text: message }),
    );
  }

  function renderPreview(img: ImageInfo, shot: TexturePreview): HTMLElement {
    const dims =
      shot.width > 0 && shot.height > 0
        ? `${shot.width}×${shot.height}`
        : `${img.width}×${img.height}`;
    return el(
      "div",
      { class: "detail-block" },
      detailHead("Preview", img),
      el(
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
          el("div", { class: "hint", text: "as stored in the asset" }),
          kv([
            ["format", img.format],
            ["size", dims],
            ["disk", fmtBytes(img.disk)],
            ["vram est", fmtBytes(img.vram)],
            ["mips", img.has_mips ? "yes" : "no"],
          ]),
        ),
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
    const mips = res.mip_levels != null ? String(res.mip_levels) : img.has_mips ? "yes" : "no";
    return el(
      "div",
      { class: "stat-row" },
      deltaChip("disk", img.disk, res.ktx2_size),
      statChipNode("PSNR", psnrBadge(res.psnr)),
      deltaChip("VRAM est", img.vram, res.vram_after),
      statChip("mips", mips).el,
      res.width && res.height ? statChip("source", `${res.width}×${res.height}`).el : null,
    );
  }

  function appliedLine(res: EncodeResult): HTMLElement {
    const settings = res.settings;
    const parts: string[] = [];
    if (settings?.format) parts.push(`format ${settings.format}`);
    if (settings?.quality != null) parts.push(`quality ${settings.quality}`);
    if (settings?.max_size != null) {
      parts.push(`max_size ${settings.max_size === 0 ? "original" : settings.max_size}`);
    }
    if (settings?.generate_mips != null) {
      parts.push(`mips ${settings.generate_mips ? "on" : "off"}`);
    }
    if (parts.length === 0 && res.format) parts.push(`codec ${res.format.toLowerCase()}`);
    return el(
      "div",
      { class: "applied-line" },
      el("span", { class: "k", text: "applied" }),
      el("span", {
        class: "v",
        text: parts.length > 0 ? parts.join(" · ") : "not reported by this host",
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

  function renderCompare(img: ImageInfo, res: EncodeResult): HTMLElement {
    const loaded = compares.get(img.index);
    const beforeUrl = loaded?.before ?? previewUrl(img.index);
    const afterUrl = loaded?.after ?? null;
    const block = el(
      "div",
      { class: "detail-block" },
      el(
        "div",
        { class: "detail-head" },
        el("span", { class: "detail-title", text: "Preview (dry run) — not written anywhere" }),
        el("span", {
          class: "muted mono",
          text: `image ${img.index}${img.name ? ` — ${img.name}` : ""}`,
        }),
      ),
      el(
        "div",
        { class: "row" },
        el("button", {
          class: "small",
          text: "Apply to model…",
          title: "Write KTX2 with these preview settings into a new file",
          onclick: () => void startApply(res.settings),
        }),
        el("div", { class: "hint", text: "writes KTX2 with these settings" }),
      ),
    );
    if (beforeUrl || afterUrl) {
      block.append(
        el(
          "div",
          { class: "compare-grid" },
          comparePane("Original", beforeUrl, loaded ? "preview unavailable" : "loading…"),
          comparePane(
            compareTitle(res),
            afterUrl,
            loaded ? "host returned metrics only" : "loading…",
          ),
        ),
      );
    } else {
      block.append(
        el("div", {
          class: "hint",
          text: loaded
            ? "no before/after previews — this host returned metrics only"
            : "loading previews…",
        }),
      );
    }
    block.append(metricsRow(img, res), appliedLine(res));
    return block;
  }

  /* ------------------------------------------------------------------- list */

  function rowBadge(img: ImageInfo): HTMLElement {
    if (img.skipped) return el("span", { class: "badge dim", text: "skipped" });
    if (activeEncode?.index === img.index) {
      return el("span", { class: "badge yellow", text: "previewing…" });
    }
    if (previewing === img.index) {
      return el("span", { class: "badge dim", text: "loading…" });
    }
    return img.has_mips
      ? el("span", { class: "badge green", text: "mips" })
      : el("span", { class: "badge dim", text: "no mips" });
  }

  /** Deviation from base params for one row (`uastc · 512 · q200`, `skipped`). */
  function deviationBadge(img: ImageInfo): HTMLElement {
    const src = app.sourcePath;
    const dev = src ? describeTextureDeviation(src, img.index, img.name) : null;
    const badge = el("span", {
      class: `badge ${dev === "skipped" ? "dim" : "accent"}`,
      text: dev ?? "",
      dataset: { ovbadge: String(img.index) },
      title: "per-texture override (deviation from base params)",
    });
    badge.hidden = !dev;
    return badge;
  }

  /** Updates row + side-panel badges in place (no rebuild, so editors keep focus). */
  function refreshOverrideBadges(): void {
    const src = app.sourcePath;
    for (const node of Array.from(listHost.querySelectorAll("[data-ovbadge]"))) {
      const badge = node as HTMLElement;
      const img = images.find((i) => i.index === Number(badge.dataset.ovbadge));
      const dev = img && src ? describeTextureDeviation(src, img.index, img.name) : null;
      badge.hidden = !dev;
      if (dev) {
        badge.textContent = dev;
        badge.classList.toggle("dim", dev === "skipped");
        badge.classList.toggle("accent", dev !== "skipped");
      }
    }
    for (const node of Array.from(side.querySelectorAll("[data-sidebadge]"))) {
      const badge = node as HTMLElement;
      const img = images.find((i) => i.index === Number(badge.dataset.sidebadge));
      const dev = img && src ? describeTextureDeviation(src, img.index, img.name) : null;
      badge.hidden = !dev;
      if (dev) {
        badge.textContent = dev;
        badge.classList.toggle("dim", dev === "skipped");
        badge.classList.toggle("accent", dev !== "skipped");
      }
    }
  }

  function renderList(): void {
    clear(listHost);
    if (images.length === 0) {
      if (app.sourcePath) {
        listHost.append(el("div", { class: "empty", text: "no images in this asset" }));
      } else if (app.viewPath) {
        listHost.append(
          emptyState("No source model — open one (⌘O) or use as source", {
            label: "Open…",
            onClick: () => void app.pickAndOpen(),
          }),
        );
      } else {
        listHost.append(
          emptyState(OPEN_HINT, { label: "Open…", onClick: () => void app.pickAndOpen() }),
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
            el("th", { text: "#" }),
            el("th", { text: "name" }),
            el("th", { text: "format" }),
            el("th", { class: "num", text: "size" }),
            el("th", { class: "num", text: "disk" }),
            el("th", { class: "num", text: "vram" }),
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
      const t = getSettings().optimize.steps.textures;
      return {
        format: t.format,
        quality: t.quality,
        max_size: t.max_size,
        generate_mips: t.generate_mips,
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

  /** Expandable per-texture editor. Overrides are stored per source model. */
  function overrideEditor(img: ImageInfo): HTMLElement {
    const src = app.sourcePath;
    if (!src) {
      return el("div", {
        class: "hint",
        text: "Open a source model to edit per-texture overrides (overrides apply to source).",
      });
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
      get: () => string,
      set: (value: string) => void,
      title?: string,
      helpId?: string,
    ): HTMLElement => {
      const node = el("select", { class: "compact", title });
      for (const [text, value] of options) node.append(el("option", { value, text }));
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
        () => draft.format ?? "base",
        (v) => {
          if (v === "base") delete draft.format;
          else draft.format = v as TextureFormat;
        },
        `base: ${base.format}`,
      ),
    );

    const qualityInput = el("input", {
      type: "number",
      min: 1,
      max: 255,
      step: 1,
      class: "compact",
      title: `base: ${base.quality} (empty = inherit)`,
      placeholder: `base ${base.quality}`,
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
        () => (draft.max_size !== undefined ? String(draft.max_size) : "base"),
        (v) => {
          if (v === "base") delete draft.max_size;
          else draft.max_size = Number(v);
        },
        `base: ${base.max_size === 0 ? "original" : base.max_size}`,
      ),
      mkSelect(
        "mips",
        OV_BINARY,
        () => (draft.generate_mips === undefined ? "base" : draft.generate_mips ? "on" : "off"),
        (v) => {
          if (v === "base") delete draft.generate_mips;
          else draft.generate_mips = v === "on";
        },
        `base: ${base.generate_mips ? "on" : "off"}`,
      ),
      mkSelect(
        "normal",
        OV_TERNARY,
        () => (draft.normal_map === undefined ? "base" : draft.normal_map ? "yes" : "no"),
        (v) => {
          if (v === "base") delete draft.normal_map;
          else draft.normal_map = v === "yes";
        },
        "normal_map: hint for the encoder",
        "textures.normal_map",
      ),
    );

    const skipBox = el("input", { type: "checkbox", title: "leave as-is (not encoded)" });
    skipBox.checked = draft.skip === true;
    skipBox.addEventListener("change", () => {
      if (skipBox.checked) draft.skip = true;
      else delete draft.skip;
      commit();
    });
    form.append(
      el(
        "label",
        { class: "inline-check", title: "skip: leave as-is (not encoded)" },
        skipBox,
        el("span", { text: "SKIP" }),
      ),
    );

    const head = el(
      "div",
      { class: "row spread" },
      el("span", {
        class: "muted mono",
        text: `override image ${img.index} — applies to source`,
        title: `stored under per_model[${src}]`,
      }),
      el("button", {
        class: "small",
        text: "Reset",
        title: "clear this row's override",
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
          text: `also matched by ${nameBased.length} name-based override(s) from JSON`,
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
      side.append(section("Texture", el("div", { class: "empty", text: "select a texture" })));
      encodeBtn.disabled = true;
      return;
    }
    const src = app.sourcePath;
    const dev = src ? describeTextureDeviation(src, img.index, img.name) : null;
    const devBadge = el("span", {
      class: `badge ${dev === "skipped" ? "dim" : "accent"}`,
      text: dev ?? "",
      dataset: { sidebadge: String(img.index) },
      title: "per-texture override (deviation from base params)",
    });
    devBadge.hidden = !dev;
    side.append(
      el(
        "div",
        { class: "panel" },
        el(
          "div",
          { class: "panel-head" },
          el("span", {
            text: img.name ?? `image ${img.index}`,
            title: img.name ?? `image ${img.index}`,
          }),
          el(
            "span",
            { class: "row" },
            devBadge,
            el("button", {
              class: "small",
              text: "✕",
              title: "deselect (Esc)",
              onclick: () => deselect(),
            }),
          ),
        ),
        el(
          "div",
          { class: "panel-body" },
          el("div", {
            class: "hint mono",
            text: `image ${img.index}`,
          }),
          kv([
            ["format", img.effective_format ?? img.format],
            ["stored", img.format],
            ["size", `${img.width}×${img.height}`],
            ["disk", fmtBytes(img.disk)],
            ["vram est", fmtBytes(img.vram)],
            ["mips", img.has_mips ? "yes" : "no"],
          ]),
        ),
      ),
    );

    /* Preview thumbnail (existing flow: loading / error / decoded image). */
    if (previewing === img.index) {
      side.append(previewLoading(img));
    } else if (previewError && previewErrorIndex === img.index) {
      side.append(previewMessage(img, `preview failed: ${previewError}`));
    } else if (preview && preview.index === img.index) {
      side.append(renderPreview(img, preview));
    }

    /* Per-texture editor, moved here verbatim from the old inline row. */
    side.append(section("Texture settings", overrideEditor(img)));

    const body: Array<Node | string> = [
      el("div", { class: "row" }, encodeBtn),
      previewActs,
      el("div", {
        class: "hint",
        text: "dry run — the model file is not modified",
      }),
    ];
    const result = results.get(img.index);
    if (activeEncode?.index === img.index) {
      body.push(el("span", { class: "badge yellow", text: "previewing…" }));
    } else if (result) {
      body.push(
        el(
          "div",
          { class: "row spread" },
          el("span", { class: "muted", text: "PSNR" }),
          psnrBadge(result.psnr),
        ),
        kv([
          ["ktx2 size", fmtBytes(result.ktx2_size)],
          ["vram after", fmtBytes(result.vram_after)],
          ["disk delta", signedBytes(result.ktx2_size - img.disk)],
          ["vram delta", signedBytes(result.vram_after - img.vram)],
        ]),
      );
    } else {
      body.push(el("div", { class: "muted", text: "not encoded yet" }));
    }
    encodeBtn.textContent = activeEncode === null ? "Preview KTX2" : "previewing…";
    encodeBtn.disabled = !app.bridge.live || activeEncode !== null;
    side.append(section("Preview (dry run)", ...body));
    if (result) side.append(renderCompare(img, result));
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
      previewError = "no completion event (timed out)";
      previewErrorIndex = index;
      renderList();
      renderSide();
      notify("texture preview timed out — no completion event", "error");
    }, PREVIEW_TIMEOUT_MS);
  }

  function applyPreview(index: number, result: TexturePreview): void {
    clearPreviewTimer();
    previewing = null;
    preview = { ...result, index };
    previewError = result.b64 ? null : "empty image returned";
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
      const message = busy ? "a background job is still running" : (err as Error).message;
      previewError = missing ? "not supported by this host" : message;
      previewErrorIndex = index;
      notify(
        missing
          ? "texture preview unavailable — rebuild the assetty binary"
          : busy
            ? "a background job is running — preview unavailable right now"
            : `preview failed: ${message}`,
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
    notify(`image ${index}: ${fmtBytes(result.ktx2_size)} @ ${result.psnr.toFixed(1)} dB`, "ok");
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
          notify("texture encode timed out — no completion event", "error");
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
          ? "texture encode already running — wait for it to finish"
          : `encode failed: ${(err as Error).message}`,
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
      notify(`preview failed: ${event.error}`, "error");
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
      notify(`encode failed: ${event.error}`, "error");
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
    const t = getSettings().optimize.steps.textures;
    const spec: Record<string, unknown> = {
      format: override?.format ?? t.format,
      quality: override?.quality ?? t.quality,
      rdo_lambda: 1,
      generate_mips: override?.generate_mips ?? t.generate_mips,
      max_size: override?.max_size ?? t.max_size,
    };
    if (override?.normal_map !== undefined) spec.normal_map = override.normal_map;
    const src = app.sourcePath;
    const list = getTextureOverrides(src);
    if (list.length > 0) spec.overrides = list.map((o) => ({ ...o }));
    return spec;
  }

  function describeTextureParams(): string {
    const t = getSettings().optimize.steps.textures;
    const size = t.max_size === 0 ? "orig" : String(t.max_size);
    const n = textureOverridesCount(app.sourcePath);
    const base = `${t.format} · q${t.quality} · ${size} · mips ${t.generate_mips ? "on" : "off"}`;
    return n > 0 ? `${base} · ${n} override${n === 1 ? "" : "s"}` : base;
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
        ? `overrides apply to source: ${n} for this model`
        : "overrides apply to source: none for this model"
      : "overrides apply to source: no source model";
    overridesNote.title = src ?? "";
    applyBtn.disabled = applyRunning || !app.sourcePath;
    if (!applyRunning) applyBtn.textContent = "Apply to model…";
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
    setApplyStatus("failed");
    notify(message, "error");
  }

  function renderApplyResult(res: OptimizeResult): void {
    clear(applyResultHost);
    const before = res.report.before.disk_total ?? res.report.before.disk_bytes;
    const after = res.report.after.disk_total ?? res.report.after.disk_bytes;
    const metrics =
      before != null && after != null ? `disk ${fmtBytes(before)} → ${fmtBytes(after)}` : "done";
    const secs = fmtSecs(res.report.total_secs);
    applyResultHost.append(
      el(
        "div",
        { class: "row" },
        el("span", { class: "badge green", text: "KTX2 written" }),
        el("span", { class: "mono wrap", text: res.out_path, title: res.out_path }),
      ),
      el("div", { class: "hint", text: `${metrics} · total ${secs}` }),
      el(
        "div",
        { class: "row" },
        el("button", {
          class: "small primary",
          text: "View result",
          title: "Load the KTX2 file into the viewer (the optimize source is unchanged)",
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
        el("button", {
          class: "small",
          text: "Reveal path",
          title: res.out_path,
          onclick: async () => {
            const ok = await copyText(res.out_path);
            notify(ok ? `copied ${res.out_path}` : res.out_path, ok ? "ok" : "info");
          },
        }),
      ),
    );
  }

  function finishApply(res: OptimizeResult): void {
    stopApplyJob();
    setApplyStatus("done");
    renderApplyResult(res);
    notify(`KTX2 written to ${res.out_path}`, "ok");
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
    exporting = true;
    pendingDst = pick.path;
    setApplyStatus(`exporting to ${pick.path}…`);
    try {
      await app.bridge.exportTo(outPath, pick.path);
    } catch (err) {
      pendingDst = null;
      exporting = false;
      setApplyStatus("failed");
      if (isBusyError(err)) {
        notify("export already running — wait for it to finish", "error");
      } else if (isMissingMethodError(err)) {
        notify("export unavailable — rebuild the assetty binary", "error");
      } else {
        notify(`export failed: ${(err as Error).message}`, "error");
      }
    }
  }

  async function startApply(override?: EncodeSettings): Promise<void> {
    if (!app.bridge.live) {
      notify("demo mode — apply needs the assetty binary", "error");
      return;
    }
    const path = app.sourcePath;
    if (!path) {
      notify("no source model — open one (⌘O) or use as source", "error");
      return;
    }
    if (applyRunning) {
      notify("apply already running — wait for it to finish", "error");
      return;
    }
    const token = ++applySeq;
    applyRunning = true;
    applyBtn.disabled = true;
    applyBtn.textContent = "Applying…";
    setApplyStatus("starting…");
    clear(applyResultHost);
    const specJson = JSON.stringify({ steps: [{ textures: textureStep(override) }] });
    try {
      const call = await app.bridge.optimizeCustom(path, specJson, "desktop", (p) => {
        if (token === applySeq && applyRunning) setApplyStatus(`${p.step || "running…"} ${p.pct}%`);
      });
      if (token !== applySeq || !applyRunning) return; // superseded while awaiting
      if (call.started) {
        stopApplyProgress = call.stopProgress;
        setApplyStatus("running…");
        applyTimer = setTimeout(() => {
          applyTimer = null;
          if (token !== applySeq) return;
          finishApplyError("apply timed out — no completion event within 10 minutes");
        }, APPLY_TIMEOUT_MS);
        return;
      }
      // Older hosts: the call itself returned the finished report.
      finishApply(call.result);
    } catch (err) {
      if (token !== applySeq) return;
      stopApplyJob();
      setApplyStatus("failed");
      notify(
        isBusyError(err)
          ? "apply already running — wait for it to finish"
          : `apply failed: ${(err as Error).message}`,
        "error",
      );
    }
  }

  applyBtn.addEventListener("click", () => void startApply());

  const offApplyDone = app.bridge.onOptimizeDone((event) => {
    if (!applyRunning) return;
    if (!event.ok) {
      finishApplyError(`apply failed: ${event.error}`);
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
        setApplyStatus("done");
        notify(`saved to ${event.dst}`, "ok");
      } else if (!event.ok) {
        pendingDst = null;
        exporting = false;
        setApplyStatus("failed");
        notify(`export failed: ${event.error}`, "error");
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
        notify(`textures failed: ${(err as Error).message}`, "error");
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
