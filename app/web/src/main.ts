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
  settingsToJson,
  themeMode,
  toggleTheme,
} from "./settings";
import { clear, copyText, el, fmtBytes, fmtCompact, statChip } from "./ui";
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

const TAB_DEFS: Array<{ id: TabId; label: string; mount: () => TabHandle }> = [
  { id: "viewer", label: "Viewer", mount: mountViewer },
  { id: "optimize", label: "Optimize", mount: mountOptimize },
  { id: "textures", label: "Textures", mount: mountTextures },
  { id: "settings", label: "Settings", mount: mountSettings },
];

/* ---------------------------------------------------------------- shell DOM */

const tabBar = el("nav", { class: "tabs" });
const content = el("main", { class: "content" });
const banner = el("div", { class: "banner" });
const modePill = el("span", { class: "pill" });

const openBtn = el("button", {
  class: "primary",
  text: "Open…",
  title: "Open model (⌘O)",
  onclick: () => void app.pickAndOpen(),
});

/** Viewer-tab activations; the inspector auto-opens once per activation unless
 * dismissed. `inspectorDismissedAt` records the activation during which the
 * user explicitly closed the inspector ("don't fight the user"). */
let viewerActivation = 0;
let inspectorDismissedAt = -1;

function onInspectorOpenChange(open: boolean): void {
  if (open) inspectorDismissedAt = -1;
  else inspectorDismissedAt = viewerActivation;
  syncInspectorChrome();
}

const inspectorDock = createInspectorDock(onInspectorOpenChange);

const inspectorBtn = el("button", {
  class: "small",
  text: "Inspector",
  title: "Toggle the Babylon inspector for the viewer scene (⌘I)",
  onclick: () => void toggleInspector(),
});

const themeBtn = el("button", {
  class: "small theme-toggle",
  text: "☾",
  title: "Switch to light theme",
  onclick: () => toggleTheme(),
});

function syncThemeButton(): void {
  const light = themeMode() === "light";
  themeBtn.textContent = light ? "☀" : "☾";
  themeBtn.title = light ? "Switch to dark theme" : "Switch to light theme";
  themeBtn.setAttribute("aria-label", themeBtn.title);
}

onSettingsChange(syncThemeButton);
syncThemeButton();

function syncInspectorChrome(): void {
  const open = inspectorDock.isOpen;
  inspectorBtn.classList.toggle("active", open);
  appRoot?.classList.toggle("inspector-open", open);
}

async function toggleInspector(): Promise<void> {
  let scene = app.viewer?.scene ?? null;
  if (!scene) {
    // Nothing rendered yet: the Viewer tab owns the primary scene.
    selectTab("viewer");
    scene = app.viewer?.scene ?? null;
    // Selecting the Viewer tab auto-opens the inspector; don't toggle it shut.
    if (inspectorDock.isOpen) {
      syncInspectorChrome();
      return;
    }
  }
  await inspectorDock.toggle(scene);
  syncInspectorChrome();
}

/** Auto-opens the inspector on Viewer-tab activation (open by default, even
 * with an empty scene). Skipped when the user dismissed it during this same
 * activation — it re-opens on the next activation. */
async function autoOpenInspector(): Promise<void> {
  if (inspectorDock.isOpen) return;
  if (inspectorDismissedAt === viewerActivation) return;
  const scene = app.viewer?.scene ?? null;
  if (!scene) return;
  await inspectorDock.show(scene);
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

/* ------------------------------------------------ statusbar: path + log popover */

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

const srcText = el("span", { class: "v", text: "no file" });
const srcChip = el(
  "button",
  {
    class: "status-path",
    title: "no model open",
    onclick: () => {
      const path = app.sourcePath;
      if (!path) return;
      void copyText(path).then((ok) => notify(ok ? "copied model path" : path, ok ? "ok" : "info"));
    },
  },
  el("span", { class: "k", text: "SRC " }),
  srcText,
);
srcChip.dataset.empty = "true";

const viewText = el("span", { class: "v", text: "" });
const viewChip = el(
  "button",
  {
    class: "status-path",
    title: "",
    onclick: () => {
      const path = app.viewPath;
      if (!path) return;
      void copyText(path).then((ok) => notify(ok ? "copied view path" : path, ok ? "ok" : "info"));
    },
  },
  el("span", { class: "k", text: "VIEW " }),
  viewText,
);
viewChip.hidden = true;

const logList = el("div", { class: "log-list" });
const logPopover = el(
  "div",
  { class: "status-popover", title: "recent messages" },
  el(
    "div",
    { class: "popover-head" },
    el("span", { text: "recent messages" }),
    el("span", { class: "muted mono", text: "last 20" }),
  ),
  logList,
);
logPopover.hidden = true;

function renderLog(): void {
  clear(logList);
  const entries = logHistory();
  if (entries.length === 0) {
    logList.append(el("div", { class: "empty", text: "no messages yet" }));
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
  title: "recent messages",
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
  infoBtn.title = kind === "error" ? `error: ${message}` : `last: ${message}`;
  if (!logPopover.hidden) renderLog();
});

const narrowPath = window.matchMedia("(max-width: 1200px)");
let pathIsNarrow = narrowPath.matches;
narrowPath.addEventListener("change", (ev) => {
  pathIsNarrow = ev.matches;
  updateStatusBar();
});

const appRoot = el("div", { id: "app" });
appRoot.append(
  el(
    "header",
    { class: "topbar" },
    el("span", { class: "brand", text: "assetty" }),
    tabBar,
    el("div", { class: "topbar-actions" }, modePill, themeBtn, inspectorBtn, openBtn),
  ),
  banner,
  content,
  inspectorDock.el,
  el(
    "footer",
    { class: "statusbar" },
    statusMetrics,
    srcChip,
    viewChip,
    el("span", { class: "status-spacer" }),
    infoBtn,
    logPopover,
  ),
);
document.body.append(appRoot);

/* ------------------------------------------------------------------ banner */

if (!app.bridge.live) {
  banner.classList.add("show");
  banner.append(
    el("strong", { text: "assetty-app host not detected — demo mode. " }),
    el("span", {
      text: "Layout is seeded with static JSON; the file picker is disabled. Run the window through ",
    }),
    el("code", { text: "assetty-app" }),
    el("span", { text: " (or " }),
    el("code", { text: "zig build run" }),
    el("span", { text: ") to talk to Zig." }),
  );
  modePill.classList.add("demo");
  modePill.textContent = "demo";
} else {
  modePill.textContent = app.bridge.source;
}

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
        el("div", { class: "empty", text: `failed to mount ${id}: ${(err as Error).message}` }),
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
  if (id === "viewer") {
    viewerActivation++;
    void autoOpenInspector();
  }
}

for (const def of TAB_DEFS) {
  tabBar.append(
    el("button", {
      class: "tab",
      dataset: { tab: def.id },
      text: def.label,
      onclick: () => selectTab(def.id),
    }),
  );
}

// Cross-tab navigation (e.g. Optimize → "Edit in Textures tab").
window.addEventListener("assetty:select-tab", (ev) => {
  const id = (ev as CustomEvent).detail as TabId;
  if (TAB_DEFS.some((t) => t.id === id)) selectTab(id);
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

  const src = app.sourcePath;
  const srcLabel = src ? (pathIsNarrow ? basename(src) : src) : "no file";
  if (srcText.textContent !== srcLabel) srcText.textContent = srcLabel;
  srcChip.title = src ? `${src}\nclick to copy` : "no model open";
  srcChip.dataset.empty = src ? "false" : "true";

  const diverged = !!app.viewPath && !!src && app.viewPath !== src;
  viewChip.hidden = !diverged;
  if (diverged) {
    const view = app.viewPath as string;
    const viewLabel = pathIsNarrow ? basename(view) : view;
    if (viewText.textContent !== viewLabel) viewText.textContent = viewLabel;
    viewChip.title = `${view}\nclick to copy`;
  }
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
    notify(`KTX2 decoders unavailable: ${missing.join(", ")}`, "error", 9000);
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
  settings: () => settingsToJson(),
  applySettingsText,
  saveSettings,
  loadSettings,
};
