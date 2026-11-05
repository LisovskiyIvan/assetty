/**
 * Optimize tab: LOD ladder results (one row per ratio). Stateless over the
 * passed rungs; Save as… / View reuse the report banner helpers.
 */
import { t } from "../../i18n";
import { el, fmtBytes, fmtNum, fmtSecs } from "../../ui";
import { bannerButton, copyPathButton } from "../../ui/banner";
import type { LodsItem } from "../../bridge";

export interface LodsCbs {
  onSaveAs(path: string): void;
  onView(path: string): void;
}

export interface LodsApi {
  panel: HTMLElement;
  render(items: LodsItem[]): void;
  reset(): void;
  syncTexts(): void;
}

export function createLodsSection(cbs: LodsCbs): LodsApi {
  const head = el("span");
  const bodyHost = el("div", { class: "panel-body" });
  const panel = el("div", { class: "panel" }, el("div", { class: "panel-head" }, head), bodyHost);

  /** Back to the empty state: a new ladder supersedes the previous table. */
  function reset(): void {
    head.textContent = t("opt.lodsSection");
    bodyHost.replaceChildren(el("div", { class: "empty", text: t("opt.lodsEmpty") }));
  }
  reset();

  function render(items: LodsItem[]): void {
    head.textContent = t("opt.lodsSection");
    const rows = items.map((item) => {
      const ratio = `${Math.round(item.ratio * 100)}%`;
      return el(
        "tr",
        null,
        el("td", { class: "num mono", text: ratio }),
        el("td", null, copyPathButton(item.out_path)),
        el("td", { class: "num", text: fmtNum(item.triangles) }),
        el("td", { class: "num", text: fmtBytes(item.disk_bytes) }),
        el("td", { class: "num", text: fmtSecs(item.secs) }),
        el(
          "td",
          { class: "num" },
          el(
            "div",
            { class: "row" },
            bannerButton(t("common.view"), t("opt.viewTitle"), {
              onClick: () => cbs.onView(item.out_path),
            }),
            bannerButton(t("common.saveAs"), t("opt.saveTitle"), {
              primary: true,
              onClick: () => cbs.onSaveAs(item.out_path),
            }),
          ),
        ),
      );
    });
    bodyHost.replaceChildren(
      el(
        "table",
        { class: "fixed" },
        el(
          "thead",
          null,
          el(
            "tr",
            null,
            el("th", { class: "num", text: t("opt.lodsColRatio") }),
            el("th", { text: t("opt.lodsColFile") }),
            el("th", { class: "num", text: t("opt.rowTriangles") }),
            el("th", { class: "num", text: t("opt.rowDisk") }),
            el("th", { class: "num", text: "secs" }),
            el("th", { class: "num", text: "" }),
          ),
        ),
        el("tbody", null, ...rows),
      ),
      el("div", { class: "hint", text: t("opt.lodsNote") }),
    );
  }

  function syncTexts(): void {
    head.textContent = t("opt.lodsSection");
  }

  return { panel, render, reset, syncTexts };
}
