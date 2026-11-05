/**
 * UI internationalization — English + Russian.
 *
 * Flat key→string maps (`en` is the source of truth), `{name}` interpolation,
 * current-language state, and a change event. Switching is instant: `setLang`
 * updates `<html lang>`, then every visible surface re-renders through the
 * `onLang` subscription (topbar labels update in place; tabs re-render their
 * dynamic content and rebuild their static forms, which read live settings).
 *
 * Numbers, paths, backend error text and step params stay as-is — only the
 * human-readable frame around them is translated.
 */

export type Lang = "en" | "ru";

export const LANGS: readonly Lang[] = ["en", "ru"];

type Dict = Record<string, string>;

/** Navigator-based default: ru when the browser locale starts with "ru". */
export function detectLanguage(): Lang {
  try {
    const nav = window.navigator?.language ?? "";
    return nav.toLowerCase().startsWith("ru") ? "ru" : "en";
  } catch {
    return "en";
  }
}

/* ------------------------------------------------------------------ English */

const en: Dict = {
  // topbar
  "topbar.viewer": "Viewer",
  "topbar.optimize": "Optimize",
  "topbar.textures": "Textures",
  "topbar.settings": "Settings",
  "topbar.open": "Open…",
  "topbar.openTitle": "Open model (⌘O)",
  "topbar.inspector": "Inspector",
  "topbar.inspectorTitle": "Toggle the Babylon inspector for the viewer scene (⌘I)",
  "topbar.themeToLight": "Switch to light theme",
  "topbar.themeToDark": "Switch to dark theme",
  "topbar.demoTitle": "assetty-app host not detected — demo mode. ",
  "topbar.demoBody1":
    "Layout is seeded with static JSON; the file picker is disabled. Run the window through ",
  "topbar.demoBody2": " (or ",
  "topbar.demoBody3": ") to talk to Zig.",
  "topbar.demoPill": "demo",
  "topbar.recent": "recent messages",
  "topbar.last20": "last 20",
  "topbar.noMessages": "no messages yet",
  "topbar.lastMsg": "last: {message}",
  "topbar.errorMsg": "error: {message}",
  "topbar.mountFailed": "failed to mount {id}: {message}",
  "topbar.ktx2Missing": "KTX2 decoders unavailable: {list}",
  "topbar.openCaret": "Recent folders",
  "topbar.noRecentDirs": "no recent folders",
  "topbar.recentLoading": "loading…",
  "topbar.noModelsInDir": "no models here",

  // common
  "common.open": "Open…",
  "common.cancel": "Cancel",
  "common.runAnyway": "Run anyway",
  "common.reset": "Reset",
  "common.close": "close",
  "common.closeTitle": "Hide inspector (⌘I)",
  "common.base": "base",
  "common.original": "original",
  "common.on": "on",
  "common.off": "off",
  "common.inherit": "inherit",
  "common.yes": "yes",
  "common.no": "no",
  "common.noResize": "no resize",
  "common.view": "View result",
  "common.useAsSource": "Use as source",
  "common.saveAs": "Save as…",
  "common.copied": "copied {path}",
  "common.idle": "idle",
  "common.done": "done",
  "common.failed": "failed",
  "common.noFile": "—",

  // viewer tab
  "viewer.noFile": "no file loaded",
  "viewer.loading": "loading…",
  "viewer.loadingPath": "loading {path}…",
  "viewer.loadFailed": "load failed",
  "viewer.loadFailedMsg": "load failed: {message}",
  "viewer.infoFailed": "info failed: {message}",
  "viewer.demoScene": "demo scene (no nanoui)",
  "viewer.demoScenePath": "{path} — demo scene (no nanoui)",
  "viewer.webglFail": "WebGL unavailable: {reason}",
  "viewer.openHint": "Open a model first (⌘O)",
  "viewer.noSourceHint": "No source model — open one (⌘O) or use as source",

  // optimize tab
  "opt.original": "original",
  "opt.optimized": "optimized",
  "opt.sideBySide": "Side by side",
  "opt.sideTitle": "show the source and the result next to each other",
  "opt.splitSlider": "Split slider",
  "opt.splitNeedResult": "Run optimize to compare",
  "opt.splitWipeTitle": "wipe between source (left) and result (right)",
  "opt.splitDragTitle": "drag to wipe between source and result",
  "opt.syncHint": "before/after canvases stay in sync while you orbit",
  "opt.splitHint": "drag ⟷ to compare — left SOURCE, right OPTIMIZED",
  "opt.chipSource": "SOURCE",
  "opt.chipOptimized": "OPTIMIZED",
  "opt.section": "Optimize",
  "opt.noFile": "no file selected",
  "opt.sourceLabel": "Source: {path}",
  "opt.diverged": "Viewing a different file (results are not the source)",
  "opt.run": "Run optimize",
  "opt.running": "Running…",
  "opt.lods": "Generate LODs…",
  "opt.lodsRunning": "Generating LODs…",
  "opt.lodsTitle": "Build 50/25/10% LODs from the current steps and the source model",
  "opt.lodsDemo": "demo mode — LODs need the assetty binary",
  "opt.lodsNoHost": "LODs unavailable — rebuild the assetty binary",
  "opt.lodsSection": "LODs",
  "opt.lodsEmpty": "generate LODs to see one file per ratio",
  "opt.lodsNote": "each LOD is built from the source — they don't compound",
  "opt.lodsColRatio": "ratio",
  "opt.lodsColFile": "file",
  "opt.lodsFinished": "LODs finished",
  "opt.lodsFailedMsg": "lods failed: {message}",
  "opt.stepDisabled": "Disabled",
  "opt.progressIdle": "idle · 0%",
  "opt.export": "Export",
  "opt.exporting": "Exporting…",
  "opt.stepsTitle": "Steps",
  "opt.hint.prune": "unused nodes / materials / textures",
  "opt.stripAnimations": "Strip animations",
  "opt.hint.dedup": "share identical data",
  "opt.hint.weld": "merge duplicate vertices",
  "opt.hint.join": "merge primitives sharing a material",
  "opt.hint.textures": "KTX2 / basis encode",
  "opt.zstdUastcOnly": "zstd supercompression applies to UASTC only",
  "opt.hint.quantize": "attribute bit packing",
  "opt.hint.compress": "meshopt all views",
  "opt.hint.animops": "drop constant tracks",
  "opt.hint.simplify": "decimate triangles",
  "opt.autoLabel": "auto:",
  "opt.autoMobile": "mobile",
  "opt.autoMobileTip": "mobile: ETC1S q128, max 1024px, mips on — small downloads",
  "opt.autoDesktop": "desktop",
  "opt.autoDesktopTip": "desktop: ETC1S q160, original size, mips on — max fidelity",
  "opt.autoWeb": "web",
  "opt.autoWebTip": "web: ETC1S q96, max 2048px, mips on — fast streaming",
  "opt.noOverrides": "no per-texture overrides",
  "opt.overridesCount": "{n} per-texture override(s) (apply to source)",
  "opt.rulesOff": "auto rules off",
  "opt.rulesOnCount": "auto rules on: {n}",
  "opt.rulesOnTitle":
    "first matching rule sets the encode params per image; per-image overrides win",
  "opt.rulesCount": "{n} auto rule(s) — first match wins; overrides win",
  "opt.rulesInvalid": "rules must be a JSON array",
  "opt.rulesReset": "Reset to defaults",
  "opt.rulesResetTitle": "Replace the rules with the project-derived table",
  "opt.rulesShort": "{n} rules",
  "opt.reencodeShort": "re-encode KTX2",
  "opt.overridesTitle":
    "overrides are model-scoped (per_model[sourcePath]) and merge into the textures step",
  "opt.editInTextures": "Edit in Textures tab",
  "opt.editInTexturesTitle": "open the Textures tab to edit per-image overrides",
  "opt.report": "Report",
  "opt.reportEmpty": "run an optimization to see before/after",
  "opt.exportNote":
    "Results are written to .zig-cache/…; the source file is never modified. Use Save as… to place a copy.",
  "opt.rowTriangles": "triangles",
  "opt.rowVertices": "vertices",
  "opt.rowDraws": "draw calls",
  "opt.rowVram": "VRAM est",
  "opt.rowDisk": "disk size",
  "opt.rowAnimations": "animations",
  "opt.colMetric": "metric",
  "opt.colBefore": "before",
  "opt.colAfter": "after",
  "opt.stepsRun": "steps run",
  "opt.imgSkipped": "{label} — skipped",
  "opt.imgSkippedTitle": "left as-is (not encoded)",
  "opt.imgEffectiveTitle": "effective format",
  "opt.viewTitle": "Load this result into the viewer (the optimize source is unchanged)",
  "opt.useTitle": "Run further experiments starting from this result",
  "opt.saveTitle": "Copy this result wherever you want it (the source model is never modified)",
  "opt.viewing": "viewing {path}",
  "opt.sourceSet": "source: {path}",
  "opt.totalTime": "total {secs}",
  "opt.presetPrefill": 'preset "{name}" prefilled the step settings',
  "opt.presetUnknown": 'preset "{name}" (no known prefill; used as fallback)',
  "opt.presetTitle": 'prefill the steps from the "{name}" preset',
  "opt.myPresets": "My presets ({n})",
  "opt.myPresetsTitle": "Load or delete a saved preset",
  "opt.myPresetsEmpty": "no saved presets yet — tune the steps, then Save preset",
  "opt.presetSaveShow": "Save preset…",
  "opt.presetSaveTitle": "Save the current steps as a preset",
  "opt.presetNamePh": "preset name",
  "opt.presetSaveBtn": "Save",
  "opt.presetSaved": 'preset "{name}" saved',
  "opt.presetSaveFail": "preset save failed: {message}",
  "opt.presetNoSaveHost": "saving presets needs a newer assetty binary",
  "opt.presetNameEmpty": "name the preset first",
  "opt.presetLoaded": 'preset "{name}" loaded into the steps',
  "opt.presetLoadFail": "preset load failed: {message}",
  "opt.presetInvalid": "preset has no usable steps",
  "opt.presetDeleteTitle": 'Delete preset "{name}"',
  "opt.presetDeleteSure": "sure?",
  "opt.presetDeleted": 'preset "{name}" deleted',
  "opt.presetDeleteFail": "preset delete failed: {message}",
  "opt.pickStep": "pick at least one step",
  "opt.ktx2Guard": "All textures in the source are already KTX2 — texture settings will not apply.",
  "opt.guardBlocked": "run blocked: source textures are all KTX2 (confirm to run anyway)",
  "opt.starting": "starting…",
  "opt.runningBg": "optimization running in the background…",
  "opt.runningShort": "running…",
  "opt.working": "working…",
  "opt.workingNow": "working…",
  "opt.elapsedTitle": "elapsed",
  "opt.stageLoad": "load",
  "opt.stageGeometry": "geometry",
  "opt.stageTextures": "textures",
  "opt.stageWrite": "write",
  "opt.stageDone": "done",
  "opt.jobTimeout": "no completion event within 10 minutes — timed out",
  "opt.finished": "optimization finished",
  "opt.failedMsg": "optimize failed: {message}",
  "opt.busyMsg": "optimize already running — wait for it to finish",
  "opt.exportBusy": "export already running — wait for it to finish",
  "opt.saveDlgFail": "save dialog failed: {message}",
  "opt.exportDemo": "demo mode — export needs the assetty binary",
  "opt.exportingTo": "exporting to {path}…",
  "opt.exportNoHost": "export unavailable — rebuild the assetty binary",
  "opt.exportFail": "export failed: {message}",
  "opt.savedTo": "saved to {path}",
  "opt.discard": "Discard",
  "opt.discardTitle": "Delete this result file and forget it",
  "opt.discarded": "result discarded",
  "opt.discardFail": "discard failed: {message}",
  "opt.loadOptFail": "load optimized failed: {message}",
  "opt.loadFail": "load failed: {message}",

  // textures tab
  "tex.images": "images",
  "tex.viewApply": "images: view · apply: source",
  "tex.previewDry":
    "Preview = dry run. The model file is not modified. To write KTX2 into a new file use Apply to model.",
  "tex.apply": "Apply to model…",
  "tex.applying": "Applying…",
  "tex.encodeBtn": "Preview KTX2",
  "tex.previewActs": "preview acts on view: {name}",
  "tex.applyActs": "apply acts on source: {name}",
  "tex.noFileViewed": "no file viewed",
  "tex.noSource": "no source model",
  "tex.overridesNone": "overrides apply to source: none for this model",
  "tex.overridesCount": "overrides apply to source: {n} for this model",
  "tex.firstRun":
    "First run on 7×2048² textures takes ~30–40s; re-running on KTX2 is fast (skipped).",
  "tex.noImages": "no images in this asset",
  "tex.skipped": "skipped",
  "tex.previewing": "previewing…",
  "tex.loading": "loading…",
  "tex.mips": "mips",
  "tex.noMips": "no mips",
  "tex.ovTitle": "per-texture override (deviation from base params)",
  "tex.colNum": "#",
  "tex.colName": "name",
  "tex.colFormat": "format",
  "tex.colSize": "size",
  "tex.colDisk": "disk",
  "tex.colVram": "vram",
  "tex.openSourceHint":
    "Open a source model to edit per-texture overrides (overrides apply to source).",
  "tex.ovForImage": "override image {index} — applies to source",
  "tex.ovStored": "stored under per_model[{src}]",
  "tex.ovReset": "clear this row's override",
  "tex.ovNameMatched": "also matched by {n} name-based override(s) from JSON",
  "tex.detailTitle": "Texture",
  "tex.selectTexture": "select a texture",
  "tex.asStored": "as stored in the asset",
  "tex.imageN": "image {index}",
  "tex.preview": "Preview",
  "tex.decoding": "decoding image…",
  "tex.previewFail": "preview failed: {message}",
  "tex.texSettings": "Texture settings",
  "tex.dryRun": "Preview (dry run)",
  "tex.dryRunHint": "dry run — the model file is not modified",
  "tex.notEncoded": "not encoded yet",
  "tex.compare": "Compare — {title}",
  "tex.applyShortcut": "Apply to model…",
  "tex.applyShortcutTitle": "Write KTX2 with these settings into a new file",
  "tex.writesWith": "writes KTX2 with these settings",
  "tex.original": "Original",
  "tex.previewUnavailable": "preview unavailable",
  "tex.hostMetricsOnly": "host returned metrics only",
  "tex.loadingPreviews": "loading previews…",
  "tex.loadingPreviewsShort": "loading…",
  "tex.noPreviews": "no before/after previews — this host returned metrics only",
  "tex.applied": "applied",
  "tex.notReported": "not reported by this host",
  "tex.deselect": "deselect (Esc)",
  "tex.fFormat": "format {v}",
  "tex.fQuality": "quality {v}",
  "tex.fMaxOrig": "max_size original",
  "tex.fMaxSize": "max_size {v}",
  "tex.fMipsOn": "mips on",
  "tex.fMipsOff": "mips off",
  "tex.ktx2Written": "KTX2 written",
  "tex.writtenTo": "KTX2 written to {path}",
  "tex.reveal": "Reveal path",
  "tex.revealTitle": "{path}",
  "tex.previewTimeout": "texture preview timed out — no completion event",
  "tex.previewNoHost": "texture preview unavailable — rebuild the assetty binary",
  "tex.previewBusy": "a background job is running — preview unavailable right now",
  "tex.encodeTimeout": "texture encode timed out — no completion event",
  "tex.encodeBusy": "texture encode already running — wait for it to finish",
  "tex.encodeFail": "encode failed: {message}",
  "tex.applyDemo": "demo mode — apply needs the assetty binary",
  "tex.applyNoSource": "no source model — open one (⌘O) or use as source",
  "tex.applyBusy": "apply already running — wait for it to finish",
  "tex.applyFail": "apply failed: {message}",
  "tex.applyTimeout": "apply timed out — no completion event within 10 minutes",
  "tex.encodeDone": "image {index}: {size} @ {psnr} dB",
  "tex.texturesFail": "textures failed: {message}",
  "tex.baseTitle": "base: {v}",
  "tex.baseMipsOn": "base: on",
  "tex.baseMipsOff": "base: off",
  "tex.skipHint": "skip: leave as-is (not encoded)",
  "tex.skipLabel": "SKIP",
  "tex.normalHint": "normal_map: hint for the encoder",
  "tex.timeoutMsg": "no completion event (timed out)",
  "tex.notSupported": "not supported by this host",
  "tex.stStarting": "starting…",
  "tex.stRunning": "running…",
  "tex.stExporting": "exporting to {path}…",
  "tex.paramsOv": "{n} override(s)",
  "tex.fCodec": "codec {v}",
  "tex.total": "total {secs}",
  "tex.devOrig": "orig",
  "tex.devMips": "mips",
  "tex.devNoMips": "no-mips",
  "tex.devNormal": "normal",
  "tex.devZstd": "zstd",
  "tex.devNoZstd": "no-zstd",
  "tex.zstdHint": "supercompression: zstd-compress the UASTC payload (smaller file, same VRAM)",
  "tex.kvFormat": "format",
  "tex.kvStored": "stored",
  "tex.kvSize": "size",
  "tex.kvDisk": "disk",
  "tex.kvVram": "vram est",
  "tex.kvMips": "mips",
  "tex.kvSource": "source",
  "tex.kvKtx2": "ktx2 size",
  "tex.kvVramAfter": "vram after",
  "tex.kvDiskDelta": "disk delta",
  "tex.kvVramDelta": "vram delta",
  "tex.yes": "yes",
  "tex.no": "no",

  // settings tab
  "set.title": "Settings",
  "set.file": "assetty.settings.json",
  "set.info":
    "Persisted to assetty.settings.json in the working directory (demo mode: localStorage). Every change applies immediately and saves after 500 ms. Schema: ",
  "set.theme": "Theme",
  "set.themeHint":
    "The UI switches CSS custom properties immediately; the Babylon inspector opens with the matching theme.",
  "set.language": "Language",
  "set.languageHint":
    "Applies to every label instantly; the choice is saved with the rest of the settings.",
  "set.defaults": "Optimize defaults",
  "set.defaultsHint":
    "Used to prefill the Optimize tab. Only checked steps are sent, and every edit is saved after 500 ms.",
  "set.jsonTitle": "Settings JSON",
  "set.jsonHint":
    "Edit the whole file by hand. Apply parses the text, clamps numbers to their UI ranges and reports errors inline.",
  "set.applyJson": "Apply JSON",
  "set.saveNow": "Save now",
  "set.reloadFile": "Reload from file",
  "set.savedNow": "saved",
  "set.saveFail": "save failed (see error above)",
  "set.presets": "Presets",
  "set.noPresets": "no presets found",
  "set.savePreset": "Save preset",
  "set.reloadPreset": "Reload preset",
  "set.schema": "Schema",
  "set.schemaHint": "assetty.settings.json — frontend-owned, host validates + writes atomically.",
  "set.stLoading": "loading assetty.settings.json…",
  "set.stSaving": "saving…",
  "set.stSaved": "saved",
  "set.stUpToDate": "up to date",
  "set.stReloaded": "reloaded from file",
  "set.stError": "error: {message}",
  "set.stSaveFail": "save failed",
  "set.presetsFail": "presets failed: {message}",
  "set.presetSaved": "saved {name}.zon",
  "set.presetSaveFail": "save failed: {message}",
  "set.presetPick": "// select a preset below",
  "set.presetLoading": "// loading…",
  "set.presetLoadFail": "// load failed: {message}",

  // updates (Settings tab)
  "upd.title": "Update",
  "upd.current": "Current: {version} ({platform}-{arch})",
  "upd.check": "Check for updates",
  "upd.checking": "Checking…",
  "upd.upToDate": "You're on the latest ({version})",
  "upd.available": "{version} available",
  "upd.updateRestart": "Update & restart",
  "upd.updating": "Updating…",
  "upd.restarting": "Restarting…",
  "upd.installedManual": "Installed {version} — quit and reopen the app",
  "upd.alreadyUp": "Already up to date",
  "upd.notes": "Release notes: {url}",
  "upd.checkFail": "Check failed: {message}",
  "upd.applyFail": "Update failed: {message}",
  "upd.demo": "demo mode — updates need the assetty binary",
  "upd.loadFail": "version unavailable: {message}",

  // toasts / backend wrappers
  "toast.openFailed": "open failed: {message}",
  "toast.noOptimizeCustom":
    'backend has no optimizeCustom() — running the "{preset}" preset instead',
  "toast.customFallback": 'custom optimize unavailable ({message}) — running "{preset}" instead',
  "toast.runViaBinary": "run via assetty binary",
  "toast.noOpenDialog": "openDialog not available — rebuild the assetty binary",
  "toast.noSavePath": "pickSavePath not available — rebuild the assetty binary",
  "toast.demoExport": "demo mode — export needs the assetty binary",
  "toast.decodeFail": "texture decode failed: {detail}",
  "toast.envFail": "environment map failed to load ({url}) — metallic materials will look dark",
  "toast.texAudit": "{n} texture(s) failed to load: {names}",
  "toast.inspectorNeedScene": "Inspector needs a loaded scene — open a model first",
  "toast.inspectorFail": "inspector failed: {message}",
  "toast.inspectorCloseFail": "inspector close failed: {message}",
  "toast.inspNoScene": "Inspector — no scene",
  "toast.inspMeshes": "Inspector — {n} meshes",

  // drag & drop open
  "drop.dropToOpen": "Drop to open",
  "drop.opening": "Opening {name}…",
  "drop.badExt": "{name} is not a model (.glb/.gltf only)",
  "drop.failed": "drop failed: {message}",

  // background texture progress ("texture 3/7")
  "progress.texture": "texture {done}/{total}",

  // LOD ladder progress ("LOD 1/3")
  "progress.lods": "LOD {done}/{total}",

  // field help button chrome
  "help.whatDoes": "what does this do?",
  "help.aria": "help: {id}",

  // field help bodies
  "help.prune.unused_nodes":
    "Drops nodes unreachable from any scene at serialize time. Smaller file and a shorter node hierarchy; rendering is unchanged.",
  "help.prune.unused_materials":
    "Drops materials no mesh references. Smaller file and a shorter material list; rendering is unchanged.",
  "help.prune.unused_textures":
    "Drops images and samplers no material references. Smaller file and less texture memory reserved; rendering is unchanged.",
  "help.prune.animations":
    "Strips every animation track from the output. Animated nodes stay as static scene nodes and skeleton/skin data is kept; the file is smaller and loads faster. Re-run from the source to get animations back — results never mutate the source.",
  "help.dedup.accessors":
    "Merges byte-identical GPU buffers so they are stored once. Smaller disk size and less VRAM; rendering is unchanged.",
  "help.dedup.meshes":
    "Merges meshes with identical primitives into a single definition. Smaller file; rendering is unchanged.",
  "help.dedup.materials":
    "Merges materials with identical parameters into one. Smaller file and fewer state changes, which can reduce draw calls; rendering is unchanged.",
  "help.weld.tolerance":
    "Merges vertices closer than this distance (0 = exact matches only). Higher values close tiny cracks and shrink the vertex buffer, but may weld UV seams and shift positions slightly.",
  "help.join":
    "Merges mesh primitives that share a material into fewer draw calls. Fewer draws, but coarser per-mesh culling — distant parts of a joined mesh stay resident.",
  "help.simplify.target_ratio":
    "Fraction of triangles to keep (0.5 = half). Fewer triangles render faster and use less memory, at some loss of silhouette detail.",
  "help.simplify.error_tolerance":
    "Maximum allowed visual error for the decimation. Higher values let the simplifier remove more at the same ratio, trading fidelity for size.",
  "help.simplify.aggressive":
    "Allows topology changes during decimation. Simplifies more aggressively (smaller file, fewer triangles) but accepts larger local error.",
  "help.simplify.lock_borders":
    "Keeps UV-shell and mesh borders fixed during decimation. Prevents seams cracking open; the mesh compresses slightly less.",
  "help.simplify.use_attributes":
    "Weighs normal and UV error during decimation (seam-aware). Preserves shading and UV islands better, at the cost of keeping more triangles.",
  "help.simplify.weight_normal":
    "How strongly normal distortion is penalized when seam-aware mode is on. Higher values protect shading smoothness but keep more triangles.",
  "help.simplify.weight_uv":
    "How strongly UV distortion is penalized when seam-aware mode is on. Higher values protect texture mapping but keep more triangles.",
  "help.textures.format":
    "GPU texture codec: auto picks per target, ETC1S is smallest with fast transcode (lossy), UASTC is higher quality but a bigger file. Affects disk size and GPU decode cost.",
  "help.textures.quality":
    "ETC1S encoder quality, 1–255. Higher values preserve detail but compress worse (bigger KTX2); lower values trade visible artifacts for disk savings.",
  "help.textures.max_size":
    "Downscales the longest side to this many pixels (0 = original). Halving each side quarters VRAM and disk use, at a loss of texture sharpness.",
  "help.textures.generate_mips":
    "Generates the mip chain for minified sampling. Sharper, shimmer-free minification at ~33% more VRAM; almost always keep on.",
  "help.textures.normal_map":
    "Encodes with normal-map settings (renormalization, no sRGB). Required for correct lighting on normal maps; using it on color textures washes them out.",
  "help.textures.supercompression":
    "Zstd-compresses the UASTC KTX2 payload (supercompressionScheme=2). 20–40% smaller files at the same pixels — no VRAM change — but the loader must support KTX2 zstd supercompression (Babylon.js does). UASTC only; ignored for ETC1S.",
  "help.quantize.position_bits":
    "Quantizes vertex positions to this many bits (14 ≈ near-lossless). Big VRAM and disk win for a tiny precision loss; needs KHR_mesh_quantization support.",
  "help.quantize.uv_bits":
    "Quantizes texture coordinates to this many bits (12 ≈ near-lossless). Big VRAM and disk win for a tiny precision loss; needs KHR_mesh_quantization support.",
  "help.quantize.normal_oct":
    "Packs normals with octahedral encoding (2×8/16-bit instead of 3 floats). Much smaller vertex buffers; extension support is needed — very old viewers may render it wrong.",
  "help.compress":
    "Meshopt-compresses every eligible vertex and index buffer view (EXT_meshopt_compression, gltfpack -cc style) — including plain float geometry the quantize step left untouched. Much smaller disk size at identical vertices; the loader must support EXT_meshopt_compression.",
  "help.animops.remove_constant_tracks":
    "Drops animation channels whose every keyframe is identical, baking the value into the static node transform. Smaller file and faster load; the motion is unchanged. Re-run from the source to get the tracks back.",
  "help.animops.epsilon":
    "Per-component tolerance for the constant-track check. Larger values drop more tracks but risk flattening subtle motion; 0.00001 keeps only truly static tracks.",
  "help.compare.mode":
    "Side by side shows source and result next to each other; split slider stacks them with a draggable wipe. Both views stay camera-synced while you orbit.",
  "help.textures.overrides_note":
    "Per-texture overrides replace the base params for single images of this model only, and merge into the textures step on Run. Edit them per image in the Textures tab.",
  "help.textures.apply_rules":
    "First-match-wins auto rules: each image is classified by its material slot (normal, arm, occlusion, emissive, base color) and name suffix, and the first matching rule replaces the base params. Per-image overrides still win over rules.",
  "help.textures.reencode_ktx2":
    "Transcode already-KTX2 sources and re-encode them like any image. Off = KTX2 images are skipped as today.",
  "help.textures.rules":
    "Editable JSON array of auto rules (first match wins per image). Reset restores the project-derived table. Saved into settings and every JSON preset.",
};

/* ------------------------------------------------------------------ Russian */

const ru: Dict = {
  "topbar.viewer": "Просмотр",
  "topbar.optimize": "Оптимизация",
  "topbar.textures": "Текстуры",
  "topbar.settings": "Настройки",
  "topbar.open": "Открыть…",
  "topbar.openTitle": "Открыть модель (⌘O)",
  "topbar.inspector": "Инспектор",
  "topbar.inspectorTitle": "Переключить инспектор Babylon для сцены просмотра (⌘I)",
  "topbar.themeToLight": "Переключить на светлую тему",
  "topbar.themeToDark": "Переключить на тёмную тему",
  "topbar.demoTitle": "хост assetty-app не найден — демо-режим. ",
  "topbar.demoBody1":
    "Разметка заполнена статическим JSON; выбор файлов отключён. Запустите окно через ",
  "topbar.demoBody2": " (или ",
  "topbar.demoBody3": "), чтобы говорить с Zig.",
  "topbar.demoPill": "демо",
  "topbar.recent": "последние сообщения",
  "topbar.last20": "последние 20",
  "topbar.noMessages": "пока нет сообщений",
  "topbar.lastMsg": "последнее: {message}",
  "topbar.errorMsg": "ошибка: {message}",
  "topbar.mountFailed": "не удалось подключить {id}: {message}",
  "topbar.ktx2Missing": "декодеры KTX2 недоступны: {list}",
  "topbar.openCaret": "Недавние папки",
  "topbar.noRecentDirs": "нет недавних папок",
  "topbar.recentLoading": "загрузка…",
  "topbar.noModelsInDir": "моделей нет",

  "common.open": "Открыть…",
  "common.cancel": "Отмена",
  "common.runAnyway": "Всё равно запустить",
  "common.reset": "Сброс",
  "common.close": "закрыть",
  "common.closeTitle": "Скрыть инспектор (⌘I)",
  "common.base": "база",
  "common.original": "оригинал",
  "common.on": "вкл",
  "common.off": "выкл",
  "common.inherit": "наследовать",
  "common.yes": "да",
  "common.no": "нет",
  "common.noResize": "без ресайза",
  "common.view": "Показать результат",
  "common.useAsSource": "Сделать источником",
  "common.saveAs": "Сохранить как…",
  "common.copied": "скопировано {path}",
  "common.idle": "ожидание",
  "common.done": "готово",
  "common.failed": "ошибка",
  "common.noFile": "—",

  "viewer.noFile": "файл не загружен",
  "viewer.loading": "загрузка…",
  "viewer.loadingPath": "загрузка {path}…",
  "viewer.loadFailed": "ошибка загрузки",
  "viewer.loadFailedMsg": "ошибка загрузки: {message}",
  "viewer.infoFailed": "ошибка info: {message}",
  "viewer.demoScene": "демо-сцена (без nanoui)",
  "viewer.demoScenePath": "{path} — демо-сцена (без nanoui)",
  "viewer.webglFail": "WebGL недоступен: {reason}",
  "viewer.openHint": "Сначала откройте модель (⌘O)",
  "viewer.noSourceHint": "Нет исходной модели — откройте её (⌘O) или назначьте источником",

  "opt.original": "оригинал",
  "opt.optimized": "результат",
  "opt.sideBySide": "Рядом",
  "opt.sideTitle": "показать источник и результат рядом",
  "opt.splitSlider": "Шторка",
  "opt.splitNeedResult": "Запустите оптимизацию для сравнения",
  "opt.splitWipeTitle": "протирка между источником (слева) и результатом (справа)",
  "opt.splitDragTitle": "тяните, чтобы сравнить источник и результат",
  "opt.syncHint": "камеры связаны: вращайте — оба вида двигаются",
  "opt.splitHint": "тяните ⟷ — слева ИСТОЧНИК, справа РЕЗУЛЬТАТ",
  "opt.chipSource": "ИСТОЧНИК",
  "opt.chipOptimized": "РЕЗУЛЬТАТ",
  "opt.section": "Оптимизация",
  "opt.noFile": "файл не выбран",
  "opt.sourceLabel": "Источник: {path}",
  "opt.diverged": "Открыт другой файл (это не источник результатов)",
  "opt.run": "Запустить",
  "opt.running": "Работает…",
  "opt.lods": "Создать LOD…",
  "opt.lodsRunning": "Создание LOD…",
  "opt.lodsTitle": "Построить LOD 50/25/10% из текущих шагов и исходной модели",
  "opt.lodsDemo": "демо-режим — для LOD нужен бинарник assetty",
  "opt.lodsNoHost": "LOD недоступны — пересоберите бинарник assetty",
  "opt.lodsSection": "LOD",
  "opt.lodsEmpty": "создайте LOD, чтобы увидеть файл на каждую долю",
  "opt.lodsNote": "каждый LOD строится из источника — они не накапливаются",
  "opt.lodsColRatio": "доля",
  "opt.lodsColFile": "файл",
  "opt.lodsFinished": "LOD готовы",
  "opt.lodsFailedMsg": "ошибка LOD: {message}",
  "opt.stepDisabled": "Выкл",
  "opt.progressIdle": "ожидание · 0%",
  "opt.export": "Экспорт",
  "opt.exporting": "Экспорт…",
  "opt.stepsTitle": "Шаги",
  "opt.hint.prune": "неиспользуемые узлы / материалы / текстуры",
  "opt.stripAnimations": "Убрать анимации",
  "opt.hint.dedup": "общие данные — один раз",
  "opt.hint.weld": "склейка совпадающих вершин",
  "opt.hint.join": "склейка примитивов с общим материалом",
  "opt.hint.textures": "кодирование KTX2 / basis",
  "opt.zstdUastcOnly": "zstd-суперкомпрессия применяется только к UASTC",
  "opt.hint.quantize": "упаковка атрибутов в биты",
  "opt.hint.compress": "meshopt всех вью",
  "opt.hint.animops": "убрать статичные треки",
  "opt.hint.simplify": "прореживание треугольников",
  "opt.autoLabel": "авто:",
  "opt.autoMobile": "мобильный",
  "opt.autoMobileTip": "мобильный: ETC1S q128, макс 1024px, мипы вкл — лёгкие загрузки",
  "opt.autoDesktop": "десктоп",
  "opt.autoDesktopTip": "десктоп: ETC1S q160, исходный размер, мипы вкл — макс. качество",
  "opt.autoWeb": "веб",
  "opt.autoWebTip": "веб: ETC1S q96, макс 2048px, мипы вкл — быстрый стриминг",
  "opt.noOverrides": "нет переопределений текстур",
  "opt.overridesCount": "переопределения текстур: {n} (применяются к источнику)",
  "opt.rulesOff": "автоправила выкл",
  "opt.rulesOnCount": "автоправила вкл: {n}",
  "opt.rulesOnTitle":
    "первое подошедшее правило задаёт параметры кодирования изображения; переопределения главнее",
  "opt.rulesCount": "автоправил: {n} — первое совпадение побеждает; переопределения главнее",
  "opt.rulesInvalid": "правила должны быть JSON-массивом",
  "opt.rulesReset": "Сбросить к умолчаниям",
  "opt.rulesResetTitle": "Заменить правила таблицей проекта",
  "opt.rulesShort": "правил: {n}",
  "opt.reencodeShort": "перекод KTX2",
  "opt.overridesTitle":
    "переопределения привязаны к модели (per_model[sourcePath]) и подмешиваются в шаг textures",
  "opt.editInTextures": "Править во вкладке Текстуры",
  "opt.editInTexturesTitle": "открыть вкладку Текстуры для правки переопределений",
  "opt.report": "Отчёт",
  "opt.reportEmpty": "запустите оптимизацию, чтобы увидеть до/после",
  "opt.exportNote":
    "Результаты пишутся в .zig-cache/…; исходный файл не меняется. Кнопка «Сохранить как…» кладёт копию куда скажете.",
  "opt.rowTriangles": "треугольники",
  "opt.rowVertices": "вершины",
  "opt.rowDraws": "вызовы отрисовки",
  "opt.rowVram": "оценка VRAM",
  "opt.rowDisk": "размер файла",
  "opt.rowAnimations": "анимации",
  "opt.colMetric": "метрика",
  "opt.colBefore": "до",
  "opt.colAfter": "после",
  "opt.stepsRun": "выполненные шаги",
  "opt.imgSkipped": "{label} — пропущено",
  "opt.imgSkippedTitle": "оставлено как есть (не кодировалось)",
  "opt.imgEffectiveTitle": "итоговый формат",
  "opt.viewTitle": "Загрузить результат в просмотр (источник оптимизации не меняется)",
  "opt.useTitle": "Продолжить эксперименты, взяв результат за основу",
  "opt.saveTitle": "Скопировать результат куда угодно (исходная модель не меняется)",
  "opt.viewing": "просмотр {path}",
  "opt.sourceSet": "источник: {path}",
  "opt.totalTime": "всего {secs}",
  "opt.presetPrefill": 'пресет "{name}" заполнил настройки шагов',
  "opt.presetUnknown": 'пресет "{name}" (шаблона нет; использован как запасной)',
  "opt.presetTitle": 'заполнить шаги из пресета "{name}"',
  "opt.myPresets": "Мои пресеты ({n})",
  "opt.myPresetsTitle": "Загрузить или удалить сохранённый пресет",
  "opt.myPresetsEmpty": "пока пусто — настройте шаги и нажмите «Сохранить пресет»",
  "opt.presetSaveShow": "Сохранить пресет…",
  "opt.presetSaveTitle": "Сохранить текущие шаги как пресет",
  "opt.presetNamePh": "имя пресета",
  "opt.presetSaveBtn": "Сохранить",
  "opt.presetSaved": 'пресет "{name}" сохранён',
  "opt.presetSaveFail": "не удалось сохранить пресет: {message}",
  "opt.presetNoSaveHost": "для сохранения пресетов нужен новый бинарник assetty",
  "opt.presetNameEmpty": "сначала назовите пресет",
  "opt.presetLoaded": 'пресет "{name}" загружен в шаги',
  "opt.presetLoadFail": "не удалось загрузить пресет: {message}",
  "opt.presetInvalid": "в пресете нет пригодных шагов",
  "opt.presetDeleteTitle": 'Удалить пресет "{name}"',
  "opt.presetDeleteSure": "точно?",
  "opt.presetDeleted": 'пресет "{name}" удалён',
  "opt.presetDeleteFail": "не удалось удалить пресет: {message}",
  "opt.pickStep": "выберите хотя бы один шаг",
  "opt.ktx2Guard": "Все текстуры источника уже в KTX2 — настройки текстур не применятся.",
  "opt.guardBlocked":
    "запуск заблокирован: текстуры источника уже KTX2 (подтвердите принудительный запуск)",
  "opt.starting": "запуск…",
  "opt.runningBg": "оптимизация работает в фоне…",
  "opt.runningShort": "работает…",
  "opt.working": "работа…",
  "opt.workingNow": "работаем…",
  "opt.elapsedTitle": "прошло",
  "opt.stageLoad": "загрузка",
  "opt.stageGeometry": "геометрия",
  "opt.stageTextures": "текстуры",
  "opt.stageWrite": "запись",
  "opt.stageDone": "готово",
  "opt.jobTimeout": "нет события завершения за 10 минут — тайм-аут",
  "opt.finished": "оптимизация завершена",
  "opt.failedMsg": "ошибка оптимизации: {message}",
  "opt.busyMsg": "оптимизация уже идёт — дождитесь завершения",
  "opt.exportBusy": "экспорт уже идёт — дождитесь завершения",
  "opt.saveDlgFail": "ошибка диалога сохранения: {message}",
  "opt.exportDemo": "демо-режим — для экспорта нужен бинарник assetty",
  "opt.exportingTo": "экспорт в {path}…",
  "opt.exportNoHost": "экспорт недоступен — пересоберите бинарник assetty",
  "opt.exportFail": "ошибка экспорта: {message}",
  "opt.savedTo": "сохранено в {path}",
  "opt.discard": "Сбросить",
  "opt.discardTitle": "Удалить файл результата и забыть его",
  "opt.discarded": "результат сброшен",
  "opt.discardFail": "не удалось сбросить: {message}",
  "opt.loadOptFail": "не загрузить результат: {message}",
  "opt.loadFail": "ошибка загрузки: {message}",

  "tex.images": "изображения",
  "tex.viewApply": "изображения: просмотр · применение: источник",
  "tex.previewDry":
    "Превью — холостой прогон. Файл модели не меняется. Чтобы записать KTX2 в новый файл, используйте «Применить к модели».",
  "tex.apply": "Применить к модели…",
  "tex.applying": "Применение…",
  "tex.encodeBtn": "Предпросмотр KTX2",
  "tex.previewActs": "превью смотрит вид: {name}",
  "tex.applyActs": "применение читает источник: {name}",
  "tex.noFileViewed": "ничего не открыто",
  "tex.noSource": "нет исходной модели",
  "tex.overridesNone": "переопределения источника: нет для этой модели",
  "tex.overridesCount": "переопределения источника: {n} для этой модели",
  "tex.firstRun":
    "Первый прогон на 7 текстурах 2048² занимает ~30–40с; повтор по KTX2 быстрый (пропуск).",
  "tex.noImages": "в ассете нет изображений",
  "tex.skipped": "пропуск",
  "tex.previewing": "превью…",
  "tex.loading": "загрузка…",
  "tex.mips": "мипы",
  "tex.noMips": "без мипов",
  "tex.ovTitle": "переопределение текстуры (отклонение от базовых параметров)",
  "tex.colNum": "№",
  "tex.colName": "имя",
  "tex.colFormat": "формат",
  "tex.colSize": "размер",
  "tex.colDisk": "диск",
  "tex.colVram": "vram",
  "tex.openSourceHint":
    "Откройте исходную модель, чтобы править переопределения текстур (они применяются к источнику).",
  "tex.ovForImage": "переопределение изображения {index} — применяется к источнику",
  "tex.ovStored": "хранится в per_model[{src}]",
  "tex.ovReset": "очистить переопределение строки",
  "tex.ovNameMatched": "также совпало именованных переопределений из JSON: {n}",
  "tex.detailTitle": "Текстура",
  "tex.selectTexture": "выберите текстуру",
  "tex.asStored": "как хранится в ассете",
  "tex.imageN": "изображение {index}",
  "tex.preview": "Превью",
  "tex.decoding": "декодирование…",
  "tex.previewFail": "ошибка превью: {message}",
  "tex.texSettings": "Настройки текстуры",
  "tex.dryRun": "Превью (холостой прогон)",
  "tex.dryRunHint": "холостой прогон — файл модели не меняется",
  "tex.notEncoded": "ещё не кодировалось",
  "tex.compare": "Сравнение — {title}",
  "tex.applyShortcut": "Применить к модели…",
  "tex.applyShortcutTitle": "Записать KTX2 с этими настройками в новый файл",
  "tex.writesWith": "запишет KTX2 с этими настройками",
  "tex.original": "Оригинал",
  "tex.previewUnavailable": "превью недоступно",
  "tex.hostMetricsOnly": "хост вернул только метрики",
  "tex.loadingPreviews": "загрузка превью…",
  "tex.loadingPreviewsShort": "загрузка…",
  "tex.noPreviews": "превью до/после нет — хост вернул только метрики",
  "tex.applied": "применено",
  "tex.notReported": "хост не сообщил",
  "tex.deselect": "снять выбор (Esc)",
  "tex.fFormat": "формат {v}",
  "tex.fQuality": "качество {v}",
  "tex.fMaxOrig": "max_size оригинал",
  "tex.fMaxSize": "max_size {v}",
  "tex.fMipsOn": "мипы вкл",
  "tex.fMipsOff": "мипы выкл",
  "tex.ktx2Written": "KTX2 записан",
  "tex.writtenTo": "KTX2 записан в {path}",
  "tex.reveal": "Показать путь",
  "tex.revealTitle": "{path}",
  "tex.previewTimeout": "тайм-аут превью текстуры — нет события завершения",
  "tex.previewNoHost": "превью недоступно — пересоберите бинарник assetty",
  "tex.previewBusy": "фоновая задача ещё идёт — превью недоступно",
  "tex.encodeTimeout": "тайм-аут кодирования — нет события завершения",
  "tex.encodeBusy": "кодирование уже идёт — дождитесь завершения",
  "tex.encodeFail": "ошибка кодирования: {message}",
  "tex.applyDemo": "демо-режим — для применения нужен бинарник assetty",
  "tex.applyNoSource": "нет исходной модели — откройте её (⌘O) или назначьте источником",
  "tex.applyBusy": "применение уже идёт — дождитесь завершения",
  "tex.applyFail": "ошибка применения: {message}",
  "tex.applyTimeout": "применение не завершилось за 10 минут — тайм-аут",
  "tex.encodeDone": "изображение {index}: {size}, {psnr} дБ",
  "tex.texturesFail": "ошибка текстур: {message}",
  "tex.baseTitle": "база: {v}",
  "tex.baseMipsOn": "база: вкл",
  "tex.baseMipsOff": "база: выкл",
  "tex.skipHint": "skip: оставить как есть (не кодировать)",
  "tex.skipLabel": "СКИП",
  "tex.normalHint": "normal_map: подсказка кодеру",
  "tex.timeoutMsg": "нет события завершения (тайм-аут)",
  "tex.notSupported": "хост не поддерживает",
  "tex.stStarting": "запуск…",
  "tex.stRunning": "работает…",
  "tex.stExporting": "экспорт в {path}…",
  "tex.paramsOv": "переопред.: {n}",
  "tex.fCodec": "кодек {v}",
  "tex.total": "всего {secs}",
  "tex.devOrig": "ориг",
  "tex.devMips": "мипы",
  "tex.devNoMips": "без мипов",
  "tex.devNormal": "нормал",
  "tex.devZstd": "zstd",
  "tex.devNoZstd": "без-zstd",
  "tex.zstdHint": "суперкомпрессия: zstd-сжатие UASTC (меньше файл, тот же VRAM)",
  "tex.kvFormat": "формат",
  "tex.kvStored": "хранение",
  "tex.kvSize": "размер",
  "tex.kvDisk": "диск",
  "tex.kvVram": "оценка vram",
  "tex.kvMips": "мипы",
  "tex.kvSource": "источник",
  "tex.kvKtx2": "размер ktx2",
  "tex.kvVramAfter": "vram после",
  "tex.kvDiskDelta": "дельта диска",
  "tex.kvVramDelta": "дельта vram",
  "tex.yes": "да",
  "tex.no": "нет",

  "set.title": "Настройки",
  "set.file": "assetty.settings.json",
  "set.info":
    "Хранится в assetty.settings.json в рабочей папке (демо-режим: localStorage). Каждое изменение применяется сразу и сохраняется через 500 мс. Схема: ",
  "set.theme": "Тема",
  "set.themeHint":
    "Интерфейс переключает CSS-переменные сразу; инспектор Babylon открывается с совпадающей темой.",
  "set.language": "Язык",
  "set.languageHint":
    "Применяется ко всем подписям мгновенно; выбор сохраняется вместе с остальными настройками.",
  "set.defaults": "Значения шагов по умолчанию",
  "set.defaultsHint":
    "Подставляют значения во вкладку оптимизации. Отправляются только включённые шаги, каждая правка сохраняется через 500 мс.",
  "set.jsonTitle": "Настройки JSON",
  "set.jsonHint":
    "Правьте весь файл вручную. «Применить» разбирает текст, поджимает числа к диапазонам и показывает ошибки строкой ниже.",
  "set.applyJson": "Применить JSON",
  "set.saveNow": "Сохранить",
  "set.reloadFile": "Перечитать из файла",
  "set.savedNow": "сохранено",
  "set.saveFail": "не сохранено (см. ошибку выше)",
  "set.presets": "Пресеты",
  "set.noPresets": "пресеты не найдены",
  "set.savePreset": "Сохранить пресет",
  "set.reloadPreset": "Перечитать пресет",
  "set.schema": "Схема",
  "set.schemaHint": "assetty.settings.json — владеет фронтенд, хост проверяет и пишет атомарно.",
  "set.stLoading": "загрузка assetty.settings.json…",
  "set.stSaving": "сохранение…",
  "set.stSaved": "сохранено",
  "set.stUpToDate": "актуально",
  "set.stReloaded": "перечитано из файла",
  "set.stError": "ошибка: {message}",
  "set.stSaveFail": "не сохранено",
  "set.presetsFail": "ошибка пресетов: {message}",
  "set.presetSaved": "сохранён {name}.zon",
  "set.presetSaveFail": "не сохранено: {message}",
  "set.presetPick": "// выберите пресет ниже",
  "set.presetLoading": "// загрузка…",
  "set.presetLoadFail": "// ошибка загрузки: {message}",

  "upd.title": "Обновление",
  "upd.current": "Текущая: {version} ({platform}-{arch})",
  "upd.check": "Проверить обновления",
  "upd.checking": "Проверка…",
  "upd.upToDate": "У вас последняя версия ({version})",
  "upd.available": "Доступна {version}",
  "upd.updateRestart": "Обновить и перезапустить",
  "upd.updating": "Обновление…",
  "upd.restarting": "Перезапуск…",
  "upd.installedManual": "Установлено {version} — закройте и откройте приложение",
  "upd.alreadyUp": "Уже последняя версия",
  "upd.notes": "Что нового: {url}",
  "upd.checkFail": "Проверка не удалась: {message}",
  "upd.applyFail": "Обновление не удалось: {message}",
  "upd.demo": "демо-режим — для обновлений нужен бинарник assetty",
  "upd.loadFail": "версию узнать не удалось: {message}",

  "toast.openFailed": "ошибка открытия: {message}",
  "toast.noOptimizeCustom": 'у бэкенда нет optimizeCustom() — запускаю пресет "{preset}"',
  "toast.customFallback": 'своя оптимизация недоступна ({message}) — запускаю "{preset}"',
  "toast.runViaBinary": "запустите через бинарник assetty",
  "toast.noOpenDialog": "openDialog недоступен — пересоберите бинарник assetty",
  "toast.noSavePath": "pickSavePath недоступен — пересоберите бинарник assetty",
  "toast.demoExport": "демо-режим — для экспорта нужен бинарник assetty",
  "toast.decodeFail": "ошибка декодирования текстуры: {detail}",
  "toast.envFail": "карта окружения не загрузилась ({url}) — металлы будут тёмными",
  "toast.texAudit": "не загрузилось текстур: {n}: {names}",
  "toast.inspectorNeedScene": "Инспектору нужна загруженная сцена — сначала откройте модель",
  "toast.inspectorFail": "ошибка инспектора: {message}",
  "toast.inspectorCloseFail": "не закрыть инспектор: {message}",
  "toast.inspNoScene": "Инспектор — нет сцены",
  "toast.inspMeshes": "Инспектор — мешей: {n}",

  "drop.dropToOpen": "Отпустите, чтобы открыть",
  "drop.opening": "Открытие {name}…",
  "drop.badExt": "{name} — не модель (только .glb/.gltf)",
  "drop.failed": "ошибка сброса: {message}",

  "progress.texture": "текстура {done}/{total}",

  "progress.lods": "ЛОД {done}/{total}",

  "help.whatDoes": "что это делает?",
  "help.aria": "справка: {id}",

  "help.prune.unused_nodes":
    "Удаляет узлы, недостижимые ни из одной сцены, в момент сериализации. Файл меньше, иерархия узлов короче; рендеринг не меняется.",
  "help.prune.unused_materials":
    "Удаляет материалы, на которые не ссылается ни один меш. Файл меньше, список материалов короче; рендеринг не меняется.",
  "help.prune.unused_textures":
    "Удаляет изображения и сэмплеры, на которые не ссылается ни один материал. Файл меньше, под текстуры резервируется меньше памяти; рендеринг не меняется.",
  "help.prune.animations":
    "Убирает все анимационные треки из результата. Анимированные узлы остаются статичными узлами сцены, скелет/скин сохраняются; файл меньше и грузится быстрее. Чтобы вернуть анимации, перезапустите из источника — результаты никогда не меняют источник.",
  "help.dedup.accessors":
    "Склеивает байтово-одинаковые GPU-буферы, чтобы хранить их один раз. Меньше размер на диске и меньше VRAM; рендеринг не меняется.",
  "help.dedup.meshes":
    "Склеивает меши с одинаковыми примитивами в одно определение. Файл меньше; рендеринг не меняется.",
  "help.dedup.materials":
    "Склеивает материалы с одинаковыми параметрами в один. Файл меньше и меньше смен состояний, что может сократить число draw calls; рендеринг не меняется.",
  "help.weld.tolerance":
    "Склеивает вершины ближе этой дистанции (0 = только точные совпадения). Большие значения закрывают микротрещины и ужимают вершинный буфер, но могут сварить UV-швы и слегка сдвинуть позиции.",
  "help.join":
    "Склеивает примитивы мешей с общим материалом в меньшее число draw calls. Вызовов меньше, но отсечение по мешам грубее — дальние части склеенного меша остаются в памяти.",
  "help.simplify.target_ratio":
    "Доля треугольников, которую оставить (0.5 = половина). Меньше треугольников — быстрее рендер и меньше памяти, ценой потери деталей силуэта.",
  "help.simplify.error_tolerance":
    "Максимально допустимая визуальная ошибка децимации. Большие значения позволяют упростителю убрать больше при той же доле, меняя точность на размер.",
  "help.simplify.aggressive":
    "Разрешает менять топологию при децимации. Упрощает агрессивнее (меньше файл, меньше треугольников), но допускает большую локальную ошибку.",
  "help.simplify.lock_borders":
    "Фиксирует границы UV-островов и мешей при децимации. Не даёт швам разойтись; mesh сжимается чуть хуже.",
  "help.simplify.use_attributes":
    "Учитывает ошибку нормалей и UV при децимации (с учётом швов). Лучше сохраняет шейдинг и UV-острова, ценой большего числа треугольников.",
  "help.simplify.weight_normal":
    "Насколько сильно штрафовать искажение нормалей в seam-aware режиме. Большие значения берегут гладкость шейдинга, но оставляют больше треугольников.",
  "help.simplify.weight_uv":
    "Насколько сильно штрафовать искажение UV в seam-aware режиме. Большие значения берегут наложение текстур, но оставляют больше треугольников.",
  "help.textures.format":
    "Кодек GPU-текстур: auto выбирает под цель, ETC1S самый компактный с быстрым транскодированием (с потерями), UASTC качественнее, но файл больше. Влияет на размер и стоимость декодирования.",
  "help.textures.quality":
    "Качество кодера ETC1S, 1–255. Большие значения берегут детали, но хуже жмут (KTX2 больше); малые меняют видимые артефакты на экономию диска.",
  "help.textures.max_size":
    "Ужимает длинную сторону до этого числа пикселей (0 = оригинал). Уполовинивание каждой стороны четвертует VRAM и диск ценой потери резкости текстур.",
  "help.textures.generate_mips":
    "Генерирует цепочку мипов для минификации. Резкая минификация без мерцания ценой ~33% VRAM; почти всегда оставляйте включённым.",
  "help.textures.supercompression":
    "Zstd-сжимает UASTC-полезную нагрузку KTX2 (supercompressionScheme=2). Файлы на 20–40% меньше при тех же пикселях — VRAM не меняется — но загрузчик должен поддерживать zstd-суперкомпрессию KTX2 (Babylon.js умеет). Только UASTC; для ETC1S игнорируется.",
  "help.textures.normal_map":
    "Кодирует как карту нормалей (ренормализация, без sRGB). Нужно для корректного света на normal maps; на цветных текстурах выцветает картинка.",
  "help.quantize.position_bits":
    "Квантует позиции вершин до этого числа бит (14 ≈ почти без потерь). Большой выигрыш VRAM и диска за крошечную потерю точности; нужна поддержка KHR_mesh_quantization.",
  "help.quantize.uv_bits":
    "Квантует текстурные координаты до этого числа бит (12 ≈ почти без потерь). Большой выигрыш VRAM и диска за крошечную потерю точности; нужна поддержка KHR_mesh_quantization.",
  "help.quantize.normal_oct":
    "Упаковывает нормали октаэдральным кодированием (2×8/16 бит вместо 3 float). Намного компактнее вершинные буферы; нужно расширение — очень старые просмотрщики могут показать неверно.",
  "help.compress":
    "Сжимает meshopt все пригодные вершинные и индексные вью буфера (EXT_meshopt_compression, как gltfpack -cc) — включая обычную float-геометрию, которую шаг quantize не тронул. Намного меньше файл при тех же вершинах; загрузчик должен поддерживать EXT_meshopt_compression.",
  "help.animops.remove_constant_tracks":
    "Убирает каналы анимации, у которых все ключевые кадры одинаковы, запекая значение в статичный трансформ узла. Файл меньше и грузится быстрее; движение не меняется. Чтобы вернуть треки, перезапустите из источника.",
  "help.animops.epsilon":
    "Допуск покомпонентного сравнения для поиска статичных треков. Больше значение — больше треков уберётся, но можно сплющить едва заметное движение; 0.00001 оставляет только по-настоящему статичные треки.",
  "help.compare.mode":
    "«Рядом» показывает источник и результат бок о бок; «шторка» складывает их с перетаскиваемым разделителем. Камеры связаны — вращайте, оба вида двигаются.",
  "help.textures.overrides_note":
    "Переопределения текстур заменяют базовые параметры для отдельных изображений только этой модели и подмешиваются в шаг textures при запуске. Правятся по каждому изображению во вкладке «Текстуры».",
  "help.textures.apply_rules":
    "Автоправила «первое совпадение — побеждает»: каждое изображение классифицируется по слоту материала (normal, arm, occlusion, emissive, base color) и суффиксу имени, первое подошедшее правило заменяет базовые параметры. Переопределения изображений всё равно главнее правил.",
  "help.textures.reencode_ktx2":
    "Транскодировать уже-KTX2 источники и перекодировать их как обычные изображения. Выкл = KTX2 пропускаются, как раньше.",
  "help.textures.rules":
    "Редактируемый JSON-массив автоправил (первое совпадение побеждает для каждого изображения). Сброс возвращает таблицу проекта. Сохраняется в настройки и каждый JSON-пресет.",
};

/* ------------------------------------------------------------------ state */

const STRINGS: Record<Lang, Dict> = { en, ru };

let current: Lang = detectLanguage();
const listeners = new Set<() => void>();

function applyHtmlLang(): void {
  try {
    document.documentElement.lang = current;
  } catch {
    // headless / non-DOM contexts
  }
}

applyHtmlLang();

export function lang(): Lang {
  return current;
}

/** Switches language now, updates `<html lang>`, notifies subscribers. */
export function setLang(next: Lang): void {
  if (next !== "en" && next !== "ru") return;
  if (current === next) return;
  current = next;
  applyHtmlLang();
  window.dispatchEvent(new CustomEvent("assetty:lang", { detail: next }));
  for (const cb of Array.from(listeners)) cb();
}

/** Re-renders on every language switch. Returns an unsubscribe function. */
export function onLang(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Localized string for `key` with `{name}` interpolation. Falls back to the
 * EN text (then to the key itself) so a missing RU entry never blanks the UI.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = STRINGS[current];
  let text = dict[key] ?? en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
