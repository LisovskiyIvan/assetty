/**
 * In-app settings — single source of truth for the theme and the Optimize tab
 * defaults. Persisted to `assetty.settings.json` (cwd) through the nanoui
 * bridge: the host owns the file (validates + writes atomically), the frontend
 * owns the schema below.
 *
 * Schema (exact):
 *
 * {
 *   "theme": "dark" | "light",
 *   "language": "en" | "ru",
 *   "recent_dirs": string[] (absolute dirs, most-recent-first, cap 8),
 *   "viewer": { "inspector_open": boolean },
 *   "optimize": {
 *     "steps": {
 *       "prune":    { "enabled": true, "unused_nodes": true, "unused_materials": true, "unused_textures": true, "animations": true },
 *       "dedup":    { "enabled": true, "accessors": true, "meshes": true, "materials": true },
 *       "weld":     { "enabled": true, "tolerance": 0 },
 *       "join":     { "enabled": true },
 *       "textures": { "enabled": true, "format": "auto" | "etc1s" | "uastc",
 *                     "quality": 128, "max_size": 0, "generate_mips": true },
 *       "quantize": { "enabled": true, "position_bits": 14, "uv_bits": 12, "normal_oct": true },
 *       "simplify": { "enabled": false, "target_ratio": 0.5, "error_tolerance": 0.001,
 *                     "aggressive": false, "lock_borders": true,
 *                     "use_attributes": false, "weight_normal": 1, "weight_uv": 1 }
 *     },
 *     "per_model": {
 *       "<sourcePath>": { "textures": { "overrides": [
 *         { "image": 2, "format": "uastc", "quality": 200, "max_size": 512,
 *           "generate_mips": true, "skip": false, "normal_map": true },
 *         { "name": "basecolor", "max_size": 1024 },
 *         { "image": 5, "skip": true }
 *       ] } }
 *     }
 *   }
 * }
 *
 * `enabled` drives the Optimize tab step checkboxes — only enabled steps are
 * sent in the `optimizeCustom` spec. Missing keys fall back to the defaults
 * above, unknown keys are dropped, numbers are clamped to their UI ranges.
 * Writes are debounced (500 ms) and go through `settingsSave(text)`.
 *
 * `per_model` holds MODEL-SCOPED per-texture overrides keyed by sourcePath
 * (the app's optimize source; indices are that model's `info()` image indices
 * and must never leak to another model). `image` matches one image index,
 * `name` matches case-insensitively against image name/uri/filename, entries
 * apply in array order and only present fields replace the base params;
 * `skip: true` leaves the image unencoded. Missing `per_model` merges to {}.
 */
export {
  RECENT_DIRS_LIMIT,
  defaultSettings,
  mergeSettings,
  parseSettingsText,
} from "./settings/schema";
export type {
  DedupSettings,
  JoinSettings,
  Language,
  OptimizeSteps,
  PerModelEntry,
  PerModelTextures,
  PruneSettings,
  QuantizeSettings,
  Settings,
  SettingsStatus,
  SimplifySettings,
  TextureFormat,
  TextureOverride,
  TextureSettings,
  ThemeMode,
  WeldSettings,
} from "./settings/schema";
export { SettingsError } from "./settings/schema";
export {
  applySettingsText,
  applyTheme,
  clearTextureOverride,
  describeTextureDeviation,
  dirnameOf,
  effectiveTextureParams,
  getRecentDirs,
  getSettings,
  getTextureOverrides,
  inspectorOpenPref,
  languageMode,
  loadSettings,
  onSettingsChange,
  onSettingsStatus,
  pushRecentDir,
  recordRecentDirFor,
  reloadSettings,
  replaceTextureOverride,
  saveSettings,
  setInspectorOpenPref,
  setLanguage,
  setTheme,
  settingsToJson,
  textureOverrideForImage,
  textureOverridesCount,
  themeMode,
  toggleTheme,
  updateSettings,
} from "./settings/store";
export type { EffectiveTextureParams } from "./settings/store";
