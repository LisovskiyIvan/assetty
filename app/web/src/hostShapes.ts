/**
 * Import-pure shape predicates for unvalidated host JSON.
 *
 * `bridge/events.ts` normalizes host payloads but must stay free of the app
 * graph (`guards.ts` pulls in notify/i18n/ui, which touch `window`), so the
 * pure predicates live in this leaf: both modules import it without a cycle
 * and without a window stub in tests. `guards.ts` re-exports the names for
 * callers that already go through it.
 */
import type { TextureImageReport } from "./types";

/** Short `typeof`/shape label for guard errors (never throws). */
export function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** True when one textures-step report row has the expected shape. */
export function isTextureImageReport(value: unknown): value is TextureImageReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  for (const key of ["image", "index"] as const) {
    const v = rec[key];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) return false;
  }
  for (const key of ["name", "format", "effective_format"] as const) {
    const v = rec[key];
    if (v !== undefined && v !== null && typeof v !== "string") return false;
  }
  if (rec.skipped !== undefined && typeof rec.skipped !== "boolean") return false;
  return true;
}

/** Validates a textures-step `images` array (throws on a wrong shape). */
export function assertTextureImageReports(value: unknown): TextureImageReport[] {
  if (!Array.isArray(value)) throw new Error(`images: expected array, got ${kindOf(value)}`);
  for (let i = 0; i < value.length; i++) {
    if (!isTextureImageReport(value[i])) {
      throw new Error(`images[${i}]: expected TextureImageReport, got ${kindOf(value[i])}`);
    }
  }
  return value as TextureImageReport[];
}
