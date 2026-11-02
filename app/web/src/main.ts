import "./style.css";
import { app } from "./app";
import { checkKtx2Assets, configureKtx2, reportDecoderFailure } from "./ktx2";
import { notify, onLog } from "./notify";
import { createInspectorDock } from "./inspector";
import { Logger } from "@babylonjs/core/Misc/logger";
import { el } from "./ui";
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
  fps: el("span", { text: "fps —" }),
  tris: el("span", { text: "tris —" }),
  draws: el("span", { text: "draws —" }),
  meshes: el("span", { text: "meshes —" }),
  path: el("span", { text: "no file" }),
  log: el("span", { class: "status-log", text: "" }),
  mode: el("span", { text: app.bridge.modeLabel }),
};

onLog((message, kind) => {
  status.log.textContent = message;
  status.log.title = message;
  status.log.dataset.kind = kind;
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
    status.fps,
    el("span", { class: "sep" }),
    status.tris,
    el("span", { class: "sep" }),
    status.draws,
    el("span", { class: "sep" }),
    status.meshes,
    el("span", { class: "sep" }),
    status.path,
    el("span", { class: "grow" }),
    status.log,
    el("span", { class: "sep" }),
    status.mode,
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

setInterval(() => {
  const viewer = app.viewer;
  if (!viewer) {
    status.fps.textContent = "fps —";
    status.tris.textContent = "tris —";
    status.draws.textContent = "draws —";
    status.meshes.textContent = "meshes —";
    return;
  }
  const s = viewer.getStats();
  status.fps.textContent = `fps ${s.fps.toFixed(0)}`;
  status.tris.textContent = `tris ${s.triangles.toLocaleString("en-US")}`;
  status.draws.textContent = `draws ${s.drawCalls}`;
  status.meshes.textContent = `meshes ${s.meshes}`;
}, 500);

app.on("path", (d) => {
  status.path.textContent = d.path;
});

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
