import "./style.css";
import { app } from "./app";
import { configureKtx2 } from "./ktx2";
import { el, clear, fmtBytes, toast } from "./ui";
import type { DirEntry } from "./types";
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
const treeHost = el("div", { class: "tree" });
const rootLabel = el("div", { class: "sidebar-path", text: app.bridge.live ? "…" : "/demo" });

const openBtn = el("button", {
  class: "small",
  text: "Open…",
  onclick: () => void openFile(),
});
const refreshBtn = el("button", {
  class: "small",
  text: "↻",
  title: "reload tree",
  onclick: () => void refreshTree(),
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
  el(
    "div",
    { class: "body" },
    el(
      "aside",
      { class: "sidebar" },
      el(
        "div",
        { class: "sidebar-head" },
        el("span", { text: "files" }),
        el("div", { class: "row" }, refreshBtn),
      ),
      rootLabel,
      treeHost,
    ),
    content,
  ),
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
      text: "Layout is seeded with static JSON; backend actions are disabled. Run the window through ",
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

/* ---------------------------------------------------------------- file tree */

const expanded = new Set<string>();
let rootDir: string | null = null;
let selectedPath: string | null = null;
let selectedB: string | null = null;

function treeRow(entry: DirEntry, depth: number): HTMLElement {
  const isGlb = /\.(glb|gltf)$/i.test(entry.name);
  const caret = el("span", {
    class: "caret",
    text: entry.is_dir ? (expanded.has(entry.path) ? "▾" : "▸") : "",
  });
  const row = el(
    "div",
    {
      class: `tree-row ${entry.path === selectedPath ? "selected" : ""} ${entry.path === selectedB ? "path-b" : ""}`,
      style: { paddingLeft: `${8 + depth * 12}px` },
      title: entry.path,
    },
    caret,
    el("span", { class: "name", text: entry.is_dir ? `${entry.name}/` : entry.name }),
    entry.size != null ? el("span", { class: "size", text: fmtBytes(entry.size) }) : null,
  );

  const children = el("div", { class: `tree-children ${expanded.has(entry.path) ? "open" : ""}` });
  const wrapper = el("div", null, row, children);

  row.addEventListener("click", (ev) => {
    if (entry.is_dir) {
      if (expanded.has(entry.path)) {
        expanded.delete(entry.path);
      } else {
        expanded.add(entry.path);
        if (!children.dataset.loaded) {
          void loadDirInto(children, entry.path, depth + 1);
        }
      }
      caret.textContent = expanded.has(entry.path) ? "▾" : "▸";
      children.classList.toggle("open", expanded.has(entry.path));
      return;
    }
    if (!isGlb) {
      toast("only .glb / .gltf can be previewed");
      return;
    }
    const slot = (ev as MouseEvent).shiftKey ? "b" : "a";
    if (slot === "a") selectedPath = entry.path;
    else selectedB = entry.path;
    markSelection();
    app.setPath(entry.path, slot);
    status.path.textContent = entry.path;
    if (slot === "b") toast(`B = ${entry.path}`);
  });

  return wrapper;
}

async function loadDirInto(host: HTMLElement, path: string, depth: number): Promise<void> {
  host.dataset.loaded = "1";
  host.replaceChildren(
    el("div", { class: "hint", style: { paddingLeft: `${8 + depth * 12}px` }, text: "loading…" }),
  );
  try {
    const entries = await app.bridge.listDir(path);
    const sorted = entries
      .slice()
      .sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
    host.replaceChildren(...sorted.map((e) => treeRow(e, depth)));
  } catch (err) {
    host.replaceChildren(
      el("div", {
        class: "hint",
        style: { paddingLeft: `${8 + depth * 12}px` },
        text: `listDir failed: ${(err as Error).message}`,
      }),
    );
  }
}

function markSelection(): void {
  for (const row of Array.from(treeHost.querySelectorAll<HTMLElement>(".tree-row"))) {
    row.classList.toggle("selected", row.title === selectedPath);
    row.classList.toggle("path-b", row.title === selectedB && row.title !== selectedPath);
  }
}

async function refreshTree(): Promise<void> {
  clear(treeHost);
  if (!app.bridge.live) {
    try {
      const entries = await app.bridge.listDir("/demo");
      treeHost.append(...entries.map((e) => treeRow(e, 0)));
    } catch (err) {
      treeHost.append(el("div", { class: "empty", text: (err as Error).message }));
    }
    return;
  }
  const root = rootDir ?? "";
  rootLabel.textContent = root || "/";
  try {
    const entries = await app.bridge.listDir(root);
    treeHost.append(...entries.map((e) => treeRow(e, 0)));
  } catch (err) {
    treeHost.append(
      el("div", { class: "empty", text: `listDir failed: ${(err as Error).message}` }),
    );
  }
}

async function openFile(): Promise<void> {
  if (!app.bridge.live) {
    toast("open is disabled in demo mode — run via assetty-app", "error");
    return;
  }
  try {
    const path = await app.bridge.openDialog();
    if (!path) return;
    selectedPath = path;
    rootDir = path.replace(/\/[^/]+$/, "") || "/";
    markSelection();
    status.path.textContent = path;
    app.setPath(path, "a");
    await refreshTree();
  } catch (err) {
    toast(`open failed: ${(err as Error).message}`, "error");
  }
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
  status.path.textContent = d.slot === "a" ? d.path : status.path.textContent;
  markSelection();
});

/* ------------------------------------------------------------------- boot */

void refreshTree();
selectTab("viewer");

window.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "o") {
    ev.preventDefault();
    void openFile();
  }
});
