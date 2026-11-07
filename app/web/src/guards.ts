/**
 * Shared job guards: stale-reply tokens, busy-error toasts, settings-edit
 * scopes, and the save-as/export error surface used by both tabs.
 */
import { isMissingMethodError, notify } from "./notify";
import { t } from "./i18n";
import { basename } from "./ui";
import { app } from "./app";

export function isBusyError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /\bbusy\b|already running|job in progress/i.test(text);
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
  notify(isBusyError(err) ? busyText : failText((err as Error).message), "error");
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
    notify(t("opt.saveDlgFail", { message: (err as Error).message }), "error");
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
    notify(t("opt.exportFail", { message: (err as Error).message }), "error");
  }
}
