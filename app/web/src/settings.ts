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
 *   "optimize": {
 *     "steps": {
 *       "prune":    { "enabled": true, "unused_nodes": true, "unused_materials": true, "unused_textures": true },
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
import { bridge } from "./bridge";
import { detectLanguage, setLang, t } from "./i18n";
import type { Lang } from "./i18n";

export type ThemeMode = "dark" | "light";
export type Language = Lang;
export type TextureFormat = "auto" | "etc1s" | "uastc";

export interface PruneSettings {
  enabled: boolean;
  unused_nodes: boolean;
  unused_materials: boolean;
  unused_textures: boolean;
}

export interface DedupSettings {
  enabled: boolean;
  accessors: boolean;
  meshes: boolean;
  materials: boolean;
}

export interface WeldSettings {
  enabled: boolean;
  /** 0 = exact match. */
  tolerance: number;
}

export interface JoinSettings {
  enabled: boolean;
}

export interface TextureSettings {
  enabled: boolean;
  format: TextureFormat;
  quality: number;
  /** 0 = keep the source size. */
  max_size: number;
  generate_mips: boolean;
}

/**
 * One per-texture override (backend `textures` step spec, `overrides` array).
 * `image` is the 0-based `info()` image index; `name` is a case-insensitive
 * substring match on image name/uri/filename. Only present fields replace the
 * base params; `skip: true` leaves the image unencoded.
 */
export interface TextureOverride {
  image?: number;
  name?: string;
  format?: TextureFormat;
  quality?: number;
  max_size?: number;
  generate_mips?: boolean;
  skip?: boolean;
  normal_map?: boolean;
}

export interface PerModelTextures {
  overrides: TextureOverride[];
}

export interface PerModelEntry {
  textures?: PerModelTextures;
}

export interface QuantizeSettings {
  enabled: boolean;
  position_bits: number;
  uv_bits: number;
  normal_oct: boolean;
}

export interface SimplifySettings {
  enabled: boolean;
  target_ratio: number;
  error_tolerance: number;
  aggressive: boolean;
  lock_borders: boolean;
  /** Seam-aware decimation: weigh normal/UV errors. */
  use_attributes: boolean;
  weight_normal: number;
  weight_uv: number;
}

export interface OptimizeSteps {
  prune: PruneSettings;
  dedup: DedupSettings;
  weld: WeldSettings;
  join: JoinSettings;
  textures: TextureSettings;
  quantize: QuantizeSettings;
  simplify: SimplifySettings;
}

export interface Settings {
  theme: ThemeMode;
  language: Language;
  recent_dirs: string[];
  optimize: { steps: OptimizeSteps; per_model: Record<string, PerModelEntry> };
}

export interface SettingsStatus {
  state: "idle" | "loading" | "saving" | "saved" | "error";
  message?: string;
}

/** Raised by the strict parser behind the Settings tab's JSON editor. */
export class SettingsError extends Error {}

const SAVE_DEBOUNCE_MS = 500;
const THEMES: readonly ThemeMode[] = ["dark", "light"];
const LANGUAGES: readonly Language[] = ["en", "ru"];
const TEXTURE_FORMATS: readonly TextureFormat[] = ["auto", "etc1s", "uastc"];

export function defaultSettings(): Settings {
  return {
    theme: "dark",
    language: detectLanguage(),
    recent_dirs: [],
    optimize: {
      steps: {
        prune: {
          enabled: true,
          unused_nodes: true,
          unused_materials: true,
          unused_textures: true,
        },
        dedup: { enabled: true, accessors: true, meshes: true, materials: true },
        weld: { enabled: true, tolerance: 0 },
        join: { enabled: true },
        textures: {
          enabled: true,
          format: "auto",
          quality: 128,
          max_size: 0,
          generate_mips: true,
        },
        quantize: { enabled: true, position_bits: 14, uv_bits: 12, normal_oct: true },
        simplify: {
          enabled: false,
          target_ratio: 0.5,
          error_tolerance: 0.001,
          aggressive: false,
          lock_borders: true,
          use_attributes: false,
          weight_normal: 1,
          weight_uv: 1,
        },
      },
      per_model: {},
    },
  };
}

let current = defaultSettings();
/** Canonical text last written to (or read from) disk. */
let lastSaved = "";
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveInflight = false;
let savePending = false;
let status: SettingsStatus = { state: "idle" };

const changeListeners = new Set<() => void>();
const statusListeners = new Set<(status: SettingsStatus) => void>();

export function getSettings(): Settings {
  return current;
}

export function themeMode(): ThemeMode {
  return current.theme;
}

export function onSettingsChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

export function onSettingsStatus(cb: (status: SettingsStatus) => void): () => void {
  statusListeners.add(cb);
  cb(status);
  return () => statusListeners.delete(cb);
}

function emitChange(): void {
  for (const cb of Array.from(changeListeners)) cb();
}

function setStatus(next: SettingsStatus): void {
  status = next;
  for (const cb of Array.from(statusListeners)) cb(status);
}

/** Applies the CSS theme (`<html data-theme="...">`) without touching state. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
}

/** Mutates settings in place, applies theme + language, notifies and debounce-saves. */
export function updateSettings(mutate: (settings: Settings) => void): void {
  mutate(current);
  applyTheme(current.theme);
  setLang(current.language);
  emitChange();
  scheduleSave();
}

export function setTheme(mode: ThemeMode): void {
  if (current.theme === mode) return;
  updateSettings((settings) => {
    settings.theme = mode;
  });
}

export function setLanguage(language: Language): void {
  if (current.language === language) return;
  updateSettings((settings) => {
    settings.language = language;
  });
}

export function languageMode(): Language {
  return current.language;
}

export function toggleTheme(): ThemeMode {
  setTheme(current.theme === "dark" ? "light" : "dark");
  return current.theme;
}

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveSettings();
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Writes the current state now (cancels a pending debounce). Resolves true when
 * the file matches the in-app state afterwards.
 */
export async function saveSettings(): Promise<boolean> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saveInflight) {
    savePending = true;
    return true;
  }
  saveInflight = true;
  try {
    for (;;) {
      savePending = false;
      const text = settingsToJson(current);
      if (text === lastSaved) {
        setStatus({ state: "saved", message: "up to date" });
        return true;
      }
      setStatus({ state: "saving" });
      try {
        await bridge.settingsSave(text);
        lastSaved = text;
        setStatus({ state: "saved", message: "saved" });
      } catch (err) {
        setStatus({ state: "error", message: (err as Error).message });
        return false;
      }
      if (!savePending) return true;
    }
  } finally {
    saveInflight = false;
  }
}

export function settingsToJson(settings: Settings = current): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject<T>(strict: boolean, label: string, expected: string, fallback: T): T {
  if (strict) throw new SettingsError(`${label} ${expected}`);
  return fallback;
}

function readObject(
  parent: Record<string, unknown>,
  key: string,
  label: string,
  strict: boolean,
): Record<string, unknown> {
  const value = parent[key];
  if (value === undefined) return {};
  if (!isObject(value)) return reject(strict, label, "must be an object", {});
  return value;
}

function readBool(
  parent: Record<string, unknown>,
  key: string,
  fallback: boolean,
  label: string,
  strict: boolean,
): boolean {
  const value = parent[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") return reject(strict, label, "must be true or false", fallback);
  return value;
}

function readNumber(
  parent: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
  label: string,
  strict: boolean,
  integer = false,
): number {
  const value = parent[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return reject(strict, label, "must be a number", fallback);
  }
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.round(clamped) : clamped;
}

function readEnum<T extends string>(
  parent: Record<string, unknown>,
  key: string,
  fallback: T,
  allowed: readonly T[],
  label: string,
  strict: boolean,
): T {
  const value = parent[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    return reject(strict, label, `must be one of ${allowed.join(", ")}`, fallback);
  }
  return value as T;
}

/**
 * Normalizes arbitrary JSON into a full Settings object. `strict` is used by
 * the JSON editor (wrong types throw); boot/reload stays tolerant so a stale
 * file never bricks the app.
 */
export function mergeSettings(raw: unknown, strict = false): Settings {
  const out = defaultSettings();
  if (raw === undefined || raw === null) return out;
  if (!isObject(raw)) {
    if (strict) throw new SettingsError("settings must be a JSON object");
    return out;
  }

  out.theme = readEnum(raw, "theme", out.theme, THEMES, "theme", strict);
  out.language = readEnum(raw, "language", out.language, LANGUAGES, "language", strict);
  out.recent_dirs = readRecentDirs(raw, strict);

  const optimize = readObject(raw, "optimize", "optimize", strict);
  const stepsRaw = readObject(optimize, "steps", "optimize.steps", strict);
  const s = out.optimize.steps;

  const prune = readObject(stepsRaw, "prune", "optimize.steps.prune", strict);
  s.prune = {
    enabled: readBool(prune, "enabled", s.prune.enabled, "optimize.steps.prune.enabled", strict),
    unused_nodes: readBool(
      prune,
      "unused_nodes",
      s.prune.unused_nodes,
      "optimize.steps.prune.unused_nodes",
      strict,
    ),
    unused_materials: readBool(
      prune,
      "unused_materials",
      s.prune.unused_materials,
      "optimize.steps.prune.unused_materials",
      strict,
    ),
    unused_textures: readBool(
      prune,
      "unused_textures",
      s.prune.unused_textures,
      "optimize.steps.prune.unused_textures",
      strict,
    ),
  };

  const dedup = readObject(stepsRaw, "dedup", "optimize.steps.dedup", strict);
  s.dedup = {
    enabled: readBool(dedup, "enabled", s.dedup.enabled, "optimize.steps.dedup.enabled", strict),
    accessors: readBool(
      dedup,
      "accessors",
      s.dedup.accessors,
      "optimize.steps.dedup.accessors",
      strict,
    ),
    meshes: readBool(dedup, "meshes", s.dedup.meshes, "optimize.steps.dedup.meshes", strict),
    materials: readBool(
      dedup,
      "materials",
      s.dedup.materials,
      "optimize.steps.dedup.materials",
      strict,
    ),
  };

  const weld = readObject(stepsRaw, "weld", "optimize.steps.weld", strict);
  s.weld = {
    enabled: readBool(weld, "enabled", s.weld.enabled, "optimize.steps.weld.enabled", strict),
    tolerance: readNumber(
      weld,
      "tolerance",
      s.weld.tolerance,
      0,
      1,
      "optimize.steps.weld.tolerance",
      strict,
    ),
  };

  const join = readObject(stepsRaw, "join", "optimize.steps.join", strict);
  s.join = {
    enabled: readBool(join, "enabled", s.join.enabled, "optimize.steps.join.enabled", strict),
  };

  const textures = readObject(stepsRaw, "textures", "optimize.steps.textures", strict);
  s.textures = {
    enabled: readBool(
      textures,
      "enabled",
      s.textures.enabled,
      "optimize.steps.textures.enabled",
      strict,
    ),
    format: readEnum(
      textures,
      "format",
      s.textures.format,
      TEXTURE_FORMATS,
      "optimize.steps.textures.format",
      strict,
    ),
    quality: readNumber(
      textures,
      "quality",
      s.textures.quality,
      1,
      255,
      "optimize.steps.textures.quality",
      strict,
      true,
    ),
    max_size: readNumber(
      textures,
      "max_size",
      s.textures.max_size,
      0,
      8192,
      "optimize.steps.textures.max_size",
      strict,
      true,
    ),
    generate_mips: readBool(
      textures,
      "generate_mips",
      s.textures.generate_mips,
      "optimize.steps.textures.generate_mips",
      strict,
    ),
  };

  const quantize = readObject(stepsRaw, "quantize", "optimize.steps.quantize", strict);
  s.quantize = {
    enabled: readBool(
      quantize,
      "enabled",
      s.quantize.enabled,
      "optimize.steps.quantize.enabled",
      strict,
    ),
    position_bits: readNumber(
      quantize,
      "position_bits",
      s.quantize.position_bits,
      8,
      16,
      "optimize.steps.quantize.position_bits",
      strict,
      true,
    ),
    uv_bits: readNumber(
      quantize,
      "uv_bits",
      s.quantize.uv_bits,
      8,
      16,
      "optimize.steps.quantize.uv_bits",
      strict,
      true,
    ),
    normal_oct: readBool(
      quantize,
      "normal_oct",
      s.quantize.normal_oct,
      "optimize.steps.quantize.normal_oct",
      strict,
    ),
  };

  const simplify = readObject(stepsRaw, "simplify", "optimize.steps.simplify", strict);
  s.simplify = {
    enabled: readBool(
      simplify,
      "enabled",
      s.simplify.enabled,
      "optimize.steps.simplify.enabled",
      strict,
    ),
    target_ratio: readNumber(
      simplify,
      "target_ratio",
      s.simplify.target_ratio,
      0.1,
      1,
      "optimize.steps.simplify.target_ratio",
      strict,
    ),
    error_tolerance: readNumber(
      simplify,
      "error_tolerance",
      s.simplify.error_tolerance,
      0.0001,
      0.05,
      "optimize.steps.simplify.error_tolerance",
      strict,
    ),
    aggressive: readBool(
      simplify,
      "aggressive",
      s.simplify.aggressive,
      "optimize.steps.simplify.aggressive",
      strict,
    ),
    lock_borders: readBool(
      simplify,
      "lock_borders",
      s.simplify.lock_borders,
      "optimize.steps.simplify.lock_borders",
      strict,
    ),
    use_attributes: readBool(
      simplify,
      "use_attributes",
      s.simplify.use_attributes,
      "optimize.steps.simplify.use_attributes",
      strict,
    ),
    weight_normal: readNumber(
      simplify,
      "weight_normal",
      s.simplify.weight_normal,
      0,
      10,
      "optimize.steps.simplify.weight_normal",
      strict,
    ),
    weight_uv: readNumber(
      simplify,
      "weight_uv",
      s.simplify.weight_uv,
      0,
      10,
      "optimize.steps.simplify.weight_uv",
      strict,
    ),
  };

  out.optimize.per_model = readPerModel(optimize, strict);

  return out;
}

/** Normalizes one `overrides` entry; null = empty/inapplicable, dropped. */
function sanitizeTextureOverride(
  raw: unknown,
  strict: boolean,
  label: string,
): TextureOverride | null {
  if (!isObject(raw)) return reject(strict, label, "must be an object", null);
  const out: TextureOverride = {};
  if (raw["image"] !== undefined) {
    const v = raw["image"];
    if (typeof v !== "number" || !Number.isFinite(v) || Math.round(v) < 0) {
      return reject(strict, `${label}.image`, "must be a non-negative integer", null);
    }
    out.image = Math.round(v);
  }
  if (raw["name"] !== undefined) {
    const v = raw["name"];
    if (typeof v !== "string") {
      return reject(strict, `${label}.name`, "must be a string", null);
    }
    if (v.trim()) out.name = v;
  }
  if (raw["format"] !== undefined) {
    const v = raw["format"];
    if (typeof v !== "string" || !(TEXTURE_FORMATS as readonly string[]).includes(v)) {
      return reject(
        strict,
        `${label}.format`,
        `must be one of ${TEXTURE_FORMATS.join(", ")}`,
        null,
      );
    }
    out.format = v as TextureFormat;
  }
  const num = (key: string, min: number, max: number): number | undefined => {
    if (raw[key] === undefined) return undefined;
    const v = raw[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return reject(strict, `${label}.${key}`, "must be a number", undefined);
    }
    return Math.round(Math.min(max, Math.max(min, v)));
  };
  const quality = num("quality", 1, 255);
  if (quality !== undefined) out.quality = quality;
  const maxSize = num("max_size", 0, 8192);
  if (maxSize !== undefined) out.max_size = maxSize;
  for (const key of ["generate_mips", "skip", "normal_map"] as const) {
    if (raw[key] === undefined) continue;
    const v = raw[key];
    if (typeof v !== "boolean") {
      reject(strict, `${label}.${key}`, "must be true or false", undefined);
      continue;
    }
    out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function isAbsDir(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

export const RECENT_DIRS_LIMIT = 8;

/** Normalizes `recent_dirs`: absolute dirs only, deduped, most-recent-first, cap 8. */
function readRecentDirs(raw: Record<string, unknown>, strict: boolean): string[] {
  const value = raw["recent_dirs"];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    if (strict) throw new SettingsError("recent_dirs must be an array of strings");
    return [];
  }
  if (strict) {
    for (const entry of value) {
      if (typeof entry !== "string")
        throw new SettingsError("recent_dirs must be an array of strings");
    }
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || !isAbsDir(trimmed) || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= RECENT_DIRS_LIMIT) break;
  }
  return out;
}

/** Most-recent-first absolute dirs (frontend-owned, cap 8). */
export function getRecentDirs(): string[] {
  return current.recent_dirs.slice();
}

/** Records a source dir: most-recent-first, deduped, cap 8, absolute only. */
export function pushRecentDir(dir: string | null | undefined): void {
  if (!dir || !isAbsDir(dir)) return;
  updateSettings((settings) => {
    settings.recent_dirs = [dir, ...settings.recent_dirs.filter((d) => d !== dir)].slice(
      0,
      RECENT_DIRS_LIMIT,
    );
  });
}

/** dirname() of a source path (null when there is no dir part). */
export function dirnameOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx <= 0) return null;
  const dir = trimmed.slice(0, idx);
  return isAbsDir(dir) ? dir : null;
}

/** Records `dirname(sourcePath)` after every successful source open. */
export function recordRecentDirFor(sourcePath: string): void {
  pushRecentDir(dirnameOf(sourcePath));
}

function readPerModel(
  optimize: Record<string, unknown>,
  strict: boolean,
): Record<string, PerModelEntry> {
  const out: Record<string, PerModelEntry> = {};
  const raw = readObject(optimize, "per_model", "optimize.per_model", strict);
  for (const [key, value] of Object.entries(raw)) {
    if (!key || !isObject(value)) {
      if (strict) throw new SettingsError("optimize.per_model entries must be objects");
      continue;
    }
    const label = `optimize.per_model.${key}.textures.overrides`;
    const texRaw = readObject(value, "textures", label, strict);
    const list = texRaw["overrides"];
    if (list === undefined) {
      out[key] = {};
      continue;
    }
    if (!Array.isArray(list)) {
      if (strict) throw new SettingsError(`${label} must be an array`);
      out[key] = {};
      continue;
    }
    const overrides: TextureOverride[] = [];
    for (let i = 0; i < list.length; i++) {
      const clean = sanitizeTextureOverride(list[i], strict, `${label}[${i}]`);
      if (clean) overrides.push(clean);
    }
    out[key] = { textures: { overrides } };
  }
  return out;
}

/* ------------------------------------------------- per-model texture overrides */

/** Overrides stored for one source model (never shared across models). */
export function getTextureOverrides(sourcePath: string | null | undefined): TextureOverride[] {
  if (!sourcePath) return [];
  return current.optimize.per_model[sourcePath]?.textures?.overrides ?? [];
}

export function textureOverridesCount(sourcePath: string | null | undefined): number {
  return getTextureOverrides(sourcePath).length;
}

/** Image-index override for one row (the Textures tab editor owns these). */
export function textureOverrideForImage(
  sourcePath: string | null | undefined,
  image: number,
): TextureOverride | undefined {
  return getTextureOverrides(sourcePath).find((o) => o.image === image);
}

function cleanOverride(patch: TextureOverride): TextureOverride {
  const out: TextureOverride = {};
  if (patch.image !== undefined) out.image = patch.image;
  if (patch.name !== undefined && patch.name.trim()) out.name = patch.name;
  if (patch.format !== undefined) out.format = patch.format;
  if (patch.quality !== undefined) out.quality = patch.quality;
  if (patch.max_size !== undefined) out.max_size = patch.max_size;
  if (patch.generate_mips !== undefined) out.generate_mips = patch.generate_mips;
  if (patch.skip !== undefined) out.skip = patch.skip;
  if (patch.normal_map !== undefined) out.normal_map = patch.normal_map;
  return out;
}

/**
 * Inserts/replaces the image-indexed override for `sourcePath`. A patch with
 * no fields besides `image` removes the entry instead.
 */
export function replaceTextureOverride(sourcePath: string, patch: TextureOverride): void {
  if (patch.image === undefined) return;
  updateSettings((settings) => {
    const perModel = (settings.optimize.per_model[sourcePath] ??= {});
    const tex = (perModel.textures ??= { overrides: [] });
    const clean = cleanOverride(patch);
    const idx = tex.overrides.findIndex((o) => o.image === patch.image);
    if (Object.keys(clean).length <= 1) {
      if (idx >= 0) tex.overrides.splice(idx, 1);
      return;
    }
    if (idx >= 0) tex.overrides[idx] = clean;
    else tex.overrides.push(clean);
  });
}

/** Clears the image-indexed override ("Reset" in the row editor). */
export function clearTextureOverride(sourcePath: string, image: number): void {
  updateSettings((settings) => {
    const list = settings.optimize.per_model[sourcePath]?.textures?.overrides;
    if (!list) return;
    const idx = list.findIndex((o) => o.image === image);
    if (idx >= 0) list.splice(idx, 1);
  });
}

function overrideMatches(
  o: TextureOverride,
  image: number,
  name: string | null | undefined,
): boolean {
  if (o.image !== undefined && o.image === image) return true;
  if (o.name && name && name.toLowerCase().includes(o.name.toLowerCase())) return true;
  // No target at all: applies to every image (same as the backend).
  return o.image === undefined && !o.name;
}

export interface EffectiveTextureParams {
  format: TextureFormat;
  quality: number;
  max_size: number;
  generate_mips: boolean;
  normal_map?: boolean;
  skip: boolean;
}

/** Base params with this model's overrides applied in array order. */
export function effectiveTextureParams(
  sourcePath: string | null | undefined,
  image: number,
  name: string | null | undefined,
): EffectiveTextureParams {
  const base = current.optimize.steps.textures;
  const eff: EffectiveTextureParams = {
    format: base.format,
    quality: base.quality,
    max_size: base.max_size,
    generate_mips: base.generate_mips,
    skip: false,
  };
  for (const o of getTextureOverrides(sourcePath)) {
    if (!overrideMatches(o, image, name)) continue;
    if (o.format !== undefined) eff.format = o.format;
    if (o.quality !== undefined) eff.quality = o.quality;
    if (o.max_size !== undefined) eff.max_size = o.max_size;
    if (o.generate_mips !== undefined) eff.generate_mips = o.generate_mips;
    if (o.normal_map !== undefined) eff.normal_map = o.normal_map;
    if (o.skip !== undefined) eff.skip = o.skip;
  }
  return eff;
}

/**
 * Short deviation label for the row badge (`uastc · 512 · q200`, `skipped`).
 * Null when the effective params equal the base params.
 */
export function describeTextureDeviation(
  sourcePath: string | null | undefined,
  image: number,
  name: string | null | undefined,
): string | null {
  const base = current.optimize.steps.textures;
  const eff = effectiveTextureParams(sourcePath, image, name);
  if (eff.skip) return t("tex.skipped");
  const parts: string[] = [];
  if (eff.format !== base.format) parts.push(eff.format);
  if (eff.quality !== base.quality) parts.push(`q${eff.quality}`);
  if (eff.max_size !== base.max_size) {
    parts.push(eff.max_size === 0 ? t("tex.devOrig") : String(eff.max_size));
  }
  if (eff.generate_mips !== base.generate_mips) {
    parts.push(eff.generate_mips ? t("tex.devMips") : t("tex.devNoMips"));
  }
  if (eff.normal_map) parts.push(t("tex.devNormal"));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Strict parse for the Settings tab's "edit as JSON" surface. */
export function parseSettingsText(text: string): Settings {
  const trimmed = text.trim();
  if (!trimmed) return defaultSettings();
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (err) {
    throw new SettingsError(`invalid JSON: ${(err as Error).message}`);
  }
  return mergeSettings(raw, true);
}

/** Applies edited JSON in-app immediately, then debounce-saves. */
export function applySettingsText(text: string): Settings {
  const next = parseSettingsText(text);
  current = next;
  applyTheme(current.theme);
  setLang(current.language);
  emitChange();
  scheduleSave();
  return next;
}

/**
 * Reads `assetty.settings.json` (host) / localStorage (demo) and adopts it.
 * Tolerant: a malformed file keeps the current state and reports an error.
 */
export async function loadSettings(options: { announce?: boolean } = {}): Promise<boolean> {
  setStatus({ state: "loading" });
  let text: string;
  try {
    text = await bridge.settingsLoad();
  } catch (err) {
    applyTheme(current.theme);
    setStatus({ state: "error", message: `load failed: ${(err as Error).message}` });
    return false;
  }
  let next: Settings;
  try {
    next = text.trim() ? mergeSettings(JSON.parse(text), false) : defaultSettings();
  } catch (err) {
    applyTheme(current.theme);
    setStatus({ state: "error", message: `invalid settings file: ${(err as Error).message}` });
    return false;
  }
  current = next;
  lastSaved = settingsToJson(current);
  applyTheme(current.theme);
  setLang(current.language);
  emitChange();
  setStatus({ state: "saved", message: options.announce ? "reloaded from file" : "loaded" });
  return true;
}

/** Explicit "reload from file" button. */
export function reloadSettings(): Promise<boolean> {
  return loadSettings({ announce: true });
}
