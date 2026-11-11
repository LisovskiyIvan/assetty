/**
 * Shared job guards: stale-reply tokens, busy-error toasts, settings-edit
 * scopes, the save-as/export error surface used by both tabs, and runtime
 * shape guards for unvalidated host JSON.
 */
import { isMissingMethodError, notify } from "./notify";
import { t } from "./i18n";
import { basename } from "./ui";
import { app } from "./app";
import type { AppInfo, Info, UpdateApply, UpdateCheck } from "./types";
import type { TextureRule } from "./settings/schema";
// The pure shape predicates live in the leaf so bridge/events.ts (which must
// not import the app graph) can share them; re-exported here for callers of
// this module.
import { kindOf } from "./hostShapes";
export { isTextureImageReport, assertTextureImageReports } from "./hostShapes";

export function isBusyError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /\bbusy\b|already running|job in progress/i.test(text);
}

/** Best-effort message for anything thrown (Error, string, or other). */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err === null || err === undefined) return "unknown error";
  return String(err);
}

/** Re-exported from jobs.ts (DOM-free, unit-testable); guards.ts keeps the import path. */
export { isCancelledError } from "./jobs";

/**
 * Monotonic token that invalidates late async replies (preview/encode/apply
 * races). `next()` starts a new generation; `check(token)` is true only for
 * the latest one; `bump()` cancels the in-flight generation.
 */
export function createSeq(): {
  next(): number;
  current(): number;
  check(token: number): boolean;
  bump(): void;
} {
  let seq = 0;
  return {
    next: () => ++seq,
    current: () => seq,
    check: (token: number) => token === seq,
    bump: () => {
      seq++;
    },
  };
}

/** Toasts a job failure, mapping "busy" rejections to the busy message. */
export function notifyJobError(
  err: unknown,
  busyText: string,
  failText: (message: string) => string,
): void {
  notify(isBusyError(err) ? busyText : failText(errMessage(err)), "error");
}

/**
 * True when a key event lands in an editable field — Escape there belongs to
 * the field (presets name, override inputs), never to job cancellation.
 */
export function isFormTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * True when a menu or popover owns Escape (topbar recent-dirs / log popover,
 * the presets dropdown, the "?" help pop). Tabs must not cancel jobs then —
 * the open surface closes first.
 */
export function isOverlayOpen(): boolean {
  return (
    document.querySelector(
      ".field-help-pop,.recent-menu:not([hidden]),.status-popover:not([hidden]),.preset-menu:not([hidden])",
    ) !== null
  );
}

/**
 * True when the tab owning `node` is the visible one (main.ts hides inactive
 * tabs with `display: none`). Document-level Escape handlers must ignore
 * hidden tabs — Esc cancels only the active tab's work, never a hidden one.
 */
export function isTabVisible(node: HTMLElement): boolean {
  return node.isConnected && node.offsetParent !== null;
}

/**
 * Guards a settings subscription against its own tab's writes: wrap the local
 * mutation in `wrap()`, and skip re-renders while `isInternal()` is true.
 */
export function createSettingsEdit(): {
  wrap(fn: () => void): void;
  isInternal(): boolean;
} {
  let internal = false;
  return {
    wrap: (fn: () => void) => {
      internal = true;
      try {
        fn();
      } finally {
        internal = false;
      }
    },
    isInternal: () => internal,
  };
}

/**
 * Shared save-as/export surface: native save panel + host-copy error mapping.
 * Returns the picked destination or null on cancel/dialog failure. Export
 * state (flags, pending dst) stays with the caller — only the identical
 * dialog + error branches are shared.
 */
export async function pickSaveTarget(outPath: string): Promise<string | null> {
  let pick: { path: string | null };
  try {
    pick = await app.bridge.pickSavePath(basename(outPath));
  } catch (err) {
    notify(t("opt.saveDlgFail", { message: errMessage(err) }), "error");
    return null;
  }
  if (!pick.path) return null; // cancel
  if (!app.bridge.live) {
    notify(t("opt.exportDemo"), "error");
    return null;
  }
  return pick.path;
}

/** Toasts an `exportTo()` failure (busy / missing host method / generic). */
export function notifyExportError(err: unknown): void {
  if (isBusyError(err)) {
    notify(t("opt.exportBusy"), "error");
  } else if (isMissingMethodError(err)) {
    notify(t("opt.exportNoHost"), "error");
  } else {
    notify(t("opt.exportFail", { message: errMessage(err) }), "error");
  }
}

/* ------------------------------------------------------- host-shape guards */

/** Asserts a plain object (records only, never arrays/null). */
export function assertRecord(value: unknown, what = "value"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what}: expected object, got ${kindOf(value)}`);
  }
  return value as Record<string, unknown>;
}

function assertRecField(
  rec: Record<string, unknown>,
  key: string,
  what: string,
): Record<string, unknown> {
  return assertRecord(rec[key], `${what}.${key}`);
}

function assertStrField(rec: Record<string, unknown>, key: string, what: string): string {
  const v = rec[key];
  if (typeof v !== "string") throw new Error(`${what}.${key}: expected string, got ${kindOf(v)}`);
  return v;
}

/** Validates the `info` host payload (throws on a wrong shape). */
export function assertInfo(value: unknown): Info {
  const rec = assertRecord(value, "info");
  assertStrField(rec, "file", "info");
  for (const key of ["counts", "geometry", "disk", "vram", "garbage"]) {
    assertRecField(rec, key, "info");
  }
  const vram = assertRecField(rec, "vram", "info");
  if (!Array.isArray(vram.images)) {
    throw new Error(`info.vram.images: expected array, got ${kindOf(vram.images)}`);
  }
  return value as Info;
}

/** Validates the `appInfo` host payload (throws on a wrong shape). */
export function assertAppInfo(value: unknown): AppInfo {
  const rec = assertRecord(value, "appInfo");
  for (const key of ["version", "repo", "platform", "arch", "asset"]) {
    assertStrField(rec, key, "appInfo");
  }
  return value as AppInfo;
}

/** Validates the `updateCheck` host payload (throws on a wrong shape). */
export function assertUpdateCheck(value: unknown): UpdateCheck {
  const rec = assertRecord(value, "updateCheck");
  if (typeof rec.available !== "boolean") {
    throw new Error(`updateCheck.available: expected boolean, got ${kindOf(rec.available)}`);
  }
  for (const key of ["current", "version", "asset", "download_url", "notes_url"]) {
    assertStrField(rec, key, "updateCheck");
  }
  return value as UpdateCheck;
}

/** Validates the `updateApply` host payload (throws on a wrong shape). */
export function assertUpdateApply(value: unknown): UpdateApply {
  const rec = assertRecord(value, "updateApply");
  if (typeof rec.installed !== "boolean") {
    throw new Error(`updateApply.installed: expected boolean, got ${kindOf(rec.installed)}`);
  }
  assertStrField(rec, "version", "updateApply");
  if (typeof rec.restarted !== "boolean") {
    throw new Error(`updateApply.restarted: expected boolean, got ${kindOf(rec.restarted)}`);
  }
  return value as UpdateApply;
}

/** True when one texture auto-rule has the expected shape. */
export function isTextureRule(value: unknown): value is TextureRule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  for (const key of ["slot", "name", "format", "supercompression"] as const) {
    const v = rec[key];
    if (v !== undefined && typeof v !== "string") return false;
  }
  for (const key of [
    "priority",
    "quality",
    "rdo_lambda",
    "max_size",
    "min_side",
    "max_side",
  ] as const) {
    const v = rec[key];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) return false;
  }
  for (const key of ["srgb", "generate_mips", "normal_map", "cutout", "skip"] as const) {
    const v = rec[key];
    if (v !== undefined && typeof v !== "boolean") return false;
  }
  return true;
}

/** Validates a texture-rules textarea payload (throws on a wrong shape). */
export function assertTextureRules(value: unknown): TextureRule[] {
  if (!Array.isArray(value)) {
    throw new Error(`rules: expected array, got ${kindOf(value)}`);
  }
  for (let i = 0; i < value.length; i++) {
    if (!isTextureRule(value[i])) {
      throw new Error(`rules[${i}]: expected TextureRule, got ${kindOf(value[i])}`);
    }
  }
  return value as TextureRule[];
}
