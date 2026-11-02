import { app } from "../app";
import { el, fmtBytes, fmtNum, kv, section, clear } from "../ui";
import type { Info } from "../types";
import { ViewerScene } from "../viewer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { TabHandle } from "./types";

export function mountViewer(): TabHandle {
  const root = el("div", { class: "tab-body" });
  const main = el("div", { class: "tab-main" });
  const wrap = el("div", { class: "canvas-wrap" });
  const canvas = el("canvas", { id: "viewer-canvas" });
  const label = el("div", { class: "canvas-label", text: "no file loaded" });
  const loading = el("div", { class: "loading", text: "loading…" });
  wrap.append(canvas, label, loading);
  main.append(wrap);

  const side = el("div", { class: "tab-side" });
  side.append(el("div", { class: "empty", text: "select a .glb in the sidebar" }));
  root.append(main, side);

  let viewer: ViewerScene | null = null;
  let pendingPath: string | null = app.pathA;
  let pickedBound = false;

  const showLoading = (on: boolean, text = "loading…") => {
    loading.textContent = text;
    loading.classList.toggle("show", on);
  };

  function explorerPanel(v: ViewerScene): HTMLElement {
    const data = v.explorerData();
    const host = el("div", { class: "explorer" });

    const group = (
      title: string,
      items: Array<{ label: string; kind: string; mesh?: AbstractMesh }>,
    ) => {
      if (items.length === 0) return;
      host.append(el("div", { class: "group", text: `${title} (${items.length})` }));
      for (const item of items) {
        const row = el(
          "div",
          {
            class: "item",
            onclick: () => {
              if (!item.mesh) return;
              v.selectMesh(item.mesh);
              host
                .querySelectorAll(".item.selected")
                .forEach((n) => n.classList.remove("selected"));
              row.classList.add("selected");
            },
          },
          el("span", { class: "kind", text: item.kind }),
          el("span", { class: "name", text: item.label }),
        );
        host.append(row);
      }
    };

    group(
      "Meshes",
      data.nodes.map((m) => ({
        label: m.name || `mesh#${m.uniqueId}`,
        kind: m.getTotalVertices() > 0 ? "mesh" : "node",
        mesh: m,
      })),
    );
    group(
      "Materials",
      data.materials.map((m) => ({ label: m.name || "material", kind: "mat" })),
    );
    group(
      "Textures",
      data.textures.map((t) => ({ label: t.name || "texture", kind: "tex" })),
    );
    if (data.animations.length > 0) {
      host.append(el("div", { class: "group", text: `Animations (${data.animations.length})` }));
      for (const g of data.animations)
        host.append(
          el(
            "div",
            { class: "item" },
            el("span", { class: "kind", text: "anim" }),
            el("span", { class: "name", text: g.name }),
          ),
        );
    }
    host.append(
      el("div", {
        class: "hint",
        text: "click a mesh to highlight · drag to orbit · wheel to zoom",
      }),
    );
    return section("Scene explorer", host);
  }

  function animationsPanel(v: ViewerScene): HTMLElement {
    const groups = v.scene.animationGroups;
    const list = el("div", { class: "anim-list" });
    if (groups.length === 0)
      list.append(el("div", { class: "muted", text: "no animation groups" }));
    for (const g of groups) list.append(animRow(g));
    return section("Animations", list);
  }

  function animRow(group: AnimationGroup): HTMLElement {
    const name = el("span", { class: "name", text: group.name || "animation" });
    const toggle = el("button", {
      class: "small",
      text: group.isPlaying ? "pause" : "play",
      onclick: () => {
        if (group.isPlaying) group.pause();
        else group.play(true);
        toggle.textContent = group.isPlaying ? "pause" : "play";
      },
    });
    const restart = el("button", {
      class: "small",
      text: "restart",
      onclick: () => {
        group.restart();
        toggle.textContent = "pause";
      },
    });
    return el("div", { class: "anim" }, name, toggle, restart);
  }

  function infoPanels(info: Info): HTMLElement[] {
    const g = info.geometry;
    const c = info.counts;
    return [
      section(
        "File",
        kv([
          ["path", info.file],
          ["container", info.container ?? "—"],
          ["generator", info.generator ?? "—"],
        ]),
      ),
      section(
        "Geometry",
        kv([
          ["triangles", fmtNum(g.triangles)],
          ["vertices", fmtNum(g.vertices)],
          ["mesh inst.", fmtNum(g.mesh_instances)],
          ["draw calls", fmtNum(g.draw_calls)],
        ]),
        el("div", { class: "section-title", text: "counts" }),
        kv([
          ["meshes / prims", `${c.meshes} / ${c.primitives}`],
          ["materials", fmtNum(c.materials)],
          ["textures / images", `${c.textures} / ${c.images}`],
          ["animations", fmtNum(c.animations)],
          ["skins / joints", `${c.skins} / ${c.joints}`],
        ]),
      ),
      section(
        "Disk",
        kv([
          ["total", fmtBytes(info.disk.total)],
          ["json", `${fmtBytes(info.disk.json)} (${info.disk.json_pct.toFixed(1)}%)`],
          ["bin", fmtBytes(info.disk.bin)],
        ]),
      ),
      section(
        "VRAM (estimated)",
        kv([["total", fmtBytes(info.vram.total_est)]]),
        el(
          "table",
          null,
          el(
            "tbody",
            null,
            ...info.vram.images.map((im) =>
              el(
                "tr",
                null,
                el("td", { class: "mono", text: String(im.index) }),
                el("td", { text: im.name ?? "—" }),
                el("td", { class: "mono", text: im.format }),
                el("td", { class: "num", text: `${im.width}×${im.height}` }),
                el("td", { class: "num", text: fmtBytes(im.vram) }),
              ),
            ),
          ),
        ),
      ),
    ];
  }

  function renderSide(info: Info | null, v: ViewerScene | null): void {
    clear(side);
    if (info) for (const panel of infoPanels(info)) side.append(panel);
    else side.append(el("div", { class: "empty", text: "no file loaded" }));
    if (v) side.append(explorerPanel(v), animationsPanel(v));
  }

  async function loadPath(path: string): Promise<void> {
    const v = viewer;
    if (!v) return;
    label.textContent = path;
    showLoading(true, `loading ${path}…`);
    try {
      if (app.bridge.live) {
        const b64 = await app.bridge.loadBytes(path);
        await v.loadBase64(b64);
      } else {
        v.loadDemo();
      }
      label.textContent = app.bridge.live ? path : `${path} — demo scene (no nanoui)`;
    } catch (err) {
      app.toast(`load failed: ${(err as Error).message}`, "error");
      label.textContent = "load failed";
    } finally {
      showLoading(false);
    }

    try {
      app.info = await app.bridge.info(path);
    } catch (err) {
      app.info = null;
      app.toast(`info failed: ${(err as Error).message}`, "error");
    }
    renderSide(app.info, v);

    if (!pickedBound) {
      pickedBound = true;
      v.scene.onPointerObservable.add((pi) => {
        if (pi.type !== 1) return; // POINTERDOWN
        v.selectMesh((pi.pickInfo?.pickedMesh as AbstractMesh | null) ?? null);
      });
    }
  }

  const offPath = app.on("path", (d) => {
    if (d.slot !== "a") return;
    pendingPath = d.path;
    if (viewer) void loadPath(d.path);
  });

  return {
    el: root,
    activate: () => {
      if (!viewer) {
        try {
          viewer = new ViewerScene(canvas, "viewer");
          app.setViewer(viewer);
          if (pendingPath) void loadPath(pendingPath);
          else {
            if (!app.bridge.live) {
              viewer.loadDemo();
              label.textContent = "demo scene (no nanoui)";
            }
            renderSide(null, viewer);
          }
        } catch (err) {
          const reason = (err as Error).message;
          wrap.append(el("div", { class: "empty", text: `WebGL unavailable: ${reason}` }));
          app.toast(`WebGL unavailable: ${reason}`, "error");
          renderSide(null, null);
        }
      } else {
        viewer.resume();
      }
    },
    deactivate: () => viewer?.pause(),
    dispose: () => {
      offPath();
      if (viewer) {
        app.setViewer(null);
        viewer.dispose();
        viewer = null;
      }
    },
  };
}
