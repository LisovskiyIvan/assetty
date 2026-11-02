import "./style.css";
import { app } from "./app";
import { checkKtx2Assets, configureKtx2, reportDecoderFailure } from "./ktx2";
import { logHistory, notify, onLog } from "./notify";
import { createInspectorDock } from "./inspector";
import { Logger } from "@babylonjs/core/Misc/logger";
import { clear, copyText, el, fmtBytes, fmtCompact, statChip } from "./ui";
import type { StatChip } from "./ui";
import { mountViewer } from "./tabs/viewer";
import { mountOptimize } from "./tabs/optimize";
import { mountTextures } from "./tabs/textures";
import { mountDiff } from "./tabs/diff";
import { mountLint } from "./tabs/lint";
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

type TabId = "viewer" | "optimize" | "textures" | "diff" | "lint" | "settings";

const TAB_DEFS: Array<{ id: TabId; label: string; mount: () => TabHandle }> = [
  { id: "viewer", label: "Viewer", mount: mountViewer },
  { id: "optimize", label: "Optimize", mount: mountOptimize },
  { id: "textures", label: "Textures", mount: mountTextures },
  { id: "diff", label: "Diff", mount: mountDiff },
  { id: "lint", label: "Lint", mount: mountLint },
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

const inspectorDock = createInspectorDock(() => syncInspectorChrome());

const inspectorBtn = el("button", {
  class: "small",
  text: "Inspector",
  title: "Toggle the Babylon inspector for the viewer scene (⌘I)",
  onclick: () => void toggleInspector(),
});

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
  }
  await inspectorDock.toggle(scene);
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

const pathText = el("span", { class: "v", text: "no file" });
const pathChip = el(
  "button",
  {
    class: "status-path",
    title: "no model open",
    onclick: () => {
      const path = app.pathA;
      if (!path) return;
      void copyText(path).then((ok) => notify(ok ? "copied model path" : path, ok ? "ok" : "info"));
    },
  },
  pathText,
);
pathChip.dataset.empty = "true";

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
    el("div", { class: "topbar-actions" }, modePill, inspectorBtn, openBtn),
  ),
  banner,
  content,
  inspectorDock.el,
  el(
    "footer",
    { class: "statusbar" },
    statusMetrics,
    pathChip,
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

  const path = app.pathA;
  const label = path ? (pathIsNarrow ? basename(path) : path) : "no file";
  if (pathText.textContent !== label) pathText.textContent = label;
  pathChip.title = path ? `${path}\nclick to copy` : "no model open";
  pathChip.dataset.empty = path ? "false" : "true";
};

setInterval(updateStatusBar, 500);
updateStatusBar();

app.on("path", () => updateStatusBar());
app.on("context", () => updateStatusBar());

/* ------------------------------------------------------------------- boot */

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
};
