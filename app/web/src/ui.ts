/** Tiny DOM helpers — keeps the tab modules readable without a framework. */
import { t } from "./i18n";

type Attrs = Record<string, unknown>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Array<Node | string | number | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = String(value);
      else if (key === "text") node.textContent = String(value);
      else if (key === "html") node.innerHTML = String(value);
      else if (key === "dataset") Object.assign(node.dataset, value as object);
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === "style" && typeof value === "object") {
        Object.assign(node.style, value as object);
      } else if (key in node) {
        (node as unknown as Record<string, unknown>)[key] = value;
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(typeof child === "string" || typeof child === "number" ? String(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function fmtBytes(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function fmtNum(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

/** Compact integer for the status bar: 948, 15.4K, 1.2M. */
export function fmtCompact(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const trim = (v: number, unit: string) => `${v.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (abs >= 1e9) return trim(n / 1e9, "G");
  if (abs >= 1e6) return trim(n / 1e6, "M");
  if (abs >= 1e4) return trim(n / 1e3, "K");
  return String(Math.round(n));
}

export interface StatChip {
  el: HTMLElement;
  value: HTMLElement;
}

/** Labeled `LABEL value` pair used by the status bar and the texture compare row. */
export function statChip(label: string, initial = "—", extraClass = ""): StatChip {
  const value = el("span", { class: "v", text: initial });
  const node = el(
    "span",
    { class: `stat-chip${extraClass ? ` ${extraClass}` : ""}` },
    el("span", { class: "k", text: label }),
    value,
  );
  return { el: node, value };
}

/** Same chip but with an arbitrary node (badge, link) as the value. */
export function statChipNode(label: string, node: Node): HTMLElement {
  return el("span", { class: "stat-chip" }, el("span", { class: "k", text: label }), node);
}

export function fmtPct(p: number | null | undefined, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(digits)}%`;
}

export function deltaClass(p: number | null | undefined, lowerIsBetter = true): string {
  if (p == null || !Number.isFinite(p) || Math.abs(p) < 0.05) return "delta-flat";
  const good = lowerIsBetter ? p < 0 : p > 0;
  return good ? "delta-good" : "delta-bad";
}

export function psnrBadge(psnr: number): HTMLElement {
  const cls = psnr > 35 ? "green" : psnr > 28 ? "yellow" : "red";
  return el("span", { class: `badge ${cls}`, text: `${psnr.toFixed(2)} dB` });
}

/** Hint shown by tabs that need a model before they can do anything. */
export const OPEN_HINT = "Open a model first (⌘O)";

/** Localized version of {@link OPEN_HINT} — call at render time. */
export function openHintText(): string {
  return t("viewer.openHint");
}

/** Centered empty state with an optional call-to-action button. */
export function emptyState(
  message: string,
  action?: { label: string; onClick: () => void },
): HTMLElement {
  const node = el(
    "div",
    { class: "empty-state" },
    el("div", { class: "empty-state-text", text: message }),
  );
  if (action) {
    node.append(el("button", { class: "primary", text: action.label, onclick: action.onClick }));
  }
  return node;
}

export function section(title: string, ...children: Array<Node | string | null>): HTMLElement {
  return el(
    "div",
    { class: "panel" },
    el("div", { class: "panel-head" }, el("span", { text: title })),
    el("div", { class: "panel-body" }, ...children),
  );
}

export function kv(pairs: Array<[string, string | HTMLElement]>): HTMLElement {
  const dl = el("dl", { class: "kv" });
  for (const [k, v] of pairs) {
    dl.append(el("dt", { text: k }), el("dd", null, typeof v === "string" ? v : v));
  }
  return dl;
}

let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: "info" | "ok" | "error" = "info", ms = 3600): void {
  if (!toastHost) {
    toastHost = el("div", { class: "toasts" });
    document.body.append(toastHost);
  }
  const node = el("div", { class: `toast ${kind === "info" ? "" : kind}`, text: message });
  toastHost.append(node);
  const remove = () => node.remove();
  setTimeout(remove, ms);
  node.addEventListener("click", remove);
}

export function spinner(label: string): HTMLElement {
  return el("div", { class: "loading show", text: label });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function makeTable(headers: Array<[string, boolean?]>, rows: HTMLElement[]): HTMLElement {
  const thead = el(
    "thead",
    null,
    el(
      "tr",
      null,
      ...headers.map(([label, num]) => el("th", { class: num ? "num" : "", text: label })),
    ),
  );
  return el("table", null, thead, el("tbody", null, ...rows));
}
