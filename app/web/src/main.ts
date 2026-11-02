import "./style.css";
import { app } from "./app";
import { configureKtx2 } from "./ktx2";
import { el } from "./ui";
import { mountViewer } from "./tabs/viewer";
import { mountOptimize } from "./tabs/optimize";
import { mountTextures } from "./tabs/textures";
import { mountDiff } from "./tabs/diff";
import { mountLint } from "./tabs/lint";
import { mountSettings } from "./tabs/settings";
import type { TabHandle } from "./tabs/types";

configureKtx2();

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

const status = {
  fps: el("span", { text: "fps —" }),
  tris: el("span", { text: "tris —" }),
  draws: el("span", { text: "draws —" }),
  meshes: el("span", { text: "meshes —" }),
  path: el("span", { text: "no file" }),
  mode: el("span", { text: app.bridge.modeLabel }),
};

const appRoot = el("div", { id: "app" });
appRoot.append(
  el(
    "header",
    { class: "topbar" },
    el("span", { class: "brand", text: "assetty" }),
    tabBar,
    el("div", { class: "topbar-actions" }, modePill, openBtn),
  ),
  banner,
  content,
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
});
