/**
 * Per-binding wrappers over the nanoui host (sync/async tolerant).
 *
 * Discovery lives in ./host, event subscriptions + payload normalization in
 * ./events, wire types in ./types. This module keeps the public Bridge class.
 */
import * as demo from "../demo";
import { isMissingMethodError, notify } from "../notify";
import { t } from "../i18n";
import { toast } from "../ui";
import { findNative, rawCall } from "./host";
import {
  cleanEncodeArgs,
  isStartedAck,
  normalizeEncodeDone,
  normalizeEncodeResult,
  normalizeExportDone,
  normalizeImages,
  normalizeLodsDone,
  normalizeOptimize,
  normalizeOptimizeDone,
  normalizePreviewDone,
  parseMaybeJson,
  subscribeBridge,
  watchProgress,
} from "./events";
import type {
  EncodeInvocation,
  ExportDoneEvent,
  LodsDoneEvent,
  LodsInvocation,
  NativeBackend,
  OpenDialogResult,
  OptimizeDoneEvent,
  OptimizeInvocation,
  PreviewInvocation,
  PresetEntry,
  ProgressEvent,
  TextureEncodeDoneEvent,
  TexturePreviewDoneEvent,
} from "./types";
import type {
  AppInfo,
  EncodeSettings,
  Info,
  TexturesResult,
  UpdateApply,
  UpdateCheck,
} from "../types";

export class Bridge {
  readonly native: NativeBackend | null;
  readonly demo = new demo.DemoBackend();
  /** True when a real nanoui backend was found. */
  readonly live: boolean;
  readonly source: string;

  constructor() {
    this.native = findNative();
    this.live = this.native !== null;
    this.source = this.native?.source ?? "demo";
  }

  get modeLabel(): string {
    return this.live ? `nanoui: ${this.source}` : "demo (no nanoui)";
  }

  private async raw(method: string, args: unknown[]): Promise<unknown> {
    if (!this.native) throw new Error("no nanoui backend");
    // The host reports failures as `{"error":"..."}` payloads instead of
    // rejecting; surface them so callers can react (fallback, toast, retry).
    return rawCall(this.native, method, args);
  }

  async info(path: string): Promise<Info> {
    if (!this.live) return this.demo.info(path);
    return parseMaybeJson<Info>(await this.raw("info", [path]));
  }

  async loadBytes(path: string): Promise<string> {
    if (!this.live) return "";
    const res = parseMaybeJson<unknown>(await this.raw("loadBytes", [path]));
    if (typeof res === "string") return res;
    const obj = (res ?? {}) as Record<string, unknown>;
    return String(obj.b64 ?? obj.base64 ?? obj.data ?? "");
  }

  private progressInto(onProgress?: (p: ProgressEvent) => void): () => void {
    return watchProgress((event, cb) => this.on(event, cb), onProgress);
  }

  private async callOptimize(
    method: "optimize" | "optimizeCustom",
    args: unknown[],
    onProgress?: (p: ProgressEvent) => void,
  ): Promise<OptimizeInvocation> {
    const off = this.progressInto(onProgress);
    let res: unknown;
    try {
      res = parseMaybeJson(await this.raw(method, args));
    } catch (err) {
      off();
      throw err;
    }
    // New contract: the host returns immediately and reports through events.
    if (isStartedAck(res)) return { started: true, stopProgress: off };
    off();
    return { started: false, result: normalizeOptimize(res) };
  }

  async optimize(
    path: string,
    preset: string,
    onProgress?: (p: ProgressEvent) => void,
  ): Promise<OptimizeInvocation> {
    if (!this.live)
      return { started: false, result: await this.demo.optimize(path, preset, onProgress) };
    return this.callOptimize("optimize", [path, preset], onProgress);
  }

  /**
   * Per-step optimization: `specJson` is a JSON *string* like
   * `{"steps":[{"prune":{}},{"textures":{"format":"auto","quality":128}}]}`.
   * Older hosts only expose `optimize(path, preset)`; in that case we say so
   * and fall back to the named preset instead of failing the whole run.
   */
  async optimizeCustom(
    path: string,
    specJson: string,
    fallbackPreset: string,
    onProgress?: (p: ProgressEvent) => void,
  ): Promise<OptimizeInvocation> {
    if (!this.live) {
      return { started: false, result: await this.demo.optimizeCustom(path, specJson, onProgress) };
    }
    if (!this.native?.methods.includes("optimizeCustom")) {
      notify(t("toast.noOptimizeCustom", { preset: fallbackPreset }), "error");
      return this.optimize(path, fallbackPreset, onProgress);
    }
    try {
      return await this.callOptimize("optimizeCustom", [path, specJson], onProgress);
    } catch (err) {
      if (isMissingMethodError(err)) {
        notify(
          t("toast.customFallback", { message: (err as Error).message, preset: fallbackPreset }),
          "error",
        );
        return this.optimize(path, fallbackPreset, onProgress);
      }
      throw err;
    }
  }

  async textures(path: string): Promise<TexturesResult> {
    if (!this.live) return this.demo.textures();
    return normalizeImages(parseMaybeJson(await this.raw("textures", [path])));
  }

  /**
   * LOD ladder: `specJson` is the same JSON string `optimizeCustom` takes,
   * `ratiosJson` a JSON array like `[0.5,0.25,0.1]` (null/blank = host
   * default). New hosts answer `{ started: true }` and report the ladder
   * through `lodsDone`; each rung is built from the source, never compounded.
   */
  async optimizeLODs(
    path: string,
    specJson: string,
    ratiosJson: string | null,
    onProgress?: (p: ProgressEvent) => void,
  ): Promise<LodsInvocation> {
    if (!this.live) throw new Error(t("opt.lodsDemo"));
    if (!this.native?.methods.includes("optimizeLODs")) {
      throw new Error("backend has no optimizeLODs()");
    }
    const off = this.progressInto(onProgress);
    let res: unknown;
    try {
      const args = ratiosJson == null ? [path, specJson] : [path, specJson, ratiosJson];
      res = parseMaybeJson(await this.raw("optimizeLODs", args));
    } catch (err) {
      off();
      throw err;
    }
    if (isStartedAck(res)) return { started: true, stopProgress: off };
    off();
    const event = normalizeLodsDone(res);
    if (!event.ok) throw new Error(event.error);
    return { started: false, result: event.results };
  }

  /**
   * Renders one image of the asset to a PNG. New hosts answer
   * `{ started: true }` and report through `texturePreviewDone`; older hosts
   * may reply with the payload directly (the tab handles both).
   * `settings` carries the row's effective params (base + its override).
   */
  async texturePreview(
    path: string,
    index: number,
    settings?: EncodeSettings,
  ): Promise<PreviewInvocation> {
    if (!this.live) {
      return { started: false, result: await this.demo.texturePreview(path, index) };
    }
    if (!this.native?.methods.includes("texturePreview")) {
      throw new Error("backend has no texturePreview()");
    }
    const extra = cleanEncodeArgs(settings);
    const args = extra ? [path, index, JSON.stringify(extra)] : [path, index];
    const res = parseMaybeJson<Record<string, unknown>>(await this.raw("texturePreview", args));
    if (isStartedAck(res)) return { started: true };
    const event = normalizePreviewDone({ ...res, ok: true });
    if (!event.ok) throw new Error(event.error);
    return { started: false, result: event.result };
  }

  /** Reads a PNG off disk and wraps it as a data URL (null when unavailable). */
  async pngDataUrl(path: string): Promise<string | null> {
    if (!path) return null;
    if (!this.live) return demo.demoPngDataUrl(path);
    try {
      const b64 = await this.loadBytes(path);
      const clean = b64.replace(/\s+/g, "");
      return clean ? `data:image/png;base64,${clean}` : null;
    } catch {
      return null;
    }
  }

  /**
   * Dry-run encode of one image. `settings` carries the row's effective
   * params (base + its override); omitted keys fall back to host defaults.
   */
  async textureEncode(
    path: string,
    index: number,
    settings?: EncodeSettings,
  ): Promise<EncodeInvocation> {
    if (!this.live) {
      return { started: false, result: await this.demo.textureEncode(path, index) };
    }
    const extra = cleanEncodeArgs(settings);
    const args = extra ? [path, index, JSON.stringify(extra)] : [path, index];
    const res = parseMaybeJson<Record<string, unknown>>(await this.raw("textureEncode", args));
    if (isStartedAck(res)) return { started: true };
    const payload =
      res.result && typeof res.result === "object" ? (res.result as Record<string, unknown>) : res;
    return { started: false, result: normalizeEncodeResult(payload) };
  }

  /**
   * Deletes a finished result file on the host (`{"ok":true}`; the host
   * refuses anything outside `.zig-cache/assetty-app/` and treats a missing
   * file as already discarded). Rejects with the host's error text otherwise.
   */
  async discardFile(path: string): Promise<void> {
    if (!this.live) return this.demo.discardFile(path);
    await this.raw("discardFile", [path]);
  }

  async presets(): Promise<PresetEntry[]> {
    if (!this.live) return this.demo.presets();
    const res = parseMaybeJson<unknown>(await this.raw("presets", []));
    const list = Array.isArray(res) ? res : ((res ?? {}) as Record<string, unknown>).presets;
    const items = Array.isArray(list) ? list : [];
    return items
      .map((entry) => normalizePresetEntry(entry))
      .filter((entry): entry is PresetEntry => entry !== null);
  }

  /**
   * Raw preset text: `.zon` for built-ins, `{"name","steps"}` JSON for user
   * presets. Returned verbatim (never parsed): a JSON preset would parse as
   * an object and lose its exact bytes.
   */
  async presetLoad(name: string): Promise<string> {
    if (!this.live) return this.demo.presetLoad(name);
    const res = await this.raw("presetLoad", [name]);
    if (typeof res === "string") return res;
    if (res && typeof res === "object" && !Array.isArray(res)) {
      const obj = res as Record<string, unknown>;
      const wrapped = obj.zon ?? obj.text ?? obj.source;
      if (typeof wrapped === "string") return wrapped;
      return JSON.stringify(res);
    }
    return String(res ?? "");
  }

  async presetSave(name: string, zon: string): Promise<void> {
    if (!this.live) return this.demo.presetSave();
    await this.raw("presetSave", [name, zon]);
  }

  /**
   * Validates + writes a user preset (`{"name","steps"}` JSON) on the host.
   * Rejects with the host's message when the spec is invalid or the name is
   * a built-in. Demo mode keeps it in memory.
   */
  async presetSaveJson(name: string, presetJson: string): Promise<void> {
    if (!this.live) return this.demo.presetSaveJson(name, presetJson);
    await this.raw("presetSaveJson", [name, presetJson]);
  }

  /**
   * Deletes a user preset on the host. Rejects for built-ins and unknown
   * names. Demo mode drops it from memory.
   */
  async presetDelete(name: string): Promise<void> {
    if (!this.live) return this.demo.presetDelete(name);
    await this.raw("presetDelete", [name]);
  }

  /**
   * Raw text of `assetty.settings.json` (cwd), `{}` when the file is missing.
   * New hosts may wrap the text as `{ text }`; older ones answer with the raw
   * JSON string — both are unwrapped here.
   */
  async settingsLoad(): Promise<string> {
    if (!this.live) return this.demo.settingsLoad();
    if (!this.native?.methods.includes("settingsLoad")) return "{}";
    const res = await this.raw("settingsLoad", []);
    if (typeof res === "string") {
      const trimmed = res.trim();
      if (trimmed.startsWith("{")) {
        try {
          const obj = JSON.parse(trimmed) as Record<string, unknown>;
          const wrapped = obj.text ?? obj.json ?? obj.settings;
          if (typeof wrapped === "string") return wrapped;
        } catch {
          // Raw settings text is itself invalid JSON: hand it back untouched so
          // the strict/tolerant parser can report the problem.
        }
      }
      return res;
    }
    if (res && typeof res === "object" && !Array.isArray(res)) {
      const obj = res as Record<string, unknown>;
      const wrapped = obj.text ?? obj.json ?? obj.settings;
      if (typeof wrapped === "string") return wrapped;
      return JSON.stringify(res);
    }
    return "{}";
  }

  /** Validated atomic write on the host; rejects a `{ "error": ... }` reply. */
  async settingsSave(text: string): Promise<void> {
    if (!this.live) return this.demo.settingsSave(text);
    await this.raw("settingsSave", [text]);
  }

  /**
   * This build's identity: `{ version, repo, platform, arch, asset }`.
   * Shown in the Settings tab next to the update button.
   */
  async appInfo(): Promise<AppInfo> {
    if (!this.live) return this.demo.appInfo();
    if (!this.native?.methods.includes("appInfo")) throw new Error("backend has no appInfo()");
    return parseMaybeJson<AppInfo>(await this.raw("appInfo", []));
  }

  /**
   * Compares this build to the release feed: `{ available, current, version,
   * asset, download_url, notes_url }`. Rejects with the host's error text
   * when the feed is unreachable (or "demo mode" without a host).
   */
  async updateCheck(): Promise<UpdateCheck> {
    if (!this.live) return this.demo.updateCheck();
    if (!this.native?.methods.includes("updateCheck"))
      throw new Error("backend has no updateCheck()");
    return parseMaybeJson<UpdateCheck>(await this.raw("updateCheck", []));
  }

  /**
   * Downloads, verifies and installs the newer release, then relaunches:
   * `{ installed, version, restarted }`. Rejects with the host's error text
   * on failure. The app quits itself on success — callers show "Restarting…"
   * and do nothing else.
   */
  async updateApply(): Promise<UpdateApply> {
    if (!this.live) return this.demo.updateApply();
    if (!this.native?.methods.includes("updateApply"))
      throw new Error("backend has no updateApply()");
    return parseMaybeJson<UpdateApply>(await this.raw("updateApply", []));
  }

  /**
   * Native file picker. Resolves `{ path }` on pick and `{ path: null }` on cancel.
   * Tolerates a bare path string, `null`, or a missing backend method.
   */
  async openDialog(): Promise<OpenDialogResult> {
    if (!this.live) {
      toast(t("toast.runViaBinary"), "error");
      return { path: null };
    }
    if (!this.native || !this.native.methods.includes("openDialog")) {
      toast(t("toast.noOpenDialog"), "error");
      return { path: null };
    }
    const res = parseMaybeJson<unknown>(await this.raw("openDialog", []));
    if (res == null) return { path: null };
    if (typeof res === "string") return { path: res.trim() || null };
    const obj = res as Record<string, unknown>;
    const p = obj.path ?? obj.file;
    return { path: p == null || String(p).trim() === "" ? null : String(p) };
  }

  async openDialogAt(dir?: string | null): Promise<OpenDialogResult> {
    if (!this.live) {
      toast(t("toast.runViaBinary"), "error");
      return { path: null };
    }
    if (this.native && this.native.methods.includes("openDialogAt")) {
      const seed = dir?.trim() ? dir.trim() : null;
      const res = parseMaybeJson<unknown>(await this.raw("openDialogAt", [seed ?? ""]));
      if (res == null) return { path: null };
      if (typeof res === "string") return { path: res.trim() || null };
      const obj = res as Record<string, unknown>;
      const p = obj.path ?? obj.file;
      return { path: p == null || String(p).trim() === "" ? null : String(p) };
    }
    return this.openDialog();
  }

  /**
   * Writes dropped bytes to `.zig-cache/assetty-app/drops/` on the host.
   * Resolves `{ path }` to the staged file (errors arrive as thrown Errors).
   */
  async dropFile(name: string, b64: string): Promise<OpenDialogResult> {
    if (!this.live) {
      toast(t("toast.runViaBinary"), "error");
      return { path: `/demo/${name}` };
    }
    if (!this.native || !this.native.methods.includes("dropFile")) {
      throw new Error("backend has no dropFile()");
    }
    const res = parseMaybeJson<unknown>(await this.raw("dropFile", [name, b64]));
    if (res == null) return { path: null };
    if (typeof res === "string") return { path: res.trim() || null };
    const obj = res as Record<string, unknown>;
    const p = obj.path ?? obj.file;
    return { path: p == null || String(p).trim() === "" ? null : String(p) };
  }

  /** Lists directory entries (absolute paths) seeded for the recent-dirs menu. */
  async listDir(dir: string): Promise<string[]> {
    if (!this.live) return [];
    if (!this.native || !this.native.methods.includes("listDir")) return [];
    const res = parseMaybeJson<unknown>(await this.raw("listDir", [dir]));
    const pick = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.map(String);
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        for (const key of ["files", "entries", "paths", "children"]) {
          if (Array.isArray(o[key])) return (o[key] as unknown[]).map(String);
        }
      }
      return [];
    };
    return pick(res);
  }

  /**
   * Native save panel. `name` seeds the file name field (defaults to
   * "model.opt.glb" when omitted). Resolves `{ path }` on pick and
   * `{ path: null }` on cancel.
   */
  async pickSavePath(name?: string): Promise<OpenDialogResult> {
    if (!this.live) {
      toast(t("toast.runViaBinary"), "error");
      return { path: null };
    }
    if (!this.native || !this.native.methods.includes("pickSavePath")) {
      toast(t("toast.noSavePath"), "error");
      return { path: null };
    }
    const suggestion = name?.trim() ? name : "model.opt.glb";
    const res = parseMaybeJson<unknown>(await this.raw("pickSavePath", [suggestion]));
    if (res == null) return { path: null };
    if (typeof res === "string") return { path: res.trim() || null };
    const obj = res as Record<string, unknown>;
    const p = obj.path ?? obj.file;
    return { path: p == null || String(p).trim() === "" ? null : String(p) };
  }

  /**
   * Copies `src` to `dst` (missing parents created, overwrite allowed — the
   * caller confirms). New hosts answer `{ started: true }` and report through
   * `exportDone`; rejects when another pipeline job owns the gate.
   */
  async exportTo(src: string, dst: string): Promise<{ started: true }> {
    if (!this.live) throw new Error(t("toast.demoExport"));
    const res = parseMaybeJson<unknown>(await this.raw("exportTo", [src, dst]));
    if (isStartedAck(res)) return { started: true };
    throw new Error("export not acknowledged by the host");
  }

  /**
   * Final result of a background `optimize()` / `optimizeCustom()` run.
   * Fires once per job, after the call already resolved with `{ started: true }`.
   */
  onOptimizeDone(cb: (event: OptimizeDoneEvent) => void): () => void {
    return this.on("optimizeDone", (payload) => cb(normalizeOptimizeDone(payload)));
  }

  /**
   * Final result of a background `optimizeLODs()` ladder. Fires once per job,
   * after the call already resolved with `{ started: true }`.
   */
  onLodsDone(cb: (event: LodsDoneEvent) => void): () => void {
    return this.on("lodsDone", (payload) => cb(normalizeLodsDone(payload)));
  }

  /** Final result of a background `textureEncode()` run. */
  onTextureEncodeDone(cb: (event: TextureEncodeDoneEvent) => void): () => void {
    return this.on("textureEncodeDone", (payload) => cb(normalizeEncodeDone(payload)));
  }

  /** Final result of a background `exportTo()` copy. */
  onExportDone(cb: (event: ExportDoneEvent) => void): () => void {
    return this.on("exportDone", (payload) => cb(normalizeExportDone(payload)));
  }

  /** One decoded image for the texture preview pane. */
  onTexturePreviewDone(cb: (event: TexturePreviewDoneEvent) => void): () => void {
    return this.on("texturePreviewDone", (payload) => cb(normalizePreviewDone(payload)));
  }

  /** Subscribe to a backend event ("progress" | "log"). Returns an unsubscribe fn. */
  on(event: string, cb: (payload: unknown) => void): () => void {
    return subscribeBridge(this.native, event, cb);
  }
}

/** One `presets()` row: a bare string is a legacy built-in name. */
function normalizePresetEntry(value: unknown): PresetEntry | null {
  if (typeof value === "string") {
    const name = value.trim();
    if (!name) return null;
    return { name, kind: "builtin", file: `${name}.zon` };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const name = String(obj.name ?? "").trim();
    if (!name) return null;
    return {
      name,
      kind: obj.kind === "user" ? "user" : "builtin",
      file: String(obj.file ?? `${name}.zon`),
    };
  }
  return null;
}

export function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const bridge = new Bridge();
