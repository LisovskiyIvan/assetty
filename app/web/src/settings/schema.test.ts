/**
 * Unit tests for the settings schema merge (settings/schema.ts).
 * Pure normalization — no DOM, no I/O. Run with `bun test src`.
 */
import { describe, expect, test } from "bun:test";
import { defaultSettings, mergeSettings, parseSettingsText, SettingsError } from "./schema";

describe("mergeSettings defaults", () => {
  test("undefined/null/non-object yield defaults", () => {
    expect(mergeSettings(undefined)).toEqual(defaultSettings());
    expect(mergeSettings(null)).toEqual(defaultSettings());
    expect(mergeSettings("nope")).toEqual(defaultSettings());
    expect(mergeSettings(42)).toEqual(defaultSettings());
  });

  test("strict mode rejects non-objects", () => {
    let threw = false;
    try {
      mergeSettings("nope", true);
    } catch (e) {
      threw = e instanceof SettingsError;
    }
    expect(threw).toBe(true);
  });
});

describe("mergeSettings coercion", () => {
  test("known keys apply, unknown keys are dropped", () => {
    const out = mergeSettings({ theme: "light", bogus: 1 });
    expect(out.theme).toBe("light");
    expect("bogus" in out).toBe(false);
  });

  test("wrong types fall back to defaults", () => {
    const out = mergeSettings({ theme: 42, language: "xx" });
    expect(out.theme).toBe("dark");
    expect(out.language).toBe("en");
  });

  test("numbers clamp to range", () => {
    const high = mergeSettings({ optimize: { steps: { textures: { quality: 999 } } } });
    expect(high.optimize.steps.textures.quality).toBe(255);
    const low = mergeSettings({ optimize: { steps: { textures: { quality: "high" } } } });
    expect(low.optimize.steps.textures.quality).toBe(128);
    const neg = mergeSettings({ optimize: { steps: { textures: { max_size: -5 } } } });
    expect(neg.optimize.steps.textures.max_size).toBe(0);
  });

  test("strict mode throws on wrong types", () => {
    let threw = false;
    try {
      mergeSettings({ theme: "neon" }, true);
    } catch (e) {
      threw = e instanceof SettingsError;
    }
    expect(threw).toBe(true);
  });

  test("per_model entries are preserved and sanitized", () => {
    const out = mergeSettings({
      optimize: {
        per_model: {
          "a.glb": { textures: { overrides: [{ format: "etc1s" }, "junk"] } },
          "": { textures: { overrides: [] } },
        },
      },
    });
    expect(out.optimize.per_model["a.glb"]).toEqual({
      textures: { overrides: [{ format: "etc1s" }] },
    });
    expect("''" in out.optimize.per_model).toBe(false);
    expect("" in out.optimize.per_model).toBe(false);
  });
});

describe("recent_dirs", () => {
  test("absolute only, deduped, most-recent-first, capped at 8", () => {
    const dirs = [
      "/b",
      "relative",
      "/a",
      "/b",
      "  ",
      "/c",
      "/d",
      "/e",
      "/f",
      "/g",
      "/h",
      "/i",
      "/j",
    ];
    const out = mergeSettings({ recent_dirs: dirs });
    expect(out.recent_dirs).toEqual(["/b", "/a", "/c", "/d", "/e", "/f", "/g", "/h"]);
  });

  test("non-array recent_dirs coerces to []", () => {
    expect(mergeSettings({ recent_dirs: "x" }).recent_dirs).toEqual([]);
  });
});

describe("parseSettingsText", () => {
  test("blank text yields defaults", () => {
    expect(parseSettingsText("  ")).toEqual(defaultSettings());
  });

  test("invalid JSON throws SettingsError", () => {
    let threw = false;
    try {
      parseSettingsText("{oops");
    } catch (e) {
      threw = e instanceof SettingsError;
    }
    expect(threw).toBe(true);
  });

  test("valid JSON merges strictly", () => {
    const out = parseSettingsText('{"theme":"light"}');
    expect(out.theme).toBe("light");
    let threw = false;
    try {
      parseSettingsText('{"theme":"neon"}');
    } catch (e) {
      threw = e instanceof SettingsError;
    }
    expect(threw).toBe(true);
  });
});
