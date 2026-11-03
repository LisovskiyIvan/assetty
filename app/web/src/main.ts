import "./style.css";
import { app } from "./app";
import { checkKtx2Assets, configureKtx2, reportDecoderFailure } from "./ktx2";
import { logHistory, notify, onLog } from "./notify";
import { createInspectorDock } from "./inspector";
import { Logger } from "@babylonjs/core/Misc/logger";
import {
  applySettingsText,
  loadSettings,
  onSettingsChange,
  saveSettings,
  setLanguage,
  settingsToJson,
  themeMode,
  toggleTheme,
} from "./settings";
import { lang, onLang, setLang, t } from "./i18n";
import { clear, el, fmtBytes, fmtCompact, statChip } from "./ui";
import type { StatChip } from "./ui";
import { mountViewer } from "./tabs/viewer";
import { mountOptimize } from "./tabs/optimize";
import { mountTextures } from "./tabs/textures";
import { mountSettings } from "./tabs/settings";
import type { TabHandle } from "./tabs/types";

configureKtx2();
surfaceDecoderFailures();

/**
 * Babylon reports texture/environment decode failures through `Logger` only —
 * the material then renders with its factor colour and nothing tells the user.
 * Mirror those entries into the toast + status bar.
 */
function surfaceDecoderFailures(): void {
  const previous = Logger.OnNewCacheEntry;
  Logger.OnNewCacheEntry = (entry: string) => {
    previous?.(entry);
    if (
      !/failed to load ktx2|missing ktx identifier|failed to load texture|unable to load (?:image|texture|environment)|not found in the scene|error while trying to load/i.test(
        entry,
      )
    ) {
      return;
    }
    const text = entry
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    reportDecoderFailure(text.slice(0, 240));
  };
}

type TabId = "viewer" | "optimize" | "textures" | "settings";

const TAB_DEFS: Array<{ id: TabId; key: string; mount: () => TabHandle }> = [
  { id: "viewer", key: "topbar.viewer", mount: mountViewer },
  { id: "optimize", key: "topbar.optimize", mount: mountOptimize },
  { id: "textures", key: "topbar.textures", mount: mountTextures },
  { id: "settings", key: "topbar.settings", mount: mountSettings },
];

/* ---------------------------------------------------------------- shell DOM */

const tabBar = el("nav", { class: "tabs" });
const content = el("main", { class: "content" });
const banner = el("div", { class: "banner" });
const modePill = el("span", { class: "pill" });

const openBtn = el("button", {
  class: "primary",
  text: t("topbar.open"),
  title: t("topbar.openTitle"),
  onclick: () => void app.pickAndOpen(),
});

/** The inspector belongs to the Viewer scene: closed by default, it opens
 * only on a successful viewer model load (see the `assetty:viewer-loaded`
 * hook below) and hides whenever the user leaves the Viewer tab. Returning
 * to the Viewer tab never reopens it — only a fresh load does. */
const inspectorDock = createInspectorDock(() => syncInspectorChrome());

const inspectorBtn = el("button", {
  class: "small",
  text: t("topbar.inspector"),
  title: t("topbar.inspectorTitle"),
  onclick: () => void toggleInspector(),
});

const themeBtn = el("button", {
  class: "small theme-toggle",
  text: "☾",
  title: t("topbar.themeToLight"),
  onclick: () => toggleTheme(),
});

/** Segmented EN | RU switch, sitting next to the theme quick-toggle. */
const langEnBtn = el("button", {
  class: "small",
  text: "EN",
  title: "English",
  onclick: () => switchLanguage("en"),
});
const langRuBtn = el("button", {
  class: "small",
  text: "RU",
  title: "Русский",
  onclick: () => switchLanguage("ru"),
});
const langSwitch = el("div", { class: "segmented lang-switch" }, langEnBtn, langRuBtn);

function switchLanguage(next: "en" | "ru"): void {
  if (lang() === next) return;
  setLang(next);
  setLanguage(next);
}

function syncLangSwitch(): void {
  const active = lang();
  langEnBtn.classList.toggle("active", active === "en");
  langRuBtn.classList.toggle("active", active === "ru");
}

function syncThemeButton(): void {
  const light = themeMode() === "light";
  themeBtn.textContent = light ? "☀" : "☾";
  themeBtn.title = light ? t("topbar.themeToDark") : t("topbar.themeToLight");
  themeBtn.setAttribute("aria-label", themeBtn.title);
}

onSettingsChange(syncThemeButton);
onLang(() => {
  syncThemeButton();
  syncLangSwitch();
  openBtn.textContent = t("topbar.open");
  openBtn.title = t("topbar.openTitle");
  inspectorBtn.textContent = t("topbar.inspector");
  inspectorBtn.title = t("topbar.inspectorTitle");
  infoBtn.title = t("topbar.recent");
  popoverTitle.textContent = t("topbar.recent");
  popoverCount.textContent = t("topbar.last20");
  for (const btn of Array.from(tabBar.children)) {
    const def = TAB_DEFS.find((d) => d.id === (btn as HTMLElement).dataset.tab);
    if (def) btn.textContent = t(def.key);
  }
  renderBanner();
  renderLog();
});
syncThemeButton();
syncLangSwitch();

function syncInspectorChrome(): void {
  const open = inspectorDock.isOpen;
  inspectorBtn.classList.toggle("active", open);
  appRoot?.classList.toggle("inspector-open", open);
}

async function toggleInspector(): Promise<void> {
  const scene = app.viewer?.scene ?? null;
  if (!scene) {
    // Nothing rendered yet: point at the Viewer tab; the toggle below then
    // reports that a model is needed.
    selectTab("viewer");
  }
  await inspectorDock.toggle(app.viewer?.scene ?? null);
  syncInspectorChrome();
}

const status = {
  fps: statChip("FPS"),
  tris: statChip("TRIS"),
  draws: statChip("DRAWS"),
  meshes: statChip("MESH"),
  materials: statChip("MAT"),
  textures: statChip("TEX"),
  vram: statChip("VRAM"),
  disk: statChip("DISK"),
};

const statusMetrics = el(
  "div",
  { class: "status-metrics" },
  status.fps.el,
  status.tris.el,
  status.draws.el,
  status.meshes.el,
  status.materials.el,
  status.textures.el,
  status.vram.el,
  status.disk.el,
);

status.vram.el.dataset.chip = "vram";
status.disk.el.dataset.chip = "disk";

/* ------------------------------------------------ statusbar: log popover */

const logList = el("div", { class: "log-list" });
const popoverTitle = el("span", { text: t("topbar.recent") });
const popoverCount = el("span", { class: "muted mono", text: t("topbar.last20") });
const logPopover = el(
  "div",
  { class: "status-popover", title: t("topbar.recent") },
  el("div", { class: "popover-head" }, popoverTitle, popoverCount),
  logList,
);
logPopover.hidden = true;

function renderLog(): void {
  clear(logList);
  const entries = logHistory();
  if (entries.length === 0) {
    logList.append(el("div", { class: "empty", text: t("topbar.noMessages") }));
    return;
  }
  logList.append(
    ...entries
      .slice()
      .reverse()
      .map((entry) =>
        el(
          "div",
          { class: `log-entry ${entry.kind}` },
          el("span", {
            class: "ts mono",
            text: new Date(entry.at).toLocaleTimeString("en-GB", { hour12: false }),
          }),
          el("span", { class: "msg", text: entry.message }),
        ),
      ),
  );
}
renderLog();

const infoBtn = el("button", {
  class: "status-info",
  text: "ⓘ",
  title: t("topbar.recent"),
  onclick: (ev: Event) => {
    ev.stopPropagation();
    logPopover.hidden = !logPopover.hidden;
    if (!logPopover.hidden) renderLog();
  },
});

document.addEventListener("click", (ev) => {
  if (logPopover.hidden) return;
  const target = ev.target as Node | null;
  if (target && (logPopover.contains(target) || infoBtn.contains(target))) return;
  logPopover.hidden = true;
});

onLog((message, kind) => {
  infoBtn.classList.toggle("has-error", kind === "error");
  infoBtn.title =
    kind === "error" ? t("topbar.errorMsg", { message }) : t("topbar.lastMsg", { message });
  if (!logPopover.hidden) renderLog();
});

const appRoot = el("div", { id: "app" });
appRoot.append(
  el(
    "header",
    { class: "topbar" },
    el("span", { class: "brand", text: "assetty" }),
    tabBar,
    el("div", { class: "topbar-actions" }, modePill, langSwitch, themeBtn, inspectorBtn, openBtn),
  ),
  banner,
  content,
  inspectorDock.el,
  el(
    "footer",
    { class: "statusbar" },
    statusMetrics,
    el("span", { class: "status-spacer" }),
    infoBtn,
    logPopover,
  ),
);
document.body.append(appRoot);

/* ------------------------------------------------------------------ banner */

function renderBanner(): void {
  clear(banner);
  banner.classList.toggle("show", !app.bridge.live);
  if (!app.bridge.live) {
    banner.append(
      el("strong", { text: t("topbar.demoTitle") }),
      el("span", { text: t("topbar.demoBody1") }),
      el("code", { text: "assetty-app" }),
      el("span", { text: t("topbar.demoBody2") }),
      el("code", { text: "zig build run" }),
      el("span", { text: t("topbar.demoBody3") }),
    );
    modePill.classList.add("demo");
    modePill.textContent = t("topbar.demoPill");
  } else {
    modePill.textContent = app.bridge.source;
  }
}

renderBanner();

/* -------------------------------------------------------------------- tabs */

const handles = new Map<TabId, TabHandle>();
let activeTab: TabId | null = null;

function selectTab(id: TabId): void {
  if (activeTab === id) return;
  const def = TAB_DEFS.find((t) => t.id === id);
  if (!def) return;
  activeTab = id;
  for (const btn of Array.from(tabBar.children)) {
    btn.classList.toggle("active", (btn as HTMLElement).dataset.tab === id);
  }
  let handle = handles.get(id);
  if (!handle) {
    try {
      handle = def.mount();
      handles.set(id, handle);
      content.append(handle.el);
    } catch (err) {
      content.append(
        el("div", {
          class: "empty",
          text: t("topbar.mountFailed", { id, message: (err as Error).message }),
        }),
      );
      return;
    }
  }
  for (const [tid, other] of handles) {
    if (tid !== id) {
      other.el.style.display = "none";
      other.deactivate?.();
    }
  }
  handle.el.style.display = "";
  handle.activate();
  if (id !== "viewer" && inspectorDock.isOpen) {
    // The inspector belongs to the Viewer scene: leaving the tab hides it,
    // and coming back does not reopen it (only a fresh model load does).
    void inspectorDock.hide().then(() => syncInspectorChrome());
  }
}

for (const def of TAB_DEFS) {
  tabBar.append(
    el("button", {
      class: "tab",
      dataset: { tab: def.id },
      text: t(def.key),
      onclick: () => selectTab(def.id),
    }),
  );
}

// Cross-tab navigation (e.g. Optimize → "Edit in Textures tab").
window.addEventListener("assetty:select-tab", (ev) => {
  const id = (ev as CustomEvent).detail as TabId;
  if (TAB_DEFS.some((t) => t.id === id)) selectTab(id);
});

// The Viewer tab dispatches this after a model loads successfully (failed
// and demo loads don't). Only a fresh load opens the inspector.
window.addEventListener("assetty:viewer-loaded", () => {
  if (activeTab !== "viewer" || inspectorDock.isOpen) return;
  const scene = app.viewer?.scene ?? null;
  if (!scene) return;
  void inspectorDock.show(scene).then(() => syncInspectorChrome());
});

/* ---------------------------------------------------------------- status bar */

const updateStatusBar = (): void => {
  const set = (chip: StatChip, value: string): void => {
    if (chip.value.textContent !== value) chip.value.textContent = value;
  };
  const viewer = app.viewer;
  if (!viewer) {
    set(status.fps, "—");
    set(status.tris, "—");
    set(status.draws, "—");
    set(status.meshes, "—");
    set(status.materials, "—");
    set(status.textures, "—");
  } else {
    const s = viewer.getStats();
    set(status.fps, s.fps.toFixed(0));
    set(status.tris, fmtCompact(s.triangles));
    set(status.draws, fmtCompact(s.drawCalls));
    set(status.meshes, fmtCompact(s.meshes));
    set(status.materials, fmtCompact(s.materials));
    set(status.textures, fmtCompact(s.textures));
  }
  const info = app.info;
  set(status.vram, info ? fmtBytes(info.vram.total_est) : "—");
  set(status.disk, info ? fmtBytes(info.disk.total) : "—");
};

setInterval(updateStatusBar, 500);
updateStatusBar();

app.on("source", () => updateStatusBar());
app.on("view", () => updateStatusBar());
app.on("path", () => updateStatusBar());
app.on("context", () => updateStatusBar());

/* ------------------------------------------------------------------- boot */

// Apply the persisted theme + optimize defaults before the first tab mounts.
void loadSettings();

selectTab("viewer");

window.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "o") {
    ev.preventDefault();
    void app.pickAndOpen();
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "i") {
    ev.preventDefault();
    void toggleInspector();
  }
});

/* ------------------------------------------------------- diagnostics boot */

void checkKtx2Assets().then((missing) => {
  if (missing.length > 0) {
    notify(t("topbar.ktx2Missing", { list: missing.join(", ") }), "error", 9000);
  }
});

/** Debug hook: lets the host (and headless checks) inspect the live scene. */
(window as unknown as Record<string, unknown>)["__assetty"] = {
  app,
  toggleInspector,
  inspectorDock,
  scene: () => app.viewer?.scene ?? null,
  textures: () => app.viewer?.textureDiagnostics() ?? [],
  environmentReady: () => app.viewer?.environmentReady ?? false,
  // Settings surface for headless checks (theme + JSON round-trip).
  selectTab,
  theme: () => themeMode(),
  toggleTheme,
  lang: () => lang(),
  setLang: (next: "en" | "ru") => switchLanguage(next),
  settings: () => settingsToJson(),
  applySettingsText,
  saveSettings,
  loadSettings,
};
