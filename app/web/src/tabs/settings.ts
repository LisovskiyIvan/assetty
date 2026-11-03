import { app } from "../app";
import { buildOptimizeForm, closeFieldHelp } from "../optimizeForm";
import { onLang, t } from "../i18n";
import {
  applySettingsText,
  getSettings,
  languageMode,
  onSettingsChange,
  onSettingsStatus,
  reloadSettings,
  saveSettings,
  setLanguage,
  settingsToJson,
  setTheme,
  themeMode,
  updateSettings,
} from "../settings";
import type { Language, SettingsStatus, ThemeMode } from "../settings";
import { clear, el } from "../ui";
import type { TabHandle } from "./types";

/**
 * Settings tab: a UI-first editor for `assetty.settings.json`.
 *
 * - theme / language and the optimize step defaults apply in-app on every
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

const LANG_LABELS: Array<[Language, string]> = [
  ["en", "EN"],
  ["ru", "RU"],
];

function schemaSample(): string {
  return `{
  "theme": "dark",
  "language": "en",
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
}

function statusText(status: SettingsStatus): string {
  switch (status.state) {
    case "loading":
      return t("set.stLoading");
    case "saving":
      return t("set.stSaving");
    case "saved":
      if (status.message === "reloaded from file") return t("set.stReloaded");
      if (status.message === "up-to-date") return t("set.stUpToDate");
      return t("set.stSaved");
    case "error":
      return t("set.stError", { message: status.message ?? t("set.stSaveFail") });
    default:
      return "";
  }
}

export function mountSettings(): TabHandle {
  const root = el("div", { class: "tab-body wide-side" });
  const main = el("div", { class: "tab-main" });
  const scroll = el("div", { class: "settings-scroll" });

  const headLabel = el("span", { text: t("set.title") });
  const headFile = el("span", { class: "muted mono", text: t("set.file") });
  const head = el("div", { class: "panel-head" }, headLabel, headFile);
  const infoText = el("span", { text: t("set.info") });
  const infoSchema = el("span", {
    class: "mono",
    text: "{ theme, language, optimize: { steps: { prune, dedup, weld, join, textures, quantize, simplify }, per_model: { <sourcePath>: { textures: { overrides } } } } }",
  });
  const info = el("div", { class: "hint settings-info" }, infoText, infoSchema);

  /* ---------------------------------------------------------------- theme */

  const themeHead = el("span");
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

  /* --------------------------------------------------------------- language */

  const langHead = el("span");
  const langRow = el("div", { class: "segmented" });
  const langButtons: Array<{ lang: Language; button: HTMLButtonElement }> = [];
  for (const [lang, label] of LANG_LABELS) {
    const button = el("button", { class: "small", text: label, onclick: () => setLanguage(lang) });
    langButtons.push({ lang, button });
    langRow.append(button);
  }
  const langHint = el("div", { class: "hint" });
  function syncLangButtons(): void {
    const active = languageMode();
    for (const entry of langButtons) entry.button.classList.toggle("active", entry.lang === active);
  }

  /* ---------------------------------------------------- optimize defaults */

  const defaultsHead = el("span");
  const defaultsHint = el("div", { class: "hint" });
  const defaultsBody = el("div", { class: "form" });
  let defaultsForm = buildOptimizeForm(defaultsBody, {
    get: () => getSettings().optimize.steps,
    edit: (mutate) =>
      updateSettings((settings) => {
        mutate(settings.optimize.steps);
      }),
  });
  function buildDefaultsForm(): void {
    clear(defaultsBody);
    defaultsForm = buildOptimizeForm(defaultsBody, {
      get: () => getSettings().optimize.steps,
      edit: (mutate) =>
        updateSettings((settings) => {
          mutate(settings.optimize.steps);
        }),
    });
  }

  /* ----------------------------------------------------------- JSON editor */

  const jsonHead = el("span");
  const jsonHint = el("div", { class: "hint" });
  const json = el("textarea", {
    class: "settings-json",
    spellcheck: false,
    title: t("set.jsonTitle"),
  });
  json.value = settingsToJson();
  const jsonError = el("div", { class: "settings-error" });
  const applyBtn = el("button", { class: "primary", disabled: true });
  const saveBtn = el("button");
  const reloadBtn = el("button");
  const statusLine = el("span", { class: "hint muted", text: "" });

  /** Last persisted status (re-rendered on language switch). */
  let lastStatus: SettingsStatus = { state: "idle" };
  /** Last explicit save outcome (null = untouched since mount). */
  let saveOk: boolean | null = null;

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
    saveOk = ok;
    statusLine.textContent = ok ? t("set.savedNow") : t("set.saveFail");
  });

  reloadBtn.addEventListener("click", async () => {
    const ok = await reloadSettings();
    if (ok) {
      defaultsForm.sync();
      syncLangButtons();
    }
    resetEditor();
  });

  const themeHint = el("div", { class: "hint" });
  const themePanel = el(
    "div",
    { class: "panel" },
    el("div", { class: "panel-head" }, themeHead),
    el("div", { class: "panel-body" }, themeRow, themeHint),
  );
  const langPanel = el(
    "div",
    { class: "panel" },
    el("div", { class: "panel-head" }, langHead),
    el("div", { class: "panel-body" }, langRow, langHint),
  );
  const defaultsPanel = el(
    "div",
    { class: "panel" },
    el("div", { class: "panel-head" }, defaultsHead),
    el("div", { class: "panel-body" }, defaultsHint, defaultsBody),
  );
  const jsonPanel = el(
    "div",
    { class: "panel" },
    el("div", { class: "panel-head" }, jsonHead),
    el(
      "div",
      { class: "panel-body" },
      jsonHint,
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
  scroll.append(themePanel, langPanel, defaultsPanel, jsonPanel);

  main.append(head, info, scroll);

  /* ------------------------------------------------------- presets (zon) */

  const presetsHead = el("span");
  const side = el("div", { class: "tab-side" });
  const listHost = el("div", { class: "panel-body" });
  const presetZon = el("textarea", {
    spellcheck: false,
    style: { minHeight: "140px" },
  });
  presetZon.value = t("set.presetPick");
  presetZon.disabled = true;
  const presetSaveBtn = el("button", { class: "small", disabled: true });
  const presetReloadBtn = el("button", { class: "small", disabled: true });
  const presetStatus = el("span", { class: "hint muted", text: "" });

  const schemaHead = el("span");
  const schemaHint = el("div", { class: "hint" });
  const schemaPre = el("pre", { class: "mono settings-schema", text: schemaSample() });

  const presetsPanel = el(
    "div",
    { class: "panel" },
    el("div", { class: "panel-head" }, presetsHead),
    listHost,
    presetZon,
    el("div", { class: "row" }, presetSaveBtn, presetReloadBtn, presetStatus),
  );
  const schemaPanel = el(
    "div",
    { class: "panel" },
    el("div", { class: "panel-head" }, schemaHead),
    el("div", { class: "panel-body" }, schemaHint, schemaPre),
  );
  side.append(presetsPanel, schemaPanel);

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
      listHost.append(el("div", { class: "muted", text: t("set.noPresets") }));
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
      app.toast(t("set.presetsFail", { message: (err as Error).message }), "error");
      names = [];
    }
    renderList();
  }

  async function selectPreset(name: string): Promise<void> {
    active = name;
    renderList();
    presetZon.disabled = true;
    presetZon.value = t("set.presetLoading");
    try {
      presetZon.value = await app.bridge.presetLoad(name);
    } catch (err) {
      presetZon.value = t("set.presetLoadFail", { message: (err as Error).message });
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
      setPresetStatus(t("set.presetSaved", { name: active }));
    } catch (err) {
      setPresetStatus(t("set.presetSaveFail", { message: (err as Error).message }), true);
    } finally {
      presetBusy = false;
      presetSaveBtn.disabled = !app.bridge.live;
    }
  });

  presetReloadBtn.addEventListener("click", () => {
    if (active) void selectPreset(active);
  });

  /* -------------------------------------------------------------- wiring */

  /** Applies the active dictionary to every static label in this tab. */
  function syncStrings(): void {
    headLabel.textContent = t("set.title");
    headFile.textContent = t("set.file");
    infoText.textContent = t("set.info");
    themeHead.textContent = t("set.theme");
    themeHint.textContent = t("set.themeHint");
    langHead.textContent = t("set.language");
    langHint.textContent = t("set.languageHint");
    defaultsHead.textContent = t("set.defaults");
    defaultsHint.textContent = t("set.defaultsHint");
    jsonHead.textContent = t("set.jsonTitle");
    jsonHint.textContent = t("set.jsonHint");
    json.title = t("set.jsonTitle");
    applyBtn.textContent = t("set.applyJson");
    saveBtn.textContent = t("set.saveNow");
    reloadBtn.textContent = t("set.reloadFile");
    presetsHead.textContent = t("set.presets");
    schemaHead.textContent = t("set.schema");
    schemaHint.textContent = t("set.schemaHint");
    presetSaveBtn.textContent = t("set.savePreset");
    presetReloadBtn.textContent = t("set.reloadPreset");
    if (presetZon.disabled && presetZon.value.startsWith("//")) {
      presetZon.value = active ? t("set.presetLoading") : t("set.presetPick");
    }
    statusLine.textContent =
      saveOk === null ? statusText(lastStatus) : saveOk ? t("set.savedNow") : t("set.saveFail");
    statusLine.className = lastStatus.state === "error" ? "hint settings-bad" : "hint muted";
    renderList();
  }

  const offChange = onSettingsChange(() => {
    syncTheme();
    syncLangButtons();
    // Keep the textarea in sync unless the user is editing it right now.
    if (!dirty && document.activeElement !== json) json.value = settingsToJson();
  });
  const offStatus = onSettingsStatus((status) => {
    lastStatus = status;
    saveOk = null;
    statusLine.textContent = statusText(status);
    statusLine.className = status.state === "error" ? "hint settings-bad" : "hint muted";
  });
  // Instant language switch: rebuild the shared step form, then re-render.
  const offLang = onLang(() => {
    buildDefaultsForm();
    syncStrings();
    syncTheme();
    syncLangButtons();
    if (!dirty) json.value = settingsToJson();
    if (names.length === 0) void loadNames();
  });

  syncStrings();
  syncTheme();
  syncLangButtons();

  return {
    el: root,
    activate: () => {
      syncStrings();
      syncTheme();
      syncLangButtons();
      defaultsForm.sync();
      if (!dirty) json.value = settingsToJson();
      if (names.length === 0) void loadNames();
    },
    deactivate: () => {
      closeFieldHelp();
    },
    dispose: () => {
      offChange();
      offStatus();
      offLang();
    },
  };
}
