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

const {
  errMessage,
  isBusyError,
  isCancelledError,
  assertRecord,
  assertInfo,
  assertAppInfo,
  assertUpdateCheck,
  assertUpdateApply,
  assertTextureImageReports,
  assertTextureRules,
  isTextureImageReport,
  isTextureRule,
} = await import("./guards");

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

describe("host-shape guards", () => {
  const throws = (fn: () => unknown): boolean => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  const info = {
    file: "a.glb",
    counts: {},
    geometry: {},
    disk: {},
    vram: { images: [] },
    garbage: {},
  };

  test("assertRecord accepts plain objects only", () => {
    expect(assertRecord({ a: 1 })).toEqual({ a: 1 });
    expect(throws(() => assertRecord(null))).toBe(true);
    expect(throws(() => assertRecord([1]))).toBe(true);
    expect(throws(() => assertRecord("x"))).toBe(true);
  });

  test("assertInfo passes demo-shaped payloads, rejects wrong shapes", () => {
    expect(assertInfo(info)).toBe(info);
    expect(throws(() => assertInfo(null))).toBe(true);
    expect(throws(() => assertInfo({ ...info, file: 42 }))).toBe(true);
    expect(throws(() => assertInfo({ ...info, vram: { images: "nope" } }))).toBe(true);
  });

  test("assertAppInfo validates the identity payload", () => {
    const ok = { version: "1", repo: "r", platform: "p", arch: "a", asset: "b" };
    expect(assertAppInfo(ok)).toBe(ok);
    expect(throws(() => assertAppInfo({ ...ok, version: 1 }))).toBe(true);
    expect(throws(() => assertAppInfo(null))).toBe(true);
  });

  test("assertUpdateCheck validates the feed payload", () => {
    const ok = {
      available: true,
      current: "1",
      version: "2",
      asset: "a",
      download_url: "u",
      notes_url: "n",
    };
    expect(assertUpdateCheck(ok)).toBe(ok);
    expect(throws(() => assertUpdateCheck({ ...ok, available: "yes" }))).toBe(true);
    expect(throws(() => assertUpdateCheck({ ...ok, version: 2 }))).toBe(true);
  });

  test("assertUpdateApply validates the install payload", () => {
    const ok = { installed: true, version: "2", restarted: true };
    expect(assertUpdateApply(ok)).toBe(ok);
    expect(throws(() => assertUpdateApply({ ...ok, installed: 1 }))).toBe(true);
    expect(throws(() => assertUpdateApply("ok"))).toBe(true);
  });

  test("texture image reports: elements validated, non-arrays rejected", () => {
    expect(isTextureImageReport({ index: 0, skipped: true })).toBe(true);
    expect(isTextureImageReport({ image: 1, format: "ktx2" })).toBe(true);
    expect(isTextureImageReport({ index: "0" })).toBe(false);
    expect(isTextureImageReport(null)).toBe(false);
    const rows = [{ index: 0 }, { name: "n", skipped: false }];
    expect(assertTextureImageReports(rows)).toBe(rows);
    expect(assertTextureImageReports([])).toEqual([]);
    expect(throws(() => assertTextureImageReports("nope"))).toBe(true);
    expect(throws(() => assertTextureImageReports([{ index: "0" }]))).toBe(true);
  });

  test("texture rules: elements validated, non-arrays rejected", () => {
    expect(isTextureRule({ slot: "normal", quality: 128, skip: true })).toBe(true);
    expect(isTextureRule({ quality: "high" })).toBe(false);
    expect(isTextureRule(null)).toBe(false);
    const rules = [{ slot: "normal" }, { name: "base", skip: true }];
    expect(assertTextureRules(rules)).toBe(rules);
    expect(throws(() => assertTextureRules({}))).toBe(true);
    expect(throws(() => assertTextureRules([{ slot: 42 }]))).toBe(true);
  });
});
