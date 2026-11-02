import { app } from "../app";
import { isBusyError } from "../bridge";
import { isMissingMethodError, notify } from "../notify";
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
import { getSettings, onSettingsChange } from "../settings";
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
  const root = el("div", { class: "tab-body" });
  const main = el("div", { class: "tab-main" });
  const head = el(
    "div",
    { class: "panel-head" },
    el("span", { text: "images" }),
    el("span", { class: "muted mono", text: "source: info()" }),
  );
  const listHost = el("div", { class: "texture-list" });
  const detailHost = el("div", { class: "texture-detail" });
  detailHost.hidden = true;

  /* Apply-to-model toolbar: sits above the list, next to the preview hint. */
  const applyBtn = el("button", { class: "primary", text: "Apply to model…" });
  const applyParams = el("span", { class: "muted mono" });
  const applyStatus = el("span", { class: "muted mono", text: "idle" });
  const applyResultHost = el("div");
  const applyBar = el(
    "div",
    { class: "panel-body" },
    el("div", {
      class: "hint",
      text: "Preview = dry run. The model file is not modified. To write KTX2 into a new file use Apply to model.",
    }),
    el("div", { class: "row" }, applyBtn, applyParams),
    el("div", {
      class: "hint",
      text: "First run on 7×2048² textures takes ~30–40s; re-running on KTX2 is fast (skipped).",
    }),
    el("div", { class: "hint" }, applyStatus),
    applyResultHost,
  );
  main.append(head, applyBar, listHost, detailHost);

  const side = el("div", { class: "tab-side" });
  root.append(main, side);

  let images: ImageInfo[] = [];
  let selected = -1;

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

  function renderDetail(): void {
    clear(detailHost);
    const img = images[selected];
    if (!img) {
      detailHost.hidden = true;
      return;
    }
    const result = results.get(img.index);
    if (result) {
      detailHost.hidden = false;
      detailHost.append(renderCompare(img, result));
      return;
    }
    if (previewing === img.index) {
      detailHost.hidden = false;
      detailHost.append(previewLoading(img));
      return;
    }
    if (previewError && previewErrorIndex === img.index) {
      detailHost.hidden = false;
      detailHost.append(previewMessage(img, `preview failed: ${previewError}`));
      return;
    }
    if (preview && preview.index === img.index) {
      detailHost.hidden = false;
      detailHost.append(renderPreview(img, preview));
      return;
    }
    detailHost.hidden = true;
  }

  /* ------------------------------------------------------------------- list */

  function rowBadge(img: ImageInfo): HTMLElement {
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

  function renderList(): void {
    clear(listHost);
    if (images.length === 0) {
      if (app.pathA) {
        listHost.append(el("div", { class: "empty", text: "no images in this asset" }));
      } else {
        listHost.append(
          emptyState(OPEN_HINT, { label: "Open…", onClick: () => void app.pickAndOpen() }),
        );
      }
      return;
    }
    const rows = images.map((img) =>
      el(
        "tr",
        {
          class: `clickable ${img.index === selected ? "selected" : ""} ${
            img.index === previewing ? "previewing" : ""
          } ${img.index === activeEncode?.index ? "encoding" : ""}`,
          onclick: () => selectImage(img.index),
        },
        el("td", { class: "mono", text: String(img.index) }),
        el("td", { text: img.name ?? "—" }),
        el("td", { class: "mono", text: img.format }),
        el("td", { class: "num", text: `${img.width}×${img.height}` }),
        el("td", { class: "num", text: fmtBytes(img.disk) }),
        el("td", { class: "num", text: fmtBytes(img.vram) }),
        el("td", null, rowBadge(img)),
      ),
    );
    listHost.append(
      el(
        "table",
        null,
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

  /* ------------------------------------------------------------------ side */

  function renderSide(): void {
    clear(side);
    const img = images[selected];
    if (!img) {
      side.append(section("Image", el("div", { class: "empty", text: "select an image" })));
      side.append(
        section(
          "Preview",
          el("div", { class: "muted", text: "pick an image, then preview basisu" }),
        ),
      );
      encodeBtn.disabled = true;
      return;
    }
    side.append(
      section(
        "Image",
        kv([
          ["index", String(img.index)],
          ["name", img.name ?? "—"],
          ["format", img.format],
          ["size", `${img.width}×${img.height}`],
          ["disk", fmtBytes(img.disk)],
          ["vram est", fmtBytes(img.vram)],
          ["mips", img.has_mips ? "yes" : "no"],
        ]),
      ),
    );

    const body: Array<Node | string> = [
      el("div", { class: "row" }, encodeBtn),
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
        el("div", { class: "hint", text: "compare + applied settings are under the list" }),
      );
    } else {
      body.push(el("div", { class: "muted", text: "not encoded yet" }));
    }
    encodeBtn.textContent = activeEncode === null ? "Preview KTX2" : "previewing…";
    encodeBtn.disabled = !app.bridge.live || activeEncode !== null;
    side.append(section("Preview (dry run)", ...body));
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
      renderDetail();
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
    renderDetail();
  }

  async function requestPreview(index: number): Promise<void> {
    const path = app.pathA ?? (!app.bridge.live ? "/demo/DamagedHelmet.glb" : null);
    if (!path) return;
    const seq = ++previewSeq;
    previewing = index;
    preview = null;
    previewError = null;
    previewErrorIndex = null;
    clearPreviewTimer();
    renderList();
    renderDetail();
    try {
      const call = await app.bridge.texturePreview(path, index);
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
      renderDetail();
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
    renderDetail();
    const cached = results.get(index);
    if (cached) void loadCompare(index, cached);
    void requestPreview(index);
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
    if (selected === index) {
      renderDetail();
      void loadCompare(index, result);
    }
    notify(`image ${index}: ${fmtBytes(result.ktx2_size)} @ ${result.psnr.toFixed(1)} dB`, "ok");
  }

  async function loadCompare(index: number, result: EncodeResult): Promise<void> {
    if (compares.has(index)) return;
    if (!result.before_png && !result.after_png) {
      // Legacy payload: no rendered previews, keep the decoded original if we have it.
      compares.set(index, { before: previewUrl(index), after: null });
      renderDetail();
      return;
    }
    const gen = compareGen;
    const [before, after] = await Promise.all([
      result.before_png ? app.bridge.pngDataUrl(result.before_png) : Promise.resolve(null),
      result.after_png ? app.bridge.pngDataUrl(result.after_png) : Promise.resolve(null),
    ]);
    if (gen !== compareGen) return;
    compares.set(index, { before: before ?? previewUrl(index), after });
    if (selected === index) renderDetail();
  }

  async function startEncode(): Promise<void> {
    const path = app.pathA;
    const img = images[selected];
    if (!path || !img || activeEncode) return;
    const token = ++encodeSeq;
    activeEncode = { token, index: img.index, path };
    renderList();
    renderSide();
    try {
      const call = await app.bridge.textureEncode(path, img.index);
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
      renderDetail();
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
    if (active.path !== app.pathA) {
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

  /** Texture step from the shared optimize defaults, optionally overridden
   *  by a preview's applied settings (the compare-pane shortcut). */
  function textureStep(override?: EncodeSettings): Record<string, unknown> {
    const t = getSettings().optimize.steps.textures;
    return {
      format: override?.format ?? t.format,
      quality: override?.quality ?? t.quality,
      rdo_lambda: 1,
      generate_mips: override?.generate_mips ?? t.generate_mips,
      max_size: override?.max_size ?? t.max_size,
    };
  }

  function describeTextureParams(): string {
    const t = getSettings().optimize.steps.textures;
    const size = t.max_size === 0 ? "orig" : String(t.max_size);
    return `${t.format} · q${t.quality} · ${size} · mips ${t.generate_mips ? "on" : "off"}`;
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
    applyBtn.disabled = applyRunning;
    if (!applyRunning) applyBtn.textContent = "Apply to model…";
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
          text: "Open result",
          title: "Load the KTX2 file like Open… does",
          onclick: () => app.setPath(res.out_path),
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

  async function startApply(override?: EncodeSettings): Promise<void> {
    if (!app.bridge.live) {
      notify("demo mode — apply needs the assetty binary", "error");
      return;
    }
    const path = app.pathA;
    if (!path) {
      notify("open a model first", "error");
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

  const offApplySettings = onSettingsChange(() => syncApplyBar());

  /* ------------------------------------------------------------------ reload */

  async function reload(): Promise<void> {
    const path = app.pathA;
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
    clear(applyResultHost);
    setApplyStatus("idle");
    syncApplyBar();
    results.clear();
    compares.clear();
    renderList();
    renderSide();
    renderDetail();
    if (path || !app.bridge.live) {
      try {
        const res = await app.bridge.textures(path ?? "/demo/DamagedHelmet.glb");
        images = res.images.slice().sort((a, b) => a.index - b.index);
      } catch (err) {
        notify(`textures failed: ${(err as Error).message}`, "error");
      }
    }
    if (images.length > 0) selected = images[0].index;
    renderList();
    renderSide();
    renderDetail();
    if (selected >= 0) void requestPreview(selected);
  }

  const offPath = app.on("path", () => {
    void reload();
  });

  return {
    el: root,
    activate: () => {
      void reload();
    },
    dispose: () => {
      offPath();
      offDone();
      offPreviewDone();
      offApplyDone();
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
