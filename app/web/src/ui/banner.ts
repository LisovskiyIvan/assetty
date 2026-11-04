/** Shared result-banner + path-copy builders (Optimize + Textures tabs). */
import { t } from "../i18n";
import { copyText, el } from "../ui";
import { notify } from "../notify";

/** Copies `path` to the clipboard and toasts the outcome. */
export async function copyPathNotify(path: string): Promise<void> {
  const ok = await copyText(path);
  notify(ok ? t("common.copied", { path }) : path, ok ? "ok" : "info");
}

/** Path button that copies on click (the Optimize report banner style). */
export function copyPathButton(path: string): HTMLElement {
  return el("button", {
    class: "path-button mono",
    text: path,
    title: `${path}\nclick to copy`,
    onclick: () => void copyPathNotify(path),
  });
}

/** "Reveal" button that copies the path (the Textures apply-result style). */
export function revealButton(path: string): HTMLElement {
  return el("button", {
    class: "small",
    text: t("tex.reveal"),
    title: t("tex.revealTitle", { path }),
    onclick: () => void copyPathNotify(path),
  });
}

/**
 * Result banner: path row + a row of action buttons. Lives only while the
 * artifact does. `dataset.path` carries the artifact path for headless checks.
 */
export function resultBanner(path: string, ...actions: HTMLElement[]): HTMLElement {
  return el(
    "div",
    { class: "result-banner", dataset: { path } },
    copyPathButton(path),
    el("div", { class: "row" }, ...actions),
  );
}

/** Small action button with a label + tooltip. */
export function bannerButton(
  label: string,
  title: string,
  opts: { primary?: boolean; danger?: boolean; onClick: (ev: Event) => void },
): HTMLElement {
  const cls = `small${opts.primary ? " primary" : ""}${opts.danger ? " danger" : ""}`;
  return el("button", { class: cls, text: label, title, onclick: opts.onClick });
}
