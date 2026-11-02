import { app } from "../app";
import { el, section, clear } from "../ui";
import type { TabHandle } from "./types";

export function mountSettings(): TabHandle {
  const root = el("div", { class: "tab-body wide-side" });
  const main = el("div", { class: "tab-main" });

  const title = el(
    "div",
    { class: "panel-head" },
    el("span", { text: "preset zon" }),
    el("span", { class: "muted mono", text: "—" }),
  );
  const zon = el("textarea", {
    spellcheck: false,
    style: { minHeight: "0", flex: "1", borderRadius: "0", border: "0" },
  });
  zon.value = "// select a preset on the right";
  zon.disabled = true;

  const saveBtn = el("button", { class: "primary", text: "Save preset", disabled: true });
  const reloadBtn = el("button", { text: "Reload", disabled: true });
  const status = el("span", { class: "hint", text: "" });

  const footer = el("div", {
    class: "panel-body",
    style: { borderTop: "1px solid var(--border)" },
  });
  footer.append(
    el("div", { class: "row spread" }, el("div", { class: "row" }, saveBtn, reloadBtn), status),
  );

  main.append(title, zon, footer);

  const side = el("div", { class: "tab-side" });
  const listHost = el("div", { class: "panel-body" });
  side.append(section("Presets", listHost));
  side.append(
    section(
      "zon format",
      el("div", {
        class: "hint",
        text: "presets are Zig zon objects: a .name, a .target and an ordered .steps list. Every step is a tagged union, applied in order.",
      }),
      el("pre", {
        class: "mono",
        style: { margin: "0", whiteSpace: "pre-wrap", fontSize: "11px", color: "var(--text-dim)" },
        text: `.{
    .name = "web",
    .target = .web,
    .steps = .{
        .{ .prune = .{ .unused_nodes = true } },
        .{ .weld = .{ .tolerance = 0.0 } },
        .{ .textures = .{
            .format = .ktx2,
            .quality = 200,
            .generate_mips = true,
            .max_size = 1024,
        } },
        .{ .quantize = .{
            .position_bits = 14,
            .normal_oct = true,
            .uv_bits = 12,
            .compress = true,
        } },
    },
}
`,
      }),
    ),
    section(
      "Theme",
      el(
        "div",
        { class: "row spread" },
        el("span", { text: "dark" }),
        el("span", { class: "badge dim", text: "only option" }),
      ),
    ),
  );

  root.append(main, side);

  let names: string[] = [];
  let active: string | null = null;
  let busy = false;

  function setStatus(text: string, kind: "muted" | "warn" = "muted"): void {
    status.textContent = text;
    status.className = kind === "warn" ? "hint" : "hint muted";
  }

  function renderList(): void {
    clear(listHost);
    if (names.length === 0)
      listHost.append(el("div", { class: "muted", text: "no presets found" }));
    for (const name of names) {
      const row = el(
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
          onclick: () => void select(name),
        },
        el("span", { class: "kind", text: "preset" }),
        el("span", { text: name }),
      );
      listHost.append(row);
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

  async function select(name: string): Promise<void> {
    active = name;
    renderList();
    title.replaceChildren(
      el("span", { text: `preset: ${name}` }),
      el("span", { class: "muted mono", text: "zon" }),
    );
    zon.disabled = true;
    zon.value = "// loading…";
    try {
      zon.value = await app.bridge.presetLoad(name);
    } catch (err) {
      zon.value = `// load failed: ${(err as Error).message}`;
    } finally {
      zon.disabled = false;
      saveBtn.disabled = !app.bridge.live || busy;
      reloadBtn.disabled = !app.bridge.live || busy;
    }
  }

  saveBtn.addEventListener("click", async () => {
    if (!active || busy) return;
    busy = true;
    saveBtn.disabled = true;
    try {
      await app.bridge.presetSave(active, zon.value);
      setStatus(`saved ${active}.zon`);
      app.toast(`saved preset ${active}`, "ok");
    } catch (err) {
      setStatus(`save failed: ${(err as Error).message}`, "warn");
      app.toast(`save failed: ${(err as Error).message}`, "error");
    } finally {
      busy = false;
      saveBtn.disabled = !app.bridge.live;
    }
  });

  reloadBtn.addEventListener("click", () => {
    if (active) void select(active);
  });

  return {
    el: root,
    activate: () => {
      if (names.length === 0) void loadNames();
    },
  };
}
