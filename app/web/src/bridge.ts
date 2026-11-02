/**
 * Bridge to the nanoui host.
 *
 * nanoui generates `/nanoui.js` bindings; the Zig side calls `app.bind(&backend)`,
 * which exposes the backend's public methods as JS globals. The exact global name
 * is not part of the contract, so we probe for it at runtime and degrade to a
 * demo mode when nothing is found (plain `vite dev` in a browser).
 *
 * Backend methods we call (JSON strings in / out):
 *   openDialog()            -> string path
 *   listDir(path)           -> { entries: [{ name, path, is_dir, size }] }
 *   info(path)              -> Info
 *   loadBytes(path)         -> { b64, size } | string (base64)
 *   optimize(path, preset)  -> { out_path, report }
 *   textures(path)          -> { images }
 *   textureEncode(path, i)  -> { ktx2_size, psnr, vram_after }
 *   diff(a, b)              -> DiffReport
 *   lint(path, budgetJson)  -> { violations, total }
 *   presets()               -> ["desktop", ...] | { presets: [...] }
 *   presetLoad(name)        -> zon text | { zon }
 *   presetSave(name, zon)   -> anything
 * Events: "progress" { step, pct }, "log" { line }
 */

import * as demo from "./demo";
import type {
  DiffReport,
  DirEntry,
  EncodeResult,
  Info,
  LintResult,
  LintViolation,
  OptimizeReport,
  OptimizeResult,
  Stats,
  TexturesResult,
} from "./types";

export interface ProgressEvent {
  step: string;
  pct: number;
}

const METHOD_NAMES = [
  "openDialog",
  "listDir",
  "info",
  "loadBytes",
  "optimize",
  "textures",
  "textureEncode",
  "diff",
  "lint",
  "presets",
  "presetLoad",
  "presetSave",
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
      /^(.+?)_(openDialog|listDir|info|loadBytes|optimize|textures|textureEncode|diff|lint|presets|presetLoad|presetSave)$/.exec(
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
    };
  });
  const before = normalizeStats(rep.before ?? r.before);
  const after = normalizeStats(rep.after ?? r.after);
  const report: OptimizeReport = {
    preset: rep.preset == null ? undefined : String(rep.preset),
    target: rep.target == null ? undefined : String(rep.target),
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

function normalizeEntries(raw: unknown, base: string): DirEntry[] {
  const obj = raw as unknown;
  const list: unknown[] = Array.isArray(obj)
    ? obj
    : Array.isArray((obj as Record<string, unknown>)?.entries)
      ? ((obj as Record<string, unknown>).entries as unknown[])
      : Array.isArray((obj as Record<string, unknown>)?.items)
        ? ((obj as Record<string, unknown>).items as unknown[])
        : [];
  const baseClean = base.endsWith("/") ? base.slice(0, -1) : base;
  return list.map((item) => {
    const e = (typeof item === "string" ? { name: item } : item) as Record<string, unknown>;
    const name = String(e.name ?? e.file ?? e.path ?? "");
    const isDir = Boolean(e.is_dir ?? e.isDir ?? e.dir ?? e.directory);
    const path = String(e.path ?? `${baseClean}/${name}`);
    return {
      name,
      path,
      is_dir: isDir,
      size: e.size == null ? undefined : asNumber(e.size),
    };
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class DemoBackend {
  async info(path: string): Promise<Info> {
    await sleep(120);
    return { ...demo.demoInfo, file: path };
  }

  async listDir(path: string): Promise<DirEntry[]> {
    await sleep(80);
    return demo.demoTree().map((e) => ({ ...e, path: path.replace(/\/$/, "") + "/" + e.name }));
  }

  async openDialog(): Promise<string | null> {
    await sleep(50);
    return "/demo/DamagedHelmet.glb";
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

  async textures(): Promise<TexturesResult> {
    await sleep(120);
    return demo.demoTextures;
  }

  async textureEncode(_path: string, index: number): Promise<EncodeResult> {
    await sleep(400);
    const img = demo.demoTextures.images[index];
    const ratio = img ? Math.max(0.06, (img.width * img.height) / 22_369_621) : 1;
    return {
      ktx2_size: Math.round(demo.demoEncode.ktx2_size * ratio),
      psnr: demo.demoEncode.psnr - (index % 3) * 2.4,
      vram_after: Math.round(demo.demoEncode.vram_after * ratio),
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
    return await this.native.call(method, args);
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

  async optimize(
    path: string,
    preset: string,
    onProgress?: (p: ProgressEvent) => void,
  ): Promise<OptimizeResult> {
    if (!this.live) return this.demo.optimize(path, preset, onProgress);
    const off = onProgress
      ? this.on("progress", (payload) => {
          const p = (payload ?? {}) as Record<string, unknown>;
          onProgress({ step: String(p.step ?? ""), pct: asNumber(p.pct ?? p.progress) });
        })
      : () => {};
    try {
      return normalizeOptimize(parseMaybeJson(await this.raw("optimize", [path, preset])));
    } finally {
      off();
    }
  }

  async textures(path: string): Promise<TexturesResult> {
    if (!this.live) return this.demo.textures();
    return normalizeImages(parseMaybeJson(await this.raw("textures", [path])));
  }

  async textureEncode(path: string, index: number): Promise<EncodeResult> {
    if (!this.live) return this.demo.textureEncode(path, index);
    const res = parseMaybeJson<Record<string, unknown>>(
      await this.raw("textureEncode", [path, index]),
    );
    return {
      ktx2_size: asNumber(res.ktx2_size ?? res.size),
      psnr: asNumber(res.psnr),
      vram_after: asNumber(res.vram_after ?? res.vram),
    };
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

  async listDir(path: string): Promise<DirEntry[]> {
    if (!this.live) return this.demo.listDir(path);
    return normalizeEntries(parseMaybeJson(await this.raw("listDir", [path])), path);
  }

  async openDialog(): Promise<string | null> {
    if (!this.live) return this.demo.openDialog();
    const res = parseMaybeJson<unknown>(await this.raw("openDialog", []));
    if (typeof res === "string") return res || null;
    const obj = (res ?? {}) as Record<string, unknown>;
    const p = obj.path ?? obj.file;
    return p == null ? null : String(p);
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
