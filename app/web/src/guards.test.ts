/**
 * Unit tests for the shared job guards (guards.ts): errMessage plus the
 * busy/cancel matchers. guards.ts pulls in app.ts → bridge → findNative(),
 * which reads `window`, so a minimal stub is installed before the import is
 * evaluated (dynamic import — static imports hoist). No other DOM needed:
 * only the pure matchers are exercised here. Run with `bun test src`.
 */
import { describe, expect, test } from "bun:test";

const g = globalThis as unknown as { window?: unknown };
if (typeof g.window === "undefined") {
  g.window = { addEventListener: () => {}, removeEventListener: () => {} };
}

const { errMessage, isBusyError, isCancelledError } = await import("./guards");

describe("errMessage", () => {
  test("Error instances yield their message", () => {
    expect(errMessage(new Error("boom"))).toBe("boom");
  });

  test("strings pass through", () => {
    expect(errMessage("plain failure")).toBe("plain failure");
  });

  test("null/undefined become unknown error", () => {
    expect(errMessage(null)).toBe("unknown error");
    expect(errMessage(undefined)).toBe("unknown error");
  });

  test("other values stringify", () => {
    expect(errMessage(42)).toBe("42");
    expect(errMessage({ code: 7 })).toBe("[object Object]");
  });
});

describe("isBusyError", () => {
  test("matches busy phrasing", () => {
    expect(isBusyError(new Error("backend busy"))).toBe(true);
    expect(isBusyError("already running")).toBe(true);
    expect(isBusyError("job in progress")).toBe(true);
    expect(isBusyError('{"error":"busy"}')).toBe(true);
  });

  test("rejects other failures", () => {
    expect(isBusyError(new Error("optimize failed"))).toBe(false);
    expect(isBusyError("Cancelled")).toBe(false);
    expect(isBusyError("")).toBe(false);
    expect(isBusyError(null)).toBe(false);
    expect(isBusyError(undefined)).toBe(false);
  });
});

describe("isCancelledError", () => {
  test("matches cancellation, rejects the rest", () => {
    expect(isCancelledError("Cancelled")).toBe(true);
    expect(isCancelledError(new Error("Cancelled"))).toBe(true);
    expect(isCancelledError("ok: false, error: cancelled by user")).toBe(true);
    expect(isCancelledError("optimize failed: out of memory")).toBe(false);
    expect(isCancelledError("optimize already running")).toBe(false);
    expect(isCancelledError("")).toBe(false);
    expect(isCancelledError(null)).toBe(false);
    expect(isCancelledError(undefined)).toBe(false);
  });
});
