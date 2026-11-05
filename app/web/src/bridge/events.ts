/** Backend event subscriptions + payload normalization (tolerant to old hosts). */
import type { NativeBackend } from "./types";
import type {
  EncodeResult,
  EncodeSettings,
  OptimizeReport,
  OptimizeResult,
  Stats,
  TextureImageReport,
  TexturesResult,
} from "../types";
import type {
  ExportDoneEvent,
  LodsDoneEvent,
  OptimizeDoneEvent,
  ProgressEvent,
  TextureEncodeDoneEvent,
  TexturePreviewDoneEvent,
} from "./types";

export function parseMaybeJson<T>(value: unknown): T {
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

export function asNumber(v: unknown, fallback = 0): number {
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

export function normalizeOptimize(raw: unknown): OptimizeResult {
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
      images: (Array.isArray(st.images) && st.images.length > 0
        ? st.images
        : undefined) as unknown as TextureImageReport[] | undefined,
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

export function normalizeImages(raw: unknown): TexturesResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const images = Array.isArray(obj.images) ? obj.images : Array.isArray(raw) ? raw : [];
  return { images: images as TexturesResult["images"] };
}

/** New hosts acknowledge a job with `{"started":true}` instead of blocking. */
export function isStartedAck(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).started === true;
}

export function normalizeOptimizeDone(raw: unknown): OptimizeDoneEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ok = r.ok === undefined ? r.error == null : Boolean(r.ok);
  if (!ok) return { ok: false, error: String(r.error ?? "optimize failed") };
  // Accept both the flat contract and a `{ ok, result }` wrapper.
  const payload =
    r.result && typeof r.result === "object" ? (r.result as Record<string, unknown>) : r;
  return { ok: true, result: normalizeOptimize(payload) };
}

/** Normalizes the `lodsDone` payload (flat contract or `{ ok, results }` wrapper). */
export function normalizeLodsDone(raw: unknown): LodsDoneEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ok = r.ok === undefined ? r.error == null : Boolean(r.ok);
  if (!ok) return { ok: false, error: String(r.error ?? "lods failed") };
  const payload =
    r.results !== undefined ? r : r.result && typeof r.result === "object" ? r.result : r;
  const list = (payload as Record<string, unknown>).results;
  const items = (Array.isArray(list) ? list : []).map((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    return {
      ratio: asNumber(e.ratio),
      out_path: String(e.out_path ?? e.path ?? ""),
      disk_bytes: asNumber(e.disk_bytes ?? e.disk ?? e.size),
      triangles: asNumber(e.triangles),
      secs: optNumber(e.secs ?? e.seconds),
    };
  });
  return { ok: true, results: items };
}

export function normalizeExportDone(raw: unknown): ExportDoneEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ok = r.ok === undefined ? r.error == null : Boolean(r.ok);
  if (!ok) return { ok: false, error: String(r.error ?? "export failed") };
  return { ok: true, src: String(r.src ?? ""), dst: String(r.dst ?? "") };
}

export function normalizeEncodeDone(raw: unknown): TextureEncodeDoneEvent {
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
    normal_map: typeof s.normal_map === "boolean" ? s.normal_map : undefined,
  };
  return out;
}

/** Drops undefined keys so the host sees only the params being overridden. */
export function cleanEncodeArgs(settings?: EncodeSettings): Record<string, unknown> | undefined {
  if (!settings) return undefined;
  const out: Record<string, unknown> = {};
  if (settings.format != null) out.format = settings.format;
  if (settings.quality != null) out.quality = settings.quality;
  if (settings.max_size != null) out.max_size = settings.max_size;
  if (settings.generate_mips != null) out.generate_mips = settings.generate_mips;
  if (settings.normal_map != null) out.normal_map = settings.normal_map;
  return Object.keys(out).length > 0 ? out : undefined;
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

export function normalizePreviewDone(raw: unknown): TexturePreviewDoneEvent {
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

/** Subscribes to one backend event plus the DOM fallbacks (nanoui may dispatch DOM events). */
export function subscribeBridge(
  native: NativeBackend | null,
  event: string,
  cb: (payload: unknown) => void,
): () => void {
  const offs: Array<() => void> = [];
  if (native) offs.push(native.on(event, cb));
  const domHandler = (e: Event) => cb((e as CustomEvent).detail ?? {});
  for (const name of [`nanoui:${event}`, event]) {
    window.addEventListener(name, domHandler);
    offs.push(() => window.removeEventListener(name, domHandler));
  }
  return () => {
    for (const off of offs) off();
  };
}

/** Forwards backend progress events to the caller's handler. Returns an unsubscriber. */
export function watchProgress(
  subscribe: (event: string, cb: (payload: unknown) => void) => () => void,
  onProgress?: (p: ProgressEvent) => void,
): () => void {
  if (!onProgress) return () => {};
  return subscribe("progress", (payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const event: ProgressEvent = {
      step: String(p.step ?? ""),
      pct: asNumber(p.pct ?? p.progress),
    };
    const sub = p.sub as Record<string, unknown> | undefined;
    if (sub && typeof sub === "object") {
      const done = asNumber(sub.done, NaN);
      const total = asNumber(sub.total, NaN);
      if (Number.isFinite(done) && Number.isFinite(total)) {
        event.sub = { label: String(sub.label ?? ""), done, total };
      }
    }
    onProgress(event);
  });
}
