/** Bridge wire types: invocations, done-events, backend handle. */
import type { EncodeResult, OptimizeResult, TexturePreview } from "../types";

export interface ProgressEvent {
  step: string;
  pct: number;
  sub?: { label: string; done: number; total: number };
}

/** One row of the `presets()` listing: built-ins ship as `.zon`, user presets save as `.json`. */
export interface PresetEntry {
  name: string;
  kind: "builtin" | "user";
  file: string;
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

/** One LOD ladder rung: ratio used, file written, its size/triangles/time. */
export interface LodsItem {
  ratio: number;
  out_path: string;
  disk_bytes: number;
  triangles: number;
  secs?: number;
}

/**
 * What `optimizeLODs()` resolves to. Same shape as an optimize run:
 * `started: true` means the ladder runs in the background — the rungs arrive
 * through `onLodsDone()`.
 */
export type LodsInvocation =
  | { started: true; stopProgress: () => void }
  | { started: false; result: LodsItem[] };

export type LodsDoneEvent = { ok: true; results: LodsItem[] } | { ok: false; error: string };

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

export interface NativeBackend {
  source: string;
  methods: string[];
  call(method: string, args: unknown[]): Promise<unknown>;
  on(event: string, cb: (payload: unknown) => void): () => void;
}
