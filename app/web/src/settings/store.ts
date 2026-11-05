/** Settings store: in-app state, debounce-save, listeners, recent dirs, per-model overrides. */
import { bridge } from "../bridge";
import { setLang, t } from "../i18n";
import {
  RECENT_DIRS_LIMIT,
  defaultSettings,
  isAbsDir,
  mergeSettings,
  parseSettingsText,
} from "./schema";
import type {
  Language,
  Settings,
  SettingsStatus,
  Supercompression,
  TextureFormat,
  TextureOverride,
  ThemeMode,
} from "./schema";
let current = defaultSettings();
/** Canonical text last written to (or read from) disk. */
let lastSaved = "";
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveInflight = false;
let savePending = false;
let status: SettingsStatus = { state: "idle" };

const SAVE_DEBOUNCE_MS = 500;

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

/** Whether the viewer inspector auto-opens on model load (persisted). */
export function inspectorOpenPref(): boolean {
  return current.viewer.inspector_open;
}

/** Records a manual ⌘I toggle so the next load/tab return restores it. */
export function setInspectorOpenPref(open: boolean): void {
  if (current.viewer.inspector_open === open) return;
  updateSettings((settings) => {
    settings.viewer.inspector_open = open;
  });
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
  if (patch.supercompression !== undefined) out.supercompression = patch.supercompression;
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
  supercompression: Supercompression;
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
    supercompression: base.supercompression,
    skip: false,
  };
  for (const o of getTextureOverrides(sourcePath)) {
    if (!overrideMatches(o, image, name)) continue;
    if (o.format !== undefined) eff.format = o.format;
    if (o.quality !== undefined) eff.quality = o.quality;
    if (o.max_size !== undefined) eff.max_size = o.max_size;
    if (o.generate_mips !== undefined) eff.generate_mips = o.generate_mips;
    if (o.normal_map !== undefined) eff.normal_map = o.normal_map;
    if (o.supercompression !== undefined) eff.supercompression = o.supercompression;
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
  if (eff.supercompression !== base.supercompression) {
    parts.push(eff.supercompression === "zstd" ? t("tex.devZstd") : t("tex.devNoZstd"));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
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
