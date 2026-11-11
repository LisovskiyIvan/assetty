/**
 * Unit tests for the backend event normalizers (bridge/events.ts).
 * Pure functions only — no DOM, no host. Run with `bun test src`.
 */
import { describe, expect, test } from "bun:test";
import {
  asNumber,
  asRecord,
  cleanEncodeArgs,
  isRecord,
  isStartedAck,
  normalizeEncodeDone,
  normalizeEncodeResult,
  normalizeExportDone,
  normalizeImages,
  normalizeLodsDone,
  normalizeOptimize,
  normalizeOptimizeDone,
  normalizePreviewDone,
  parseMaybeJson,
  watchProgress,
} from "./events";
import type { ProgressEvent } from "./types";

describe("parseMaybeJson", () => {
  test("parses JSON strings", () => {
    expect(parseMaybeJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseMaybeJson("[1,2]")).toEqual([1, 2]);
    expect(parseMaybeJson("42")).toBe(42);
  });

  test("blank strings become undefined", () => {
    expect(parseMaybeJson("")).toBe(undefined);
    expect(parseMaybeJson("   ")).toBe(undefined);
  });

  test("invalid JSON passes the trimmed string through", () => {
    expect(parseMaybeJson("  not json  ")).toBe("not json");
  });

  test("non-strings pass through untouched", () => {
    const obj = { a: 1 };
    expect(parseMaybeJson(obj)).toBe(obj);
    expect(parseMaybeJson(7)).toBe(7);
    expect(parseMaybeJson(null)).toBe(null);
    expect(parseMaybeJson(undefined)).toBe(undefined);
  });
});

describe("isRecord / asRecord", () => {
  test("isRecord accepts plain objects only", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(isRecord(42)).toBe(false);
  });

  test("asRecord returns {} for non-records", () => {
    const rec = { a: 1 };
    expect(asRecord(rec)).toBe(rec);
    expect(asRecord([1])).toEqual({});
    expect(asRecord(null)).toEqual({});
    expect(asRecord("s")).toEqual({});
  });
});

describe("asNumber", () => {
  test("keeps finite numbers, falls back otherwise", () => {
    expect(asNumber(3)).toBe(3);
    expect(asNumber(Number.NaN)).toBe(0);
    expect(asNumber(Infinity)).toBe(0);
    expect(asNumber("3")).toBe(0);
    expect(asNumber(undefined)).toBe(0);
    expect(asNumber(undefined, -1)).toBe(-1);
    expect(asNumber(null, 9)).toBe(9);
  });
});

describe("isStartedAck", () => {
  test("only { started: true } counts", () => {
    expect(isStartedAck({ started: true })).toBe(true);
    expect(isStartedAck({ started: 1 })).toBe(false);
    expect(isStartedAck({})).toBe(false);
    expect(isStartedAck([])).toBe(false);
    expect(isStartedAck(null)).toBe(false);
    expect(isStartedAck("started")).toBe(false);
  });
});

describe("normalizeOptimize", () => {
  test("garbage yields empty result with zero stats", () => {
    expect(normalizeOptimize(null)).toEqual({
      out_path: "",
      report: {
        preset: undefined,
        target: undefined,
        total_secs: undefined,
        steps: [],
        before: { triangles: 0, vertices: 0, draw_calls: 0, vram_total: 0, disk_total: 0 },
        after: { triangles: 0, vertices: 0, draw_calls: 0, vram_total: 0, disk_total: 0 },
        deltas: undefined,
      },
    });
  });

  test("flat contract with alias keys", () => {
    const out = normalizeOptimize({
      out_path: "/tmp/a.glb",
      report: {
        steps: [{ kind: "prune", applied: true, secs: 1.5 }],
        before: { triangles: 10, drawCalls: 2, vram_bytes: 8, disk_bytes: 9 },
        after: { triangles: 5, vertices: 6, draw_calls: 1, vram: 4, disk: 3 },
      },
    });
    expect(out.out_path).toBe("/tmp/a.glb");
    expect(out.report.steps.length).toBe(1);
    expect(out.report.steps[0]).toEqual({
      kind: "prune",
      applied: true,
      note: undefined,
      secs: 1.5,
      images: undefined,
    });
    expect(out.report.before.triangles).toBe(10);
    expect(out.report.before.draw_calls).toBe(2);
    expect(out.report.after.vertices).toBe(6);
  });

  test("throws on malformed step images instead of rendering wrong rows", () => {
    const bad = (images: unknown) => ({
      out_path: "a.glb",
      report: { steps: [{ kind: "textures", applied: true, images }] },
    });
    const throws = (images: unknown): boolean => {
      try {
        normalizeOptimize(bad(images));
        return false;
      } catch {
        return true;
      }
    };
    expect(throws("nope")).toBe(true);
    expect(throws([{ index: "0" }])).toBe(true);
    expect(normalizeOptimize(bad([{ index: 0, skipped: true }])).report.steps[0].images).toEqual([
      { index: 0, skipped: true },
    ]);
  });
});

describe("normalizeImages", () => {
  test("object, raw array, and garbage shapes", () => {
    const imgs = [{ index: 0 }];
    expect(normalizeImages({ images: imgs }).images).toBe(imgs);
    expect(normalizeImages(imgs).images).toBe(imgs);
    expect(normalizeImages(null)).toEqual({ images: [] });
    expect(normalizeImages({ images: "nope" })).toEqual({ images: [] });
  });
});

describe("done-event normalizers", () => {
  test("normalizeOptimizeDone: error, flat, and { ok, result } wrapper", () => {
    expect(normalizeOptimizeDone({ ok: false, error: "boom" })).toEqual({
      ok: false,
      error: "boom",
    });
    const flat = normalizeOptimizeDone({ ok: true, out_path: "a.glb" });
    expect(flat.ok).toBe(true);
    const wrapped = normalizeOptimizeDone({
      ok: true,
      result: { out_path: "b.glb", report: { steps: [] } },
    });
    expect(wrapped).toEqual({
      ok: true,
      result: {
        out_path: "b.glb",
        report: {
          preset: undefined,
          target: undefined,
          total_secs: undefined,
          steps: [],
          before: { triangles: 0, vertices: 0, draw_calls: 0, vram_total: 0, disk_total: 0 },
          after: { triangles: 0, vertices: 0, draw_calls: 0, vram_total: 0, disk_total: 0 },
          deltas: undefined,
        },
      },
    });
  });

  test("normalizeLodsDone: error, flat, and { ok, result } wrapper", () => {
    expect(normalizeLodsDone({ ok: false })).toEqual({ ok: false, error: "lods failed" });
    const flat = normalizeLodsDone({
      results: [{ ratio: 0.5, out_path: "a.glb", disk_bytes: 10, triangles: 4, secs: 2 }],
    });
    expect(flat).toEqual({
      ok: true,
      results: [{ ratio: 0.5, out_path: "a.glb", disk_bytes: 10, triangles: 4, secs: 2 }],
    });
    const wrapped = normalizeLodsDone({
      ok: true,
      result: { results: [{ ratio: 0.25, path: "b.glb" }] },
    });
    expect(wrapped.ok).toBe(true);
    if (wrapped.ok) {
      expect(wrapped.results[0].out_path).toBe("b.glb");
      expect(wrapped.results[0].ratio).toBe(0.25);
    }
    expect(normalizeLodsDone(null)).toEqual({ ok: true, results: [] });
  });

  test("normalizeExportDone: ok and error", () => {
    expect(normalizeExportDone({ ok: true, src: "a", dst: "b" })).toEqual({
      ok: true,
      src: "a",
      dst: "b",
    });
    expect(normalizeExportDone({ error: "x" })).toEqual({ ok: false, error: "x" });
  });

  test("normalizeEncodeDone: failure keeps index, success normalizes", () => {
    expect(normalizeEncodeDone({ ok: false, index: 2, error: "bad" })).toEqual({
      ok: false,
      index: 2,
      error: "bad",
    });
    const ok = normalizeEncodeDone({ ok: true, index: 1, ktx2_size: 100 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.result.ktx2_size).toBe(100);
    expect(normalizeEncodeDone({ index: 0, error: "e" }).ok).toBe(false);
  });

  test("normalizePreviewDone: failure, flat, and result wrapper", () => {
    expect(normalizePreviewDone({ ok: false, index: 3 })).toEqual({
      ok: false,
      index: 3,
      error: "preview failed",
    });
    const flat = normalizePreviewDone({ ok: true, index: 0, b64: "AA==", width: 4 });
    expect(flat).toEqual({
      ok: true,
      index: 0,
      result: { index: 0, b64: "AA==", width: 4, height: 0 },
    });
    const wrapped = normalizePreviewDone({
      ok: true,
      index: 1,
      result: { base64: "BB==", height: 8 },
    });
    expect(wrapped).toEqual({
      ok: true,
      index: 1,
      result: { index: 1, b64: "BB==", width: 0, height: 8 },
    });
  });
});

describe("normalizeEncodeResult", () => {
  test("aliases and settings normalization", () => {
    const out = normalizeEncodeResult({
      size: 50,
      vram: 60,
      beforePng: "/a.png",
      after_png: "/b.png",
      mipLevels: 3,
      format: "etc1s",
      settings: { format: "etc1s", quality: 90, maxSize: 512, mips: true },
    });
    expect(out.ktx2_size).toBe(50);
    expect(out.vram_after).toBe(60);
    expect(out.before_png).toBe("/a.png");
    expect(out.after_png).toBe("/b.png");
    expect(out.mip_levels).toBe(3);
    expect(out.format).toBe("etc1s");
    expect(out.settings).toEqual({
      format: "etc1s",
      quality: 90,
      max_size: 512,
      generate_mips: true,
      normal_map: undefined,
    });
    expect(normalizeEncodeResult("garbage").settings).toBe(undefined);
  });
});

describe("cleanEncodeArgs", () => {
  test("drops undefined keys, undefined when empty", () => {
    expect(cleanEncodeArgs(undefined)).toBe(undefined);
    expect(cleanEncodeArgs({})).toBe(undefined);
    expect(cleanEncodeArgs({ format: "uastc", quality: undefined })).toEqual({ format: "uastc" });
  });
});

describe("watchProgress", () => {
  test("forwards normalized progress incl. sub, noop without handler", () => {
    let captured!: (payload: unknown) => void;
    const events: ProgressEvent[] = [];
    const off = watchProgress(
      (_event, cb) => {
        captured = cb;
        return () => {};
      },
      (p) => events.push(p),
    );
    if (typeof captured !== "function") throw new Error("subscribe was never called");
    captured({ step: "compress", pct: 50, sub: { label: "tex", done: 1, total: 4 } });
    captured({ step: "done", progress: 100, sub: { done: 1, total: 0 } });
    off();
    expect(events.length).toBe(2);
    expect(events[0]).toEqual({
      step: "compress",
      pct: 50,
      sub: { label: "tex", done: 1, total: 4 },
    });
    expect(events[1]).toEqual({ step: "done", pct: 100, sub: { label: "", done: 1, total: 0 } });
    const noop = watchProgress(() => () => {});
    expect(noop()).toBe(undefined);
  });
});
