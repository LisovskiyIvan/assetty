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
 *     }
 *   }
 * }
 *
 * `enabled` drives the Optimize tab step checkboxes — only enabled steps are
 * sent in the `optimizeCustom` spec. Missing keys fall back to the defaults
 * above, unknown keys are dropped, numbers are clamped to their UI ranges.
 * Writes are debounced (500 ms) and go through `settingsSave(text)`.
 */
import { bridge } from "./bridge";

export type ThemeMode = "dark" | "light";
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
  optimize: { steps: OptimizeSteps };
}

export interface SettingsStatus {
  state: "idle" | "loading" | "saving" | "saved" | "error";
  message?: string;
}

/** Raised by the strict parser behind the Settings tab's JSON editor. */
export class SettingsError extends Error {}

const SAVE_DEBOUNCE_MS = 500;
const THEMES: readonly ThemeMode[] = ["dark", "light"];
const TEXTURE_FORMATS: readonly TextureFormat[] = ["auto", "etc1s", "uastc"];

export function defaultSettings(): Settings {
  return {
    theme: "dark",
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

/** Mutates settings in place, applies the theme, notifies and debounce-saves. */
export function updateSettings(mutate: (settings: Settings) => void): void {
  mutate(current);
  applyTheme(current.theme);
  emitChange();
  scheduleSave();
}

export function setTheme(mode: ThemeMode): void {
  if (current.theme === mode) return;
  updateSettings((settings) => {
    settings.theme = mode;
  });
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

  return out;
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
  emitChange();
  setStatus({ state: "saved", message: options.announce ? "reloaded from file" : "loaded" });
  return true;
}

/** Explicit "reload from file" button. */
export function reloadSettings(): Promise<boolean> {
  return loadSettings({ announce: true });
}
