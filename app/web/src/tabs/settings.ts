import { app } from "../app";
import { buildOptimizeForm } from "../optimizeForm";
import {
  applySettingsText,
  getSettings,
  onSettingsChange,
  onSettingsStatus,
  reloadSettings,
  saveSettings,
  settingsToJson,
  setTheme,
  themeMode,
  updateSettings,
} from "../settings";
import type { SettingsStatus, ThemeMode } from "../settings";
import { clear, el, section } from "../ui";
import type { TabHandle } from "./types";

/**
 * Settings tab: a UI-first editor for `assetty.settings.json`.
 *
 * - theme (dark/light) and the optimize step defaults apply in-app on every
 *   change and are debounce-saved (500 ms) through `settingsSave(text)`;
 * - the JSON textarea is the escape hatch: "Apply JSON" parses the whole file,
 *   clamps numbers to their UI ranges and reports errors inline;
 * - "Reload from file" re-reads `settingsLoad()` and replaces the live state.
 *
 * The schema itself is documented at the top of `src/settings.ts`.
 */

const THEME_LABELS: Array<[ThemeMode, string]> = [
  ["dark", "dark"],
  ["light", "light"],
];

const SCHEMA_SAMPLE = `{
  "theme": "dark",
  "optimize": {
    "steps": {
      "prune":    { "enabled": true, "unused_nodes": true,
                    "unused_materials": true, "unused_textures": true },
      "dedup":    { "enabled": true, "accessors": true,
                    "meshes": true, "materials": true },
      "weld":     { "enabled": true, "tolerance": 0 },
      "join":     { "enabled": true },
      "textures": { "enabled": true, "format": "auto",
                    "quality": 128, "max_size": 0, "generate_mips": true },
      "quantize": { "enabled": true, "position_bits": 14,
                    "uv_bits": 12, "normal_oct": true },
      "simplify": { "enabled": false, "target_ratio": 0.5,
                    "error_tolerance": 0.001, "aggressive": false,
                    "lock_borders": true, "use_attributes": false,
                    "weight_normal": 1, "weight_uv": 1 }
    },
    "per_model": {
      "<sourcePath>": { "textures": { "overrides": [
        { "image": 2, "format": "uastc", "quality": 200,
          "max_size": 512, "generate_mips": true },
        { "image": 5, "skip": true }
      ] } }
    }
  }
}
`;

function statusText(status: SettingsStatus): string {
  switch (status.state) {
    case "loading":
      return "loading assetty.settings.json…";
    case "saving":
      return "saving…";
    case "saved":
      return status.message ?? "saved";
    case "error":
      return `error: ${status.message ?? "save failed"}`;
    default:
      return "";
  }
}

export function mountSettings(): TabHandle {
  const root = el("div", { class: "tab-body wide-side" });
  const main = el("div", { class: "tab-main" });
  const scroll = el("div", { class: "settings-scroll" });

  const head = el(
    "div",
    { class: "panel-head" },
    el("span", { text: "Settings" }),
    el("span", { class: "muted mono", text: "assetty.settings.json" }),
  );
  const info = el(
    "div",
    { class: "hint settings-info" },
    el("span", {
      text: "Persisted to assetty.settings.json in the working directory (demo mode: localStorage). Every change applies immediately and saves after 500 ms. Schema: ",
    }),
    el("span", {
      class: "mono",
      text: "{ theme, optimize: { steps: { prune, dedup, weld, join, textures, quantize, simplify }, per_model: { <sourcePath>: { textures: { overrides } } } } }",
    }),
  );

  /* ---------------------------------------------------------------- theme */

  const themeRow = el("div", { class: "segmented" });
  const themeButtons: Array<{ mode: ThemeMode; button: HTMLButtonElement }> = [];
  for (const [mode, label] of THEME_LABELS) {
    const button = el("button", { class: "small", text: label, onclick: () => setTheme(mode) });
    themeButtons.push({ mode, button });
    themeRow.append(button);
  }
  function syncTheme(): void {
    const active = themeMode();
    for (const entry of themeButtons)
      entry.button.classList.toggle("active", entry.mode === active);
  }

  /* ---------------------------------------------------- optimize defaults */

  const defaultsBody = el("div", { class: "form" });
  const defaultsForm = buildOptimizeForm(defaultsBody, {
    get: () => getSettings().optimize.steps,
    edit: (mutate) =>
      updateSettings((settings) => {
        mutate(settings.optimize.steps);
      }),
  });

  /* ----------------------------------------------------------- JSON editor */

  const json = el("textarea", {
    class: "settings-json",
    spellcheck: false,
    title: "edit the whole settings file by hand",
  });
  json.value = settingsToJson();
  const jsonError = el("div", { class: "settings-error" });
  const applyBtn = el("button", { class: "primary", text: "Apply JSON", disabled: true });
  const saveBtn = el("button", { text: "Save now" });
  const reloadBtn = el("button", { text: "Reload from file" });
  const statusLine = el("span", { class: "hint muted", text: "" });

  let dirty = false;

  const markDirty = (): void => {
    dirty = true;
    applyBtn.disabled = false;
    jsonError.textContent = "";
  };
  json.addEventListener("input", markDirty);

  const resetEditor = (): void => {
    json.value = settingsToJson();
    dirty = false;
    applyBtn.disabled = true;
    jsonError.textContent = "";
  };

  applyBtn.addEventListener("click", () => {
    try {
      const next = applySettingsText(json.value);
      json.value = settingsToJson(next);
      dirty = false;
      applyBtn.disabled = true;
      jsonError.textContent = "";
      defaultsForm.sync();
    } catch (err) {
      jsonError.textContent = (err as Error).message;
    }
  });

  saveBtn.addEventListener("click", async () => {
    const ok = await saveSettings();
    statusLine.textContent = ok ? "saved" : "save failed (see error above)";
  });

  reloadBtn.addEventListener("click", async () => {
    const ok = await reloadSettings();
    if (ok) defaultsForm.sync();
    resetEditor();
  });

  scroll.append(
    section(
      "Theme",
      themeRow,
      el("div", {
        class: "hint",
        text: "The UI switches CSS custom properties immediately; the Babylon inspector opens with the matching theme.",
      }),
    ),
    section(
      "Optimize defaults",
      el("div", {
        class: "hint",
        text: "Used to prefill the Optimize tab. Only checked steps are sent, and every edit is saved after 500 ms.",
      }),
      defaultsBody,
    ),
    section(
      "Settings JSON",
      el("div", {
        class: "hint",
        text: "Edit the whole file by hand. Apply parses the text, clamps numbers to their UI ranges and reports errors inline.",
      }),
      json,
      jsonError,
      el(
        "div",
        { class: "row spread" },
        el("div", { class: "row" }, applyBtn, saveBtn, reloadBtn),
        statusLine,
      ),
    ),
  );

  main.append(head, info, scroll);

  /* ------------------------------------------------------- presets (zon) */

  const side = el("div", { class: "tab-side" });
  const listHost = el("div", { class: "panel-body" });
  const presetZon = el("textarea", {
    spellcheck: false,
    style: { minHeight: "140px" },
  });
  presetZon.value = "// select a preset below";
  presetZon.disabled = true;
  const presetSaveBtn = el("button", { class: "small", text: "Save preset", disabled: true });
  const presetReloadBtn = el("button", { class: "small", text: "Reload preset", disabled: true });
  const presetStatus = el("span", { class: "hint muted", text: "" });

  side.append(
    section(
      "Presets",
      listHost,
      presetZon,
      el("div", { class: "row" }, presetSaveBtn, presetReloadBtn, presetStatus),
    ),
    section(
      "Schema",
      el("div", {
        class: "hint",
        text: "assetty.settings.json — frontend-owned, host validates + writes atomically.",
      }),
      el("pre", { class: "mono settings-schema", text: SCHEMA_SAMPLE }),
    ),
  );

  root.append(main, side);

  let names: string[] = [];
  let active: string | null = null;
  let presetBusy = false;

  function setPresetStatus(text: string, warn = false): void {
    presetStatus.textContent = text;
    presetStatus.className = warn ? "hint settings-bad" : "hint muted";
  }

  function renderList(): void {
    clear(listHost);
    if (names.length === 0) {
      listHost.append(el("div", { class: "muted", text: "no presets found" }));
    }
    for (const name of names) {
      listHost.append(
        el(
          "div",
          {
            class: `item ${name === active ? "selected" : ""}`,
            style: {
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 6px",
              borderRadius: "4px",
              cursor: "pointer",
              fontFamily: "var(--mono)",
              fontSize: "12px",
            },
            onclick: () => void selectPreset(name),
          },
          el("span", { class: "kind", text: "preset" }),
          el("span", { text: name }),
        ),
      );
    }
  }

  async function loadNames(): Promise<void> {
    try {
      names = await app.bridge.presets();
    } catch (err) {
      app.toast(`presets failed: ${(err as Error).message}`, "error");
      names = [];
    }
    renderList();
  }

  async function selectPreset(name: string): Promise<void> {
    active = name;
    renderList();
    presetZon.disabled = true;
    presetZon.value = "// loading…";
    try {
      presetZon.value = await app.bridge.presetLoad(name);
    } catch (err) {
      presetZon.value = `// load failed: ${(err as Error).message}`;
    } finally {
      presetZon.disabled = false;
      presetSaveBtn.disabled = !app.bridge.live || presetBusy;
      presetReloadBtn.disabled = !app.bridge.live || presetBusy;
    }
  }

  presetSaveBtn.addEventListener("click", async () => {
    if (!active || presetBusy) return;
    presetBusy = true;
    presetSaveBtn.disabled = true;
    try {
      await app.bridge.presetSave(active, presetZon.value);
      setPresetStatus(`saved ${active}.zon`);
    } catch (err) {
      setPresetStatus(`save failed: ${(err as Error).message}`, true);
    } finally {
      presetBusy = false;
      presetSaveBtn.disabled = !app.bridge.live;
    }
  });

  presetReloadBtn.addEventListener("click", () => {
    if (active) void selectPreset(active);
  });

  /* -------------------------------------------------------------- wiring */

  const offChange = onSettingsChange(() => {
    syncTheme();
    // Keep the textarea in sync unless the user is editing it right now.
    if (!dirty && document.activeElement !== json) json.value = settingsToJson();
  });
  const offStatus = onSettingsStatus((status) => {
    statusLine.textContent = statusText(status);
    statusLine.className = status.state === "error" ? "hint settings-bad" : "hint muted";
  });

  syncTheme();

  return {
    el: root,
    activate: () => {
      syncTheme();
      defaultsForm.sync();
      if (!dirty) json.value = settingsToJson();
      if (names.length === 0) void loadNames();
    },
    dispose: () => {
      offChange();
      offStatus();
    },
  };
}
