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
 *   discardFile(path)       -> {"ok":true} (only under .zig-cache/assetty-app; missing counts as discarded)
 *   presets()               -> ["desktop", ...] | { presets: [...] }
 *   presetLoad(name)        -> zon text | { zon }
 *   presetSave(name, zon)   -> anything
 *   settingsLoad()          -> raw JSON text of assetty.settings.json (cwd) or "{}"
 *   settingsSave(text)      -> {"ok":true} | {"error":"..."} (validated, atomic)
 *   appInfo()               -> { version, repo, platform, arch, asset }
 *   updateCheck()           -> { available, current, version, asset, download_url, notes_url }
 *                              | {"error":"..."} when the feed is unreachable
 *   updateApply()           -> { installed, version, restarted }
 *                              | {"error":"..."} on failure (app relaunches itself on success)
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
export { Bridge, b64ToBytes, bridge } from "./bridge/calls";
export { normalizeEncodeResult } from "./bridge/events";
export { isBusyError } from "./guards";
export type {
  EncodeInvocation,
  ExportDoneEvent,
  OpenDialogResult,
  OptimizeDoneEvent,
  OptimizeInvocation,
  PreviewInvocation,
  ProgressEvent,
  TextureEncodeDoneEvent,
  TexturePreviewDoneEvent,
} from "./bridge/types";
