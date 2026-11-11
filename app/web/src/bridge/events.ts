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
// From the pure leaf, not guards.ts: this module stays free of the app graph
// (notify/i18n/ui touch `window`) so the normalizers remain unit-testable
// without a window stub.
import { assertTextureImageReports } from "../hostShapes";

export function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return raw;
}

/** True when `v` is a plain JSON-ish object (records only, never arrays/null). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `v` as a record, or `{}` when it is not one (arrays, null, primitives). */
export function asRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

export function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function normalizeStats(raw: unknown): Stats {
  const s = asRecord(raw);
  return {
    triangles: asNumber(s.triangles),
    vertices: asNumber(s.vertices),
    draw_calls: asNumber(s.draw_calls ?? s.drawCalls),
    vram_total: asNumber(s.vram_total ?? s.vram_bytes ?? s.vram),
    disk_total: asNumber(s.disk_total ?? s.disk_bytes ?? s.disk),
  };
}

export function normalizeOptimize(raw: unknown): OptimizeResult {
  const r = asRecord(raw);
  const rep = asRecord(r.report ?? r);
  const out_path = String(r.out_path ?? r.output ?? r.outPath ?? r.path ?? "");
  const stepsRaw = Array.isArray(rep.steps) ? rep.steps : [];
  const steps = stepsRaw.map((s) => {
    const st = asRecord(s);
    // A present-but-malformed images array is host-contract breakage: throw
    // instead of silently rendering wrong per-image rows.
    const rawImages = (st.images ?? undefined) as unknown;
    const images =
      rawImages === undefined || assertTextureImageReports(rawImages).length === 0
        ? undefined
        : (rawImages as TextureImageReport[]);
    return {
      kind: String(st.kind ?? st.name ?? "step"),
      applied: Boolean(st.applied),
      failed: st.failed === undefined ? undefined : Boolean(st.failed),
      note: st.note == null ? undefined : String(st.note),
      secs: optNumber(st.secs ?? st.seconds ?? st.duration),
      images,
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
  const obj = asRecord(raw);
  const images = Array.isArray(obj.images) ? obj.images : Array.isArray(raw) ? raw : [];
  return { images: images as TexturesResult["images"] };
}

/** New hosts acknowledge a job with `{"started":true}` instead of blocking. */
export function isStartedAck(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return raw.started === true;
}

export function normalizeOptimizeDone(raw: unknown): OptimizeDoneEvent {
  const r = asRecord(raw);
  const ok = r.ok === undefined ? r.error == null : Boolean(r.ok);
  if (!ok) return { ok: false, error: String(r.error ?? "optimize failed") };
  // Accept both the flat contract and a `{ ok, result }` wrapper.
  const payload = isRecord(r.result) ? r.result : r;
  return { ok: true, result: normalizeOptimize(payload) };
}

/** Normalizes the `lodsDone` payload (flat contract or `{ ok, results }` wrapper). */
export function normalizeLodsDone(raw: unknown): LodsDoneEvent {
  const r = asRecord(raw);
  const ok = r.ok === undefined ? r.error == null : Boolean(r.ok);
  if (!ok) return { ok: false, error: String(r.error ?? "lods failed") };
  const payload = r.results !== undefined ? r : isRecord(r.result) ? r.result : r;
  const list = asRecord(payload).results;
  const items = (Array.isArray(list) ? list : []).map((entry) => {
    const e = asRecord(entry);
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
  const r = asRecord(raw);
  const ok = r.ok === undefined ? r.error == null : Boolean(r.ok);
  if (!ok) return { ok: false, error: String(r.error ?? "export failed") };
  return { ok: true, src: String(r.src ?? ""), dst: String(r.dst ?? "") };
}

export function normalizeEncodeDone(raw: unknown): TextureEncodeDoneEvent {
  const r = asRecord(raw);
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
  if (!isRecord(raw)) return undefined;
  const s = raw;
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
  if (settings.supercompression === "zstd" || settings.supercompression === "none") {
    out.supercompression = settings.supercompression;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Normalizes both the event payload and the legacy synchronous reply. */
export function normalizeEncodeResult(raw: unknown): EncodeResult {
  const r = asRecord(raw);
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
  const r = asRecord(raw);
  const index = asNumber(r.index, -1);
  if (r.ok === false || (r.error != null && r.ok !== true)) {
    return { ok: false, index, error: String(r.error ?? "preview failed") };
  }
  const payload = isRecord(r.result) ? r.result : r;
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
    const p = asRecord(payload);
    const event: ProgressEvent = {
      step: String(p.step ?? ""),
      pct: asNumber(p.pct ?? p.progress),
    };
    const sub = p.sub;
    if (isRecord(sub)) {
      const done = asNumber(sub.done, NaN);
      const total = asNumber(sub.total, NaN);
      if (Number.isFinite(done) && Number.isFinite(total)) {
        event.sub = { label: String(sub.label ?? ""), done, total };
      }
    }
    onProgress(event);
  });
}
