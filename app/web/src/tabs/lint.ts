import { app } from "../app";
import { demoBudget } from "../demo";
import { el, section, clear } from "../ui";
import type { LintResult } from "../types";
import type { TabHandle } from "./types";

const BUDGET_KEY = "assetty.lintBudget";

export function mountLint(): TabHandle {
  const root = el("div", { class: "tab-body wide-side" });
  const main = el("div", { class: "tab-main" });

  const input = el("input", {
    type: "text",
    placeholder: "/path/to/model.glb",
    value: app.pathA ?? "",
  });
  const pickBtn = el("button", {
    class: "small",
    text: "Pick…",
    title: "Pick a model",
    onclick: async () => {
      const path = await app.pickPath();
      if (path) input.value = path;
    },
  });
  const runBtn = el("button", { class: "primary", text: "Run lint", disabled: !app.bridge.live });
  const summary = el("div", { class: "panel-body" });
  const list = el("div", { style: { overflow: "auto", flex: "1" } });
  list.append(el("div", { class: "empty", text: "no lint run yet" }));

  main.append(
    el(
      "div",
      { class: "panel-body" },
      el(
        "div",
        { class: "row" },
        el("span", { class: "muted mono", text: "path" }),
        input,
        pickBtn,
      ),
      el("div", { class: "row" }, runBtn),
    ),
    el("div", { class: "panel" }, summary),
    list,
  );

  const side = el("div", { class: "tab-side" });
  const budget = el("textarea", { spellcheck: false });
  budget.value = localStorage.getItem(BUDGET_KEY) ?? demoBudget;
  budget.addEventListener("input", () => localStorage.setItem(BUDGET_KEY, budget.value));

  const resetBtn = el("button", {
    text: "Reset sample",
    onclick: () => {
      budget.value = demoBudget;
      localStorage.setItem(BUDGET_KEY, budget.value);
    },
  });

  side.append(
    section(
      "Budget (JSON)",
      budget,
      el(
        "div",
        { class: "row spread" },
        resetBtn,
        el("span", { class: "hint", text: "flat budget object" }),
      ),
      el("div", {
        class: "hint mono",
        text: "max_triangles, max_vertices, max_draw_calls,\nmax_vram_bytes, max_texture_size,\nrequire_mips, allowed_image_formats",
      }),
    ),
  );

  root.append(main, side);

  let busy = false;

  function renderSummary(result: LintResult | null, failed?: string): void {
    clear(summary);
    if (failed) {
      summary.append(
        el("div", { class: "badge red", text: "error" }),
        el("div", { class: "hint", text: failed }),
      );
      return;
    }
    if (!result) {
      summary.append(
        el("div", { class: "muted", text: "run lint to check the asset against the budget" }),
      );
      return;
    }
    const ok = result.total === 0;
    summary.append(
      el(
        "div",
        { class: "row spread" },
        el(
          "div",
          { class: "row" },
          el("span", { class: `badge ${ok ? "green" : "red"}`, text: ok ? "pass" : "fail" }),
          el("span", { class: "muted", text: ok ? "no violations" : "violations found" }),
        ),
        el("span", { class: "mono", text: `${result.total} total` }),
      ),
    );
  }

  function renderViolations(result: LintResult): void {
    clear(list);
    if (result.violations.length === 0) {
      list.append(el("div", { class: "empty", text: "asset fits the budget" }));
      return;
    }
    list.append(
      el(
        "table",
        null,
        el(
          "thead",
          null,
          el(
            "tr",
            null,
            el("th", { text: "code" }),
            el("th", { text: "index" }),
            el("th", { text: "message" }),
          ),
        ),
        el(
          "tbody",
          null,
          ...result.violations.map((v) =>
            el(
              "tr",
              null,
              el("td", { class: "mono" }, el("span", { class: "badge red", text: v.code })),
              el("td", { class: "mono", text: v.index == null ? "—" : String(v.index) }),
              el("td", { text: v.message }),
            ),
          ),
        ),
      ),
    );
  }

  runBtn.addEventListener("click", async () => {
    if (busy) return;
    const path = input.value.trim();
    if (!path) {
      app.toast("path required", "error");
      return;
    }
    let budgetJson = budget.value.trim();
    if (budgetJson) {
      try {
        JSON.parse(budgetJson);
      } catch (err) {
        app.toast(`budget JSON invalid: ${(err as Error).message}`, "error");
        return;
      }
    } else {
      budgetJson = "{}";
    }
    busy = true;
    runBtn.disabled = true;
    try {
      const result = await app.bridge.lint(path, budgetJson);
      renderSummary(result);
      renderViolations(result);
    } catch (err) {
      renderSummary(null, (err as Error).message);
      clear(list);
      list.append(el("div", { class: "empty", text: `lint failed: ${(err as Error).message}` }));
      app.toast(`lint failed: ${(err as Error).message}`, "error");
    } finally {
      busy = false;
      runBtn.disabled = false;
    }
  });

  const off = app.on("path", (d) => {
    input.value = d.path;
  });

  return {
    el: root,
    activate: () => {
      if (app.pathA && !input.value) input.value = app.pathA;
      renderSummary(null);
    },
    dispose: () => off(),
  };
}
