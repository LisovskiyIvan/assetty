/**
 * One place for user-facing diagnostics.
 *
 * Every message goes to a toast *and* to the status bar (via `onLog`), so a
 * failure that only happened once — a missing decoder, a dead environment
 * texture — leaves a visible trace instead of disappearing with the toast.
 */
import { toast } from "./ui";

export type NotifyKind = "info" | "ok" | "error";

type LogListener = (message: string, kind: NotifyKind) => void;

const listeners = new Set<LogListener>();

/** Rolling buffer so the status bar popover can list what just happened. */
export interface LogEntry {
  message: string;
  kind: NotifyKind;
  at: number;
}

const HISTORY_LIMIT = 20;
const history: LogEntry[] = [];

/** Subscribes to every `notify()` call (used by the status bar). */
export function onLog(cb: LogListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Newest-last copy of the last ~20 messages. */
export function logHistory(): LogEntry[] {
  return history.slice();
}

export function notify(message: string, kind: NotifyKind = "info", ms = 4200): void {
  history.push({ message, kind, at: Date.now() });
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  toast(message, kind, ms);
  for (const cb of listeners) {
    try {
      cb(message, kind);
    } catch {
      // a broken listener must never swallow the notification
    }
  }
}

/** True for errors that mean "this backend build predates the method". */
export function isMissingMethodError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /no such method|not available|has no .*\(\)|unknown method|not a function|missing method|no backend method/i.test(
    text,
  );
}
