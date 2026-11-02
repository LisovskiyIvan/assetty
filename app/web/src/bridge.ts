/**
 * Bridge to the nanoui host.
 *
 * nanoui generates `/nanoui.js` bindings; the Zig side calls `app.bind(&backend)`,
 * which exposes the backend's public methods as JS globals. The exact global name
 * is not part of the contract, so we probe for it at runtime and degrade to a
 * demo mode when nothing is found (plain `vite dev` in a browser).
 *
 * Backend methods we call (JSON strings in / out):
 *   openDialog()            -> { path } | "/abs/file.glb" | null (cancel)
 *   pickSavePath(name)      -> { path } | "/abs/out.glb" | null (cancel)
 *   exportTo(src, dst)      -> { started: true } — result arrives as "exportDone"
 *   info(path)              -> Info
 *   loadBytes(path)         -> { b64, size } | string (base64)
 *   optimize(path, preset)  -> { started: true } — result arrives as "optimizeDone"
 *                              (older hosts: { out_path, report } synchronously)
 *   optimizeCustom(path, spec) -> same shape; spec is a JSON string
 *   textures(path)          -> { images }
 *   texturePreview(path, i) -> { started: true } — image arrives as "texturePreviewDone"
 *                              (missing on older hosts: feature-detected, preview disabled)
 *   textureEncode(path, i)  -> { started: true } — result arrives as "textureEncodeDone"
 *                              (older hosts: { ktx2_size, psnr, vram_after } synchronously)
 *   diff(a, b)              -> DiffReport
 *   lint(path, budgetJson)  -> { violations, total }
 *   presets()               -> ["desktop", ...] | { presets: [...] }
 *   presetLoad(name)        -> zon text | { zon }
 *   presetSave(name, zon)   -> anything
 *   settingsLoad()          -> raw JSON text of assetty.settings.json (cwd) or "{}"
 *   settingsSave(text)      -> {"ok":true} | {"error":"..."} (validated, atomic)
 *
 * A job that is already running answers `{ "error": "busy" }`.
 *
 * Events: "progress" { step, pct }, "log" { line },
 *         "optimizeDone" { ok: true, out_path, report } | { ok: false, error },
 *         "exportDone" { ok: true, src, dst } | { ok: false, error },
 *         "texturePreviewDone" { ok: true, index, b64, width, height } | { ok: false, index, error },
 *         "textureEncodeDone" { ok: true, index, ktx2_size, psnr, vram_after, before_png, after_png,
 *                               width, height, mip_levels, format, settings }
 *                            | { ok: false, index, error }
 */

import * as demo from "./demo";
import { isMissingMethodError, notify } from "./notify";
import { toast } from "./ui";
import type {
  DiffReport,
  EncodeResult,
  EncodeSettings,
  Info,
  LintResult,
  LintViolation,
  OptimizeReport,
  OptimizeResult,
  Stats,
  TexturePreview,
  TexturesResult,
} from "./types";

export interface ProgressEvent {
  step: string;
  pct: number;
}

/** Result of the native file picker. `path` is null when the user cancels. */
export interface OpenDialogResult {
  path: string | null;
}

/**
 * What `optimize()` / `optimizeCustom()` resolve to.
 * `started: true` means the job runs in the background — the report arrives
 * through `onOptimizeDone()`. `stopProgress()` releases the `progress` listener
 * the bridge opened for the call.
 */
export type OptimizeInvocation =
  | { started: true; stopProgress: () => void }
  | { started: false; result: OptimizeResult };

export type OptimizeDoneEvent = { ok: true; result: OptimizeResult } | { ok: false; error: string };

export type ExportDoneEvent = { ok: true; src: string; dst: string } | { ok: false; error: string };

/** What `textureEncode()` resolves to (async on new hosts, immediate on old ones). */
export type EncodeInvocation = { started: true } | { started: false; result: EncodeResult };

export type TextureEncodeDoneEvent =
  | { ok: true; index: number; result: EncodeResult }
  | { ok: false; index: number; error: string };

/** What `texturePreview()` resolves to (async on new hosts, immediate on old ones). */
export type PreviewInvocation = { started: true } | { started: false; result: TexturePreview };

export type TexturePreviewDoneEvent =
  | { ok: true; index: number; result: TexturePreview }
  | { ok: false; index: number; error: string };

const METHOD_NAMES = [
  "openDialog",
  "pickSavePath",
  "exportTo",
  "info",
  "loadBytes",
  "optimize",
  "optimizeCustom",
  "textures",
  "texturePreview",
  "textureEncode",
  "diff",
  "lint",
  "presets",
  "presetLoad",
  "presetSave",
  "settingsLoad",
  "settingsSave",
] as const;

type AnyFn = (...args: unknown[]) => unknown;

interface NativeBackend {
  source: string;
  methods: string[];
  call(method: string, args: unknown[]): Promise<unknown>;
  on(event: string, cb: (payload: unknown) => void): () => void;
}

/** Collects a backend object that implements enough of our methods to be trusted. */
function probeObject(name: string, obj: Record<string, unknown>): NativeBackend | null {
  const methods = METHOD_NAMES.filter((m) => typeof obj[m] === "function");
  if (methods.length < 2) return null;
  return {
    source: name,
    methods,
    call: (method, args) => Promise.resolve((obj[method] as AnyFn)(...args)),
    on: (event, cb) => subscribeObject(obj, event, cb),
  };
}

function subscribeObject(
  obj: Record<string, unknown>,
  event: string,
  cb: (payload: unknown) => void,
): () => void {
  for (const key of ["on", "addEventListener", "subscribe"]) {
    const fn = obj[key];
    if (typeof fn === "function") {
      const off = (fn as AnyFn).call(obj, event, cb);
      return typeof off === "function" ? (off as () => void) : () => {};
    }
  }
  return () => {};
}

function findNative(): NativeBackend | null {
  const w = window as unknown as Record<string, unknown>;

  // 1. explicit namespace object: window.nanoui = { invoke(method, ...args) } or { method() {} }
  const ns = w["nanoui"] as Record<string, unknown> | undefined;
  if (ns && typeof ns === "object") {
    if (typeof ns["invoke"] === "function") {
      const invoke = ns["invoke"] as AnyFn;
      return {
        source: "window.nanoui.invoke",
        methods: [...METHOD_NAMES],
        call: (method, args) => Promise.resolve(invoke.call(ns, method, ...args)),
        on: (event, cb) => subscribeObject(ns, event, cb),
      };
    }
    const probed = probeObject("window.nanoui", ns);
    if (probed) return probed;
  }

  // 2. a bound backend object on the global scope (app.bind(&backend) -> window.backend)
  const preferred = ["assetty", "Assetty", "backend", "Backend", "app", "App", "api", "host"];
  for (const key of preferred) {
    const val = w[key];
    if (val && typeof val === "object") {
      const probed = probeObject(`window.${key}`, val as Record<string, unknown>);
      if (probed) return probed;
    }
  }
  for (const key of Object.getOwnPropertyNames(w)) {
    if (preferred.includes(key)) continue;
    let val: unknown;
    try {
      val = w[key];
    } catch {
      continue;
    }
    if (!val || typeof val !== "object") continue;
    const probed = probeObject(`window.${key}`, val as Record<string, unknown>);
    if (probed) return probed;
  }

  // 3. flat globals: prefix_method, e.g. window.backend_info(...)
  const groups = new Map<string, Map<string, AnyFn>>();
  for (const key of Object.getOwnPropertyNames(w)) {
    const m =
      /^(.+?)_(openDialog|info|loadBytes|optimize|optimizeCustom|textures|texturePreview|textureEncode|diff|lint|presets|presetLoad|presetSave|settingsLoad|settingsSave)$/.exec(
        key,
      );
    if (!m) continue;
    const val = w[key];
    if (typeof val !== "function") continue;
    const group = groups.get(m[1]) ?? new Map<string, AnyFn>();
    group.set(m[2], val as AnyFn);
    groups.set(m[1], group);
  }
  for (const [prefix, group] of groups) {
    if (group.size < 2) continue;
    return {
      source: `window.${prefix}_*`,
      methods: [...group.keys()],
      call: async (method, args) => {
        const fn = group.get(method);
        if (!fn) throw new Error(`backend method ${method} not exposed`);
        return await fn(...args);
      },
      on: () => () => {},
    };
  }

  return null;
}

function parseMaybeJson<T>(value: unknown): T {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined as unknown as T;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return trimmed as unknown as T;
    }
  }
  return value as T;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function normalizeStats(raw: unknown): Stats {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    triangles: asNumber(s.triangles),
    vertices: asNumber(s.vertices),
    draw_calls: asNumber(s.draw_calls ?? s.drawCalls),
    vram_total: asNumber(s.vram_total ?? s.vram_bytes ?? s.vram),
    disk_total: asNumber(s.disk_total ?? s.disk_bytes ?? s.disk),
  };
}

function normalizeOptimize(raw: unknown): OptimizeResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rep = (r.report ?? r) as Record<string, unknown>;
  const out_path = String(r.out_path ?? r.output ?? r.outPath ?? r.path ?? "");
  const stepsRaw = Array.isArray(rep.steps) ? rep.steps : [];
  const steps = stepsRaw.map((s) => {
    const st = (s ?? {}) as Record<string, unknown>;
    return {
      kind: String(st.kind ?? st.name ?? "step"),
      applied: Boolean(st.applied),
      note: st.note == null ? undefined : String(st.note),
      secs: optNumber(st.secs ?? st.seconds ?? st.duration),
    };
  });
  const before = normalizeStats(rep.before ?? r.before);
  const after = normalizeStats(rep.after ?? r.after);
  const report: OptimizeReport = {
    preset: rep.preset == null ? undefined : String(rep.preset),
    target: rep.target == null ? undefined : String(rep.target),
    total_secs: optNumber(rep.total_secs ?? rep.total_seconds),
    steps,
    before,
    after,
    deltas: (rep.deltas as OptimizeReport["deltas"]) ?? undefined,
  };
  return { out_path, report };
}

function normalizeViolations(raw: unknown): LintResult {
  const r = raw as unknown;
  if (Array.isArray(r)) {
    const violations: LintViolation[] = [];
    for (const file of r) {
      const f = (file ?? {}) as Record<string, unknown>;
      const list = Array.isArray(f.violations) ? f.violations : [];
      for (const v of list) violations.push(normalizeViolation(v));
    }
    return { violations, total: violations.length };
  }
  const obj = (r ?? {}) as Record<string, unknown>;
  const list = Array.isArray(obj.violations) ? obj.violations : [];
  const violations = list.map(normalizeViolation);
  return { violations, total: asNumber(obj.total, violations.length) };
}

function normalizeViolation(raw: unknown): LintViolation {
  const v = (raw ?? {}) as Record<string, unknown>;
  return {
    code: String(v.code ?? "unknown"),
    message: String(v.message ?? ""),
    index: v.index == null ? null : asNumber(v.index),
  };
}

function normalizeDiff(raw: unknown): DiffReport {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const categories = ["nodes", "meshes", "materials", "textures", "images", "animations", "skins"];
  const out = { totals: obj.totals } as unknown as DiffReport;
  for (const cat of categories) {
    const c = (obj[cat] ?? {}) as Record<string, unknown>;
    (out as unknown as Record<string, unknown>)[cat] = {
      added: Array.isArray(c.added) ? c.added : [],
      removed: Array.isArray(c.removed) ? c.removed : [],
      changed: Array.isArray(c.changed) ? c.changed : [],
    };
  }
  return out;
}

function normalizeImages(raw: unknown): TexturesResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const images = Array.isArray(obj.images) ? obj.images : Array.isArray(raw) ? raw : [];
  return { images: images as TexturesResult["images"] };
}

/** New hosts acknowledge a job with `{"started":true}` instead of blocking. */
function isStartedAck(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).started === true;
}

function normalizeOptimizeDone(raw: unknown): OptimizeDoneEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ok = r.ok === undefined ? r.error == null : Boolean(r.ok);
  if (!ok) return { ok: false, error: String(r.error ?? "optimize failed") };
  // Accept both the flat contract and a `{ ok, result }` wrapper.
  const payload =
    r.result && typeof r.result === "object" ? (r.result as Record<string, unknown>) : r;
  return { ok: true, result: normalizeOptimize(payload) };
}

function normalizeExportDone(raw: unknown): ExportDoneEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ok = r.ok === undefined ? r.error == null : Boolean(r.ok);
  if (!ok) return { ok: false, error: String(r.error ?? "export failed") };
  return { ok: true, src: String(r.src ?? ""), dst: String(r.dst ?? "") };
}

function normalizeEncodeDone(raw: unknown): TextureEncodeDoneEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const index = asNumber(r.index, -1);
  if (r.ok === false || (r.error != null && r.ok !== true)) {
    return { ok: false, index, error: String(r.error ?? "encode failed") };
  }
  return { ok: true, index, result: normalizeEncodeResult(r) };
}

function optNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function optString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function normalizeSettings(raw: unknown): EncodeSettings | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  const out: EncodeSettings = {
    format: optString(s.format),
    quality: optNumber(s.quality),
    max_size: optNumber(s.max_size ?? s.maxSize),
    generate_mips:
      typeof s.generate_mips === "boolean"
        ? s.generate_mips
        : typeof s.mips === "boolean"
          ? s.mips
          : undefined,
  };
  return out;
}

/** Normalizes both the event payload and the legacy synchronous reply. */
export function normalizeEncodeResult(raw: unknown): EncodeResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    ktx2_size: asNumber(r.ktx2_size ?? r.size),
    psnr: asNumber(r.psnr),
    vram_after: asNumber(r.vram_after ?? r.vram),
    before_png: optString(r.before_png ?? r.beforePng),
    after_png: optString(r.after_png ?? r.afterPng),
    width: optNumber(r.width),
    height: optNumber(r.height),
    mip_levels: optNumber(r.mip_levels ?? r.mipLevels ?? r.mips),
    format: optString(r.format),
    settings: normalizeSettings(r.settings ?? r.applied_settings),
  };
}

function normalizePreviewDone(raw: unknown): TexturePreviewDoneEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const index = asNumber(r.index, -1);
  if (r.ok === false || (r.error != null && r.ok !== true)) {
    return { ok: false, index, error: String(r.error ?? "preview failed") };
  }
  const payload =
    r.result && typeof r.result === "object" ? (r.result as Record<string, unknown>) : r;
  return {
    ok: true,
    index,
    result: {
      index,
      b64: String(payload.b64 ?? payload.base64 ?? payload.data ?? ""),
      width: asNumber(payload.width),
      height: asNumber(payload.height),
    },
  };
}

/** True when the host rejected a call because another job is still running. */
export function isBusyError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /\bbusy\b|already running|job in progress/i.test(text);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Demo-mode stand-in for `assetty.settings.json`. */
const DEMO_SETTINGS_KEY = "assetty.settings.json";

class DemoBackend {
  async info(path: string): Promise<Info> {
    await sleep(120);
    return { ...demo.demoInfo, file: path };
  }

  async optimize(
    path: string,
    preset: string,
    onProgress?: (p: ProgressEvent) => void,
  ): Promise<OptimizeResult> {
    const kinds = demo.demoOptimize.report.steps.map((s) => s.kind);
    for (let i = 0; i < kinds.length; i++) {
      onProgress?.({ step: kinds[i], pct: Math.round(((i + 1) / kinds.length) * 100) });
      await sleep(180);
    }
    return {
      out_path: demo.demoOptimize.out_path,
      report: { ...demo.demoOptimize.report, preset },
    };
  }

  /** Mirrors `optimizeCustom(path, spec)`: only the requested steps run. */
  async optimizeCustom(
    path: string,
    specJson: string,
    onProgress?: (p: ProgressEvent) => void,
  ): Promise<OptimizeResult> {
    void path;
    let kinds: string[] = [];
    try {
      const spec = JSON.parse(specJson) as { steps?: Array<Record<string, unknown>> };
      kinds = (spec.steps ?? []).flatMap((step) => Object.keys(step));
    } catch {
      kinds = [];
    }
    if (kinds.length === 0) kinds = ["prune"];
    for (let i = 0; i < kinds.length; i++) {
      onProgress?.({ step: kinds[i], pct: Math.round(((i + 1) / kinds.length) * 100) });
      await sleep(160);
    }
    const all = demo.demoOptimize.report.steps;
    const steps = kinds.map(
      (kind) => all.find((s) => s.kind === kind) ?? { kind, applied: true, note: "ok" },
    );
    return {
      out_path: demo.demoOptimize.out_path,
      report: { ...demo.demoOptimize.report, preset: "custom", steps },
    };
  }

  async textures(): Promise<TexturesResult> {
    await sleep(120);
    return demo.demoTextures;
  }

  async texturePreview(path: string, index: number): Promise<TexturePreview> {
    await sleep(220);
    const img = demo.demoTextures.images[index] ?? demo.demoTextures.images[0];
    const dataUrl = demo.demoPngDataUrl(`${path}#preview-${index}`);
    return {
      index,
      b64: dataUrl.replace(/^data:image\/png;base64,/, ""),
      width: img?.width ?? 0,
      height: img?.height ?? 0,
    };
  }

  async textureEncode(_path: string, index: number): Promise<EncodeResult> {
    await sleep(400);
    const img = demo.demoTextures.images[index];
    const ratio = img ? Math.max(0.06, (img.width * img.height) / 22_369_621) : 1;
    return {
      ktx2_size: Math.round(demo.demoEncode.ktx2_size * ratio),
      psnr: demo.demoEncode.psnr - (index % 3) * 2.4,
      vram_after: Math.round(demo.demoEncode.vram_after * ratio),
      before_png: `/demo/image${index}_before.png`,
      after_png: `/demo/image${index}_after.png`,
      width: img?.width,
      height: img?.height,
      mip_levels: img ? Math.floor(Math.log2(Math.max(img.width, img.height))) + 1 : undefined,
      format: "ETC1S",
      settings: { format: "etc1s", quality: 128, max_size: 0, generate_mips: true },
    };
  }

  async diff(a: string, b: string): Promise<DiffReport> {
    await sleep(200);
    void a;
    void b;
    return demo.demoDiff;
  }

  async lint(): Promise<LintResult> {
    await sleep(200);
    return demo.demoLint;
  }

  async presets(): Promise<string[]> {
    await sleep(40);
    return [...demo.demoPresets];
  }

  async presetLoad(name: string): Promise<string> {
    await sleep(60);
    return name === "desktop" ? demo.demoZon : demo.demoZon.replace(/\.desktop/g, `.${name}`);
  }

  async presetSave(): Promise<void> {
    await sleep(80);
  }

  /**
   * Demo mode persists settings in localStorage so a plain `vite dev` session
   * still round-trips them (the real host uses assetty.settings.json).
   */
  async settingsLoad(): Promise<string> {
    try {
      return window.localStorage.getItem(DEMO_SETTINGS_KEY) ?? "{}";
    } catch {
      return "{}";
    }
  }

  async settingsSave(text: string): Promise<void> {
    try {
      JSON.parse(text);
    } catch (err) {
      throw new Error(`invalid settings JSON: ${(err as Error).message}`);
    }
    try {
      window.localStorage.setItem(DEMO_SETTINGS_KEY, text);
    } catch {
      throw new Error("localStorage unavailable");
    }
  }
}

export class Bridge {
  readonly native: NativeBackend | null;
  readonly demo = new DemoBackend();
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
    if (!this.native.methods.includes(method)) throw new Error(`backend has no ${method}()`);
    const result = await this.native.call(method, args);
    // The host reports failures as `{"error":"..."}` payloads instead of
    // rejecting; surface them so callers can react (fallback, toast, retry).
    const parsed = parseMaybeJson<unknown>(result);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const message = (parsed as Record<string, unknown>).error;
      if (typeof message === "string" && message.trim()) throw new Error(message);
    }
    return result;
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
    if (!onProgress) return () => {};
    return this.on("progress", (payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      onProgress({ step: String(p.step ?? ""), pct: asNumber(p.pct ?? p.progress) });
    });
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
      notify(
        `backend has no optimizeCustom() — running the "${fallbackPreset}" preset instead`,
        "error",
      );
      return this.optimize(path, fallbackPreset, onProgress);
    }
    try {
      return await this.callOptimize("optimizeCustom", [path, specJson], onProgress);
    } catch (err) {
      if (isMissingMethodError(err)) {
        notify(
          `custom optimize unavailable (${(err as Error).message}) — running "${fallbackPreset}" instead`,
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
   * Renders one image of the asset to a PNG. New hosts answer
   * `{ started: true }` and report through `texturePreviewDone`; older hosts
   * may reply with the payload directly (the tab handles both).
   */
  async texturePreview(path: string, index: number): Promise<PreviewInvocation> {
    if (!this.live) {
      return { started: false, result: await this.demo.texturePreview(path, index) };
    }
    if (!this.native?.methods.includes("texturePreview")) {
      throw new Error("backend has no texturePreview()");
    }
    const res = parseMaybeJson<Record<string, unknown>>(
      await this.raw("texturePreview", [path, index]),
    );
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

  async textureEncode(path: string, index: number): Promise<EncodeInvocation> {
    if (!this.live) {
      return { started: false, result: await this.demo.textureEncode(path, index) };
    }
    const res = parseMaybeJson<Record<string, unknown>>(
      await this.raw("textureEncode", [path, index]),
    );
    if (isStartedAck(res)) return { started: true };
    const payload =
      res.result && typeof res.result === "object" ? (res.result as Record<string, unknown>) : res;
    return { started: false, result: normalizeEncodeResult(payload) };
  }

  async diff(a: string, b: string): Promise<DiffReport> {
    if (!this.live) return this.demo.diff(a, b);
    return normalizeDiff(parseMaybeJson(await this.raw("diff", [a, b])));
  }

  async lint(path: string, budgetJson: string): Promise<LintResult> {
    if (!this.live) return this.demo.lint();
    return normalizeViolations(parseMaybeJson(await this.raw("lint", [path, budgetJson])));
  }

  async presets(): Promise<string[]> {
    if (!this.live) return this.demo.presets();
    const res = parseMaybeJson<unknown>(await this.raw("presets", []));
    if (Array.isArray(res)) return res.map(String);
    const obj = (res ?? {}) as Record<string, unknown>;
    return Array.isArray(obj.presets) ? (obj.presets as unknown[]).map(String) : [];
  }

  async presetLoad(name: string): Promise<string> {
    if (!this.live) return this.demo.presetLoad(name);
    const res = parseMaybeJson<unknown>(await this.raw("presetLoad", [name]));
    if (typeof res === "string") return res;
    const obj = (res ?? {}) as Record<string, unknown>;
    return String(obj.zon ?? obj.text ?? obj.source ?? "");
  }

  async presetSave(name: string, zon: string): Promise<void> {
    if (!this.live) return this.demo.presetSave();
    await this.raw("presetSave", [name, zon]);
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
   * Native file picker. Resolves `{ path }` on pick and `{ path: null }` on cancel.
   * Tolerates a bare path string, `null`, or a missing backend method.
   */
  async openDialog(): Promise<OpenDialogResult> {
    if (!this.live) {
      toast("run via assetty binary", "error");
      return { path: null };
    }
    if (!this.native || !this.native.methods.includes("openDialog")) {
      toast("openDialog not available — rebuild the assetty binary", "error");
      return { path: null };
    }
    const res = parseMaybeJson<unknown>(await this.raw("openDialog", []));
    if (res == null) return { path: null };
    if (typeof res === "string") return { path: res.trim() || null };
    const obj = res as Record<string, unknown>;
    const p = obj.path ?? obj.file;
    return { path: p == null || String(p).trim() === "" ? null : String(p) };
  }

  /**
   * Native save panel. `name` seeds the file name field (defaults to
   * "model.opt.glb" when omitted). Resolves `{ path }` on pick and
   * `{ path: null }` on cancel.
   */
  async pickSavePath(name?: string): Promise<OpenDialogResult> {
    if (!this.live) {
      toast("run via assetty binary", "error");
      return { path: null };
    }
    if (!this.native || !this.native.methods.includes("pickSavePath")) {
      toast("pickSavePath not available — rebuild the assetty binary", "error");
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
    if (!this.live) throw new Error("demo mode — export needs the assetty binary");
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
    const offs: Array<() => void> = [];
    if (this.native) offs.push(this.native.on(event, cb));
    // nanoui may also dispatch DOM events.
    const domHandler = (e: Event) => cb((e as CustomEvent).detail ?? {});
    for (const name of [`nanoui:${event}`, event]) {
      window.addEventListener(name, domHandler);
      offs.push(() => window.removeEventListener(name, domHandler));
    }
    return () => {
      for (const off of offs) off();
    };
  }
}

export function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const bridge = new Bridge();
