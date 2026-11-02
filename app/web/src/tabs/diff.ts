import { app } from "../app";
import { el, kv, section, clear } from "../ui";
import type { DiffCategory, DiffReport } from "../types";
import type { TabHandle } from "./types";

const CATEGORIES: Array<keyof DiffReport> = [
  "nodes",
  "meshes",
  "materials",
  "textures",
  "images",
  "animations",
  "skins",
];

export function mountDiff(): TabHandle {
  const root = el("div", { class: "tab-body" });
  const main = el("div", { class: "tab-main" });
  const controls = el("div", { class: "panel-body" });

  const inputA = el("input", {
    type: "text",
    placeholder: "/path/to/old.glb",
    value: app.pathA ?? "",
  });
  const inputB = el("input", {
    type: "text",
    placeholder: "/path/to/new.glb",
    value: app.pathB ?? "",
  });
  const runBtn = el("button", { class: "primary", text: "Run diff", disabled: !app.bridge.live });

  controls.append(
    el("div", { class: "row" }, el("span", { class: "muted mono", text: "A" }), inputA),
    el("div", { class: "row" }, el("span", { class: "muted mono", text: "B" }), inputB),
    el(
      "div",
      { class: "row spread" },
      el("span", { class: "hint", text: "shift-click in the sidebar fills B" }),
      runBtn,
    ),
  );

  const results = el("div", { style: { overflow: "auto", flex: "1" } });
  results.append(el("div", { class: "empty", text: "no diff yet" }));
  main.append(controls, el("div", { style: { borderTop: "1px solid var(--border)" } }), results);

  const side = el("div", { class: "tab-side" });
  side.append(section("Totals", el("div", { class: "empty", text: "run a diff" })));
  const totalsPanel = side.lastElementChild as HTMLElement;

  root.append(main, side);

  let busy = false;

  function renderReport(report: DiffReport): void {
    clear(results);
    let printed = 0;
    for (const cat of CATEGORIES) {
      const c = report[cat] as DiffCategory | undefined;
      if (!c) continue;
      const total = c.added.length + c.removed.length + c.changed.length;
      if (total === 0) continue;
      printed++;
      const rows: HTMLElement[] = [];
      for (const e of c.added) {
        rows.push(
          el(
            "tr",
            null,
            el("td", null, el("span", { class: "badge green", text: "added" })),
            el("td", { class: "mono", text: String(e.index) }),
            el("td", { text: e.name ?? "—" }),
            el("td", { class: "muted", text: "" }),
          ),
        );
      }
      for (const e of c.removed) {
        rows.push(
          el(
            "tr",
            null,
            el("td", null, el("span", { class: "badge red", text: "removed" })),
            el("td", { class: "mono", text: String(e.index) }),
            el("td", { text: e.name ?? "—" }),
            el("td", { class: "muted", text: "" }),
          ),
        );
      }
      for (const e of c.changed) {
        rows.push(
          el(
            "tr",
            null,
            el("td", null, el("span", { class: "badge yellow", text: "changed" })),
            el("td", { class: "mono", text: String(e.index) }),
            el("td", { text: e.name ?? "—" }),
            el("td", { class: "mono muted", text: e.fields.join(", ") }),
          ),
        );
      }
      results.append(
        section(
          `${String(cat)} (${total})`,
          el(
            "table",
            null,
            el(
              "thead",
              null,
              el(
                "tr",
                null,
                el("th", { text: "kind" }),
                el("th", { text: "#" }),
                el("th", { text: "name" }),
                el("th", { text: "fields" }),
              ),
            ),
            el("tbody", null, ...rows),
          ),
        ),
      );
    }
    if (printed === 0)
      results.append(el("div", { class: "empty", text: "no structural differences" }));

    const t = report.totals ?? {
      added: 0,
      removed: 0,
      changed: 0,
    };
    totalsPanel.replaceChildren(
      el("div", { class: "panel-head" }, el("span", { text: "Totals" })),
      el(
        "div",
        { class: "panel-body" },
        kv([
          ["added", String(t.added)],
          ["removed", String(t.removed)],
          ["changed", String(t.changed)],
        ]),
        el("div", {
          class: "hint",
          text: "categories: nodes, meshes, materials, textures, images, animations, skins",
        }),
      ),
    );
  }

  runBtn.addEventListener("click", async () => {
    if (busy) return;
    const a = inputA.value.trim();
    const b = inputB.value.trim();
    if (!a || !b) {
      app.toast("two paths required", "error");
      return;
    }
    busy = true;
    runBtn.disabled = true;
    results.replaceChildren(el("div", { class: "empty", text: "comparing…" }));
    try {
      const report = await app.bridge.diff(a, b);
      renderReport(report);
    } catch (err) {
      results.replaceChildren(
        el("div", { class: "empty", text: `diff failed: ${(err as Error).message}` }),
      );
      app.toast(`diff failed: ${(err as Error).message}`, "error");
    } finally {
      busy = false;
      runBtn.disabled = false;
    }
  });

  const off = app.on("path", (d) => {
    if (d.slot === "a") inputA.value = d.path;
    else inputB.value = d.path;
  });

  return {
    el: root,
    activate: () => {
      if (app.pathA && !inputA.value) inputA.value = app.pathA;
      if (app.pathB && !inputB.value) inputB.value = app.pathB;
    },
    dispose: () => off(),
  };
}
