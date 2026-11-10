/** Textures tab: image list (rows, badges, selection). Stateless renders. */
import { app } from "../../app";
import { t } from "../../i18n";
import { el, fmtBytes, clear, emptyState } from "../../ui";
import { describeTextureDeviation } from "../../settings";
import type { ImageInfo } from "../../types";

export interface TextureListState {
  images: ImageInfo[];
  selected: number;
  previewing: number | null;
  /** Index with a dry-run encode in flight (null when idle). */
  activeEncodeIndex: number | null;
}

export function rowBadge(img: ImageInfo, encoding: boolean, previewing: boolean): HTMLElement {
  if (img.skipped) return el("span", { class: "badge dim", text: t("tex.skipped") });
  if (encoding) {
    return el("span", { class: "badge yellow", text: t("tex.previewing") });
  }
  if (previewing) {
    return el("span", { class: "badge dim", text: t("tex.loading") });
  }
  return img.has_mips
    ? el("span", { class: "badge green", text: t("tex.mips") })
    : el("span", { class: "badge dim", text: t("tex.noMips") });
}

/** Deviation from base params for one row (`uastc · 512 · q200`, `skipped`). */
export function deviationBadge(img: ImageInfo): HTMLElement {
  const src = app.sourcePath;
  const dev = src ? describeTextureDeviation(src, img.index, img.name) : null;
  const badge = el("span", {
    class: `badge ${dev === t("tex.skipped") ? "dim" : "accent"}`,
    text: dev ?? "",
    dataset: { ovbadge: String(img.index) },
    title: t("tex.ovTitle"),
  });
  badge.hidden = !dev;
  return badge;
}

/** Updates row + side-panel badges in place (no rebuild, so editors keep focus). */
export function refreshOverrideBadges(
  listHost: HTMLElement,
  side: HTMLElement,
  images: ImageInfo[],
): void {
  const src = app.sourcePath;
  const skippedLabel = t("tex.skipped");
  for (const node of Array.from(listHost.querySelectorAll("[data-ovbadge]"))) {
    const badge = node as HTMLElement;
    const img = images.find((i) => i.index === Number(badge.dataset.ovbadge));
    const dev = img && src ? describeTextureDeviation(src, img.index, img.name) : null;
    badge.hidden = !dev;
    if (dev) {
      badge.textContent = dev;
      badge.classList.toggle("dim", dev === skippedLabel);
      badge.classList.toggle("accent", dev !== skippedLabel);
    }
  }
  for (const node of Array.from(side.querySelectorAll("[data-sidebadge]"))) {
    const badge = node as HTMLElement;
    const img = images.find((i) => i.index === Number(badge.dataset.sidebadge));
    const dev = img && src ? describeTextureDeviation(src, img.index, img.name) : null;
    badge.hidden = !dev;
    if (dev) {
      badge.textContent = dev;
      badge.classList.toggle("dim", dev === skippedLabel);
      badge.classList.toggle("accent", dev !== skippedLabel);
    }
  }
}

export function renderTextureList(
  listHost: HTMLElement,
  state: TextureListState,
  onSelect: (index: number) => void,
): void {
  const { images, selected, previewing, activeEncodeIndex } = state;
  clear(listHost);
  if (images.length === 0) {
    if (app.sourcePath) {
      listHost.append(el("div", { class: "empty", text: t("tex.noImages") }));
    } else if (app.viewPath) {
      listHost.append(
        emptyState(t("viewer.noSourceHint"), {
          label: t("common.open"),
          onClick: () => void app.pickAndOpen(),
        }),
      );
    } else {
      listHost.append(
        emptyState(t("viewer.openHint"), {
          label: t("common.open"),
          onClick: () => void app.pickAndOpen(),
        }),
      );
    }
    return;
  }
  const body: HTMLElement[] = [];
  for (const img of images) {
    const formatText = img.effective_format ?? img.format;
    const formatCell = el("td", { class: "mono", text: formatText });
    if (img.effective_format && img.effective_format !== img.format) {
      formatCell.title = `stored: ${img.format} → effective: ${img.effective_format}`;
    }
    body.push(
      el(
        "tr",
        {
          class: `clickable ${img.index === selected ? "selected" : ""} ${
            img.index === previewing ? "previewing" : ""
          } ${img.index === activeEncodeIndex ? "encoding" : ""} ${img.skipped ? "skipped" : ""}`,
          tabIndex: 0,
          role: "button",
          "aria-label": img.name ?? `image ${img.index}`,
          onclick: () => onSelect(img.index),
          onkeydown: (ev: KeyboardEvent) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              onSelect(img.index);
            }
          },
        },
        el("td", { class: "mono", text: String(img.index) }),
        el("td", null, el("span", { text: img.name ?? "—" }), " ", deviationBadge(img)),
        formatCell,
        el("td", { class: "num", text: `${img.width}×${img.height}` }),
        el("td", { class: "num", text: fmtBytes(img.disk) }),
        el("td", { class: "num", text: fmtBytes(img.vram) }),
        el("td", null, rowBadge(img, img.index === activeEncodeIndex, img.index === previewing)),
      ),
    );
  }
  const rows = body;
  listHost.append(
    el(
      "table",
      { class: "texture-table" },
      el(
        "thead",
        null,
        el(
          "tr",
          null,
          el("th", { text: t("tex.colNum") }),
          el("th", { text: t("tex.colName") }),
          el("th", { text: t("tex.colFormat") }),
          el("th", { class: "num", text: t("tex.colSize") }),
          el("th", { class: "num", text: t("tex.colDisk") }),
          el("th", { class: "num", text: t("tex.colVram") }),
          el("th", { text: "" }),
        ),
      ),
      el("tbody", null, ...rows),
    ),
  );
}
