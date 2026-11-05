/** Settings schema: types, defaults, and tolerant/strict file normalization (no I/O, no DOM). */
import { detectLanguage } from "../i18n";
import type { Lang } from "../i18n";
export type ThemeMode = "dark" | "light";
export type Language = Lang;
export type TextureFormat = "auto" | "etc1s" | "uastc";
export type Supercompression = "none" | "zstd";

export interface PruneSettings {
  enabled: boolean;
  unused_nodes: boolean;
  unused_materials: boolean;
  unused_textures: boolean;
  /** Keep animation tracks in the output (false = strip them). */
  animations: boolean;
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
  /** KTX2 payload supercompression (UASTC only; "none" = off). */
  supercompression: Supercompression;
  /** First-match-wins auto rules (slot suffix table); off = legacy base params. */
  apply_rules: boolean;
  /** Re-encode already-KTX2 sources instead of skipping them. */
  reencode_ktx2: boolean;
  /** Editable auto-rule table (first match wins per image). */
  rules: TextureRule[];
}

/** Slot class a texture auto-rule matches on. */
export type TextureSlot = "base_color" | "normal" | "arm" | "occlusion" | "emissive";

/**
 * One texture auto-rule (backend `textures` step `rules` array, first match
 * wins per image — unlike overrides, which are last-wins). A rule matches
 * when every set selector agrees: `slot` is in the image's slot set,
 * `cutout` equals the image's cutout flag, `name` is a case-insensitive
 * SUFFIX of the image name/uri stem, and the image min side is within
 * `[min_side, max_side]` when set (size-bounded rules never match unknown
 * dims). Only present fields replace the base params; `skip: true` leaves
 * the image unencoded.
 */
export interface TextureRule {
  slot?: TextureSlot;
  name?: string;
  format?: TextureFormat;
  quality?: number;
  rdo_lambda?: number;
  supercompression?: Supercompression;
  srgb?: boolean;
  generate_mips?: boolean;
  max_size?: number;
  normal_map?: boolean;
  cutout?: boolean;
  min_side?: number;
  max_side?: number;
  skip?: boolean;
}

/**
 * Project-derived default auto-rules (Reset button seed; edit freely).
 * Order is first-match-wins: skips, cutout alpha, normal, arm, occlusion,
 * emissive, single-channel fallbacks, base-color fallbacks.
 */
export const DEFAULT_TEXTURE_RULES: TextureRule[] = [
  { max_side: 255, skip: true },
  { name: "height", skip: true },
  { name: "bump", skip: true },
  { name: "disp", skip: true },
  { name: "lut", skip: true },
  { name: "data", skip: true },
  { name: "shaderarray", skip: true },
  { slot: "base_color", cutout: true, format: "uastc", srgb: true },
  {
    slot: "normal",
    format: "uastc",
    rdo_lambda: 0.5,
    supercompression: "zstd",
    srgb: false,
    normal_map: true,
  },
  { slot: "arm", format: "uastc", rdo_lambda: 1.0, supercompression: "zstd", srgb: false },
  { slot: "occlusion", format: "uastc", rdo_lambda: 1.0, supercompression: "zstd", srgb: false },
  { slot: "emissive", format: "etc1s", srgb: true },
  { name: "_orm", format: "uastc", supercompression: "zstd", srgb: false },
  { name: "_arm", format: "uastc", supercompression: "zstd", srgb: false },
  { name: "_rm", format: "uastc", supercompression: "zstd", srgb: false },
  { name: "occlusionroughnessmetallic", format: "uastc", supercompression: "zstd", srgb: false },
  { name: "_roughness", format: "uastc", supercompression: "zstd", srgb: false },
  { name: "_metallic", format: "uastc", supercompression: "zstd", srgb: false },
  { name: "_occlusion", format: "uastc", supercompression: "zstd", srgb: false },
  { name: "_opacity", format: "uastc", supercompression: "zstd", srgb: false },
  { name: "_mask", format: "uastc", supercompression: "zstd", srgb: false },
  { name: "_ao", format: "uastc", supercompression: "zstd", srgb: false },
  { name: "_basecolor", format: "etc1s", srgb: true },
  { name: "_albedo", format: "etc1s", srgb: true },
  { name: "_diffuse", format: "etc1s", srgb: true },
  { name: "_bc", format: "etc1s", srgb: true },
  { name: "_color", format: "etc1s", srgb: true },
  { name: "_d", format: "etc1s", srgb: true },
];

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
  supercompression?: Supercompression;
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
  /** Viewer prefs: whether the inspector auto-opens on model load. */
  viewer: { inspector_open: boolean };
  optimize: { steps: OptimizeSteps; per_model: Record<string, PerModelEntry> };
}

export interface SettingsStatus {
  state: "idle" | "loading" | "saving" | "saved" | "error";
  message?: string;
}

/** Raised by the strict parser behind the Settings tab's JSON editor. */
export class SettingsError extends Error {}

const THEMES: readonly ThemeMode[] = ["dark", "light"];
const LANGUAGES: readonly Language[] = ["en", "ru"];
const TEXTURE_FORMATS: readonly TextureFormat[] = ["auto", "etc1s", "uastc"];
const SUPERCOMPRESSIONS: readonly Supercompression[] = ["none", "zstd"];

export function defaultSettings(): Settings {
  return {
    theme: "dark",
    language: detectLanguage(),
    recent_dirs: [],
    viewer: { inspector_open: false },
    optimize: {
      steps: {
        prune: {
          enabled: true,
          unused_nodes: true,
          unused_materials: true,
          unused_textures: true,
          animations: true,
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
          supercompression: "none",
          apply_rules: false,
          reencode_ktx2: false,
          rules: [],
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

  const viewerRaw = readObject(raw, "viewer", "viewer", strict);
  out.viewer = {
    inspector_open: readBool(
      viewerRaw,
      "inspector_open",
      out.viewer.inspector_open,
      "viewer.inspector_open",
      strict,
    ),
  };

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
    animations: readBool(
      prune,
      "animations",
      s.prune.animations,
      "optimize.steps.prune.animations",
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
    supercompression: readEnum(
      textures,
      "supercompression",
      s.textures.supercompression,
      SUPERCOMPRESSIONS,
      "optimize.steps.textures.supercompression",
      strict,
    ),
    apply_rules: readBool(
      textures,
      "apply_rules",
      s.textures.apply_rules,
      "optimize.steps.textures.apply_rules",
      strict,
    ),
    reencode_ktx2: readBool(
      textures,
      "reencode_ktx2",
      s.textures.reencode_ktx2,
      "optimize.steps.textures.reencode_ktx2",
      strict,
    ),
    rules: readTextureRules(textures, "optimize.steps.textures.rules", strict),
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
  if (raw["supercompression"] !== undefined) {
    const v = raw["supercompression"];
    if (typeof v !== "string" || !(SUPERCOMPRESSIONS as readonly string[]).includes(v)) {
      return reject(
        strict,
        `${label}.supercompression`,
        `must be one of ${SUPERCOMPRESSIONS.join(", ")}`,
        null,
      );
    }
    out.supercompression = v as Supercompression;
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

const TEXTURE_SLOTS: readonly TextureSlot[] = [
  "base_color",
  "normal",
  "arm",
  "occlusion",
  "emissive",
];

/** Normalizes one auto-rule; null = empty/inapplicable, dropped. */
function sanitizeTextureRule(raw: unknown, strict: boolean, label: string): TextureRule | null {
  if (!isObject(raw)) return reject(strict, label, "must be an object", null);
  const out: TextureRule = {};
  if (raw["slot"] !== undefined) {
    const v = raw["slot"];
    if (typeof v !== "string" || !(TEXTURE_SLOTS as readonly string[]).includes(v)) {
      return reject(strict, `${label}.slot`, `must be one of ${TEXTURE_SLOTS.join(", ")}`, null);
    }
    out.slot = v as TextureSlot;
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
  if (raw["supercompression"] !== undefined) {
    const v = raw["supercompression"];
    if (typeof v !== "string" || !(SUPERCOMPRESSIONS as readonly string[]).includes(v)) {
      return reject(
        strict,
        `${label}.supercompression`,
        `must be one of ${SUPERCOMPRESSIONS.join(", ")}`,
        null,
      );
    }
    out.supercompression = v as Supercompression;
  }
  const num = (key: string, min: number, max: number, integer = true): number | undefined => {
    if (raw[key] === undefined) return undefined;
    const v = raw[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return reject(strict, `${label}.${key}`, "must be a number", undefined);
    }
    return integer ? Math.round(Math.min(max, Math.max(min, v))) : Math.min(max, Math.max(min, v));
  };
  const quality = num("quality", 1, 255);
  if (quality !== undefined) out.quality = quality;
  const maxSize = num("max_size", 0, 8192);
  if (maxSize !== undefined) out.max_size = maxSize;
  const minSide = num("min_side", 0, 8192);
  if (minSide !== undefined) out.min_side = minSide;
  const maxSide = num("max_side", 0, 8192);
  if (maxSide !== undefined) out.max_side = maxSide;
  const rdo = num("rdo_lambda", 0, 100, false);
  if (rdo !== undefined) out.rdo_lambda = rdo;
  for (const key of ["srgb", "generate_mips", "normal_map", "cutout", "skip"] as const) {
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

function readTextureRules(
  textures: Record<string, unknown>,
  label: string,
  strict: boolean,
): TextureRule[] {
  const list = textures["rules"];
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    if (strict) throw new SettingsError(`${label} must be an array`);
    return [];
  }
  if (strict && list.length > 256) throw new SettingsError(`${label} is too long`);
  const out: TextureRule[] = [];
  for (let i = 0; i < list.length; i++) {
    const clean = sanitizeTextureRule(list[i], strict, `${label}[${i}]`);
    if (clean) out.push(clean);
  }
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

export function isAbsDir(p: string): boolean {
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
