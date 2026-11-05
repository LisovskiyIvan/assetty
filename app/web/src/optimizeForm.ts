/**
 * Per-step optimize controls, shared by the Optimize tab and the Settings tab
 * (optimize defaults). Both surfaces edit the same `settings.optimize.steps`
 * state — see `settings.ts` for the persisted schema.
 */
import { el } from "./ui";
import { t } from "./i18n";
import { DEFAULT_TEXTURE_RULES } from "./settings";
import type { OptimizeSteps, TextureFormat, TextureRule } from "./settings";

export interface OptimizeFormOptions {
  get(): OptimizeSteps;
  /** Applies one edit to the live settings state (debounce-saved by settings.ts). */
  edit(mutate: (steps: OptimizeSteps) => void): void;
  /**
   * Collapsible sections (Optimize tab): only the step name + a one-line live
   * summary stay visible, the controls hide behind a click. Flat (Settings
   * tab) keeps today's always-open layout.
   */
  collapsible?: boolean;
}

export interface OptimizeForm {
  /** Re-reads state into every control; call after a settings reload. */
  sync(): void;
}

/**
 * One-liner help for every property in the step forms (single source: the
 * Optimize step blocks and the Settings defaults both render from here; the
 * compare-mode toggle and the texture override editors reuse it too).
 * Pattern: what it does + what it affects (quality / disk / VRAM / draws).
 */
export const FIELD_HELP: Record<string, string> = {
  "prune.unused_nodes":
    "Drops nodes unreachable from any scene at serialize time. Smaller file and a shorter node hierarchy; rendering is unchanged.",
  "prune.unused_materials":
    "Drops materials no mesh references. Smaller file and a shorter material list; rendering is unchanged.",
  "prune.unused_textures":
    "Drops images and samplers no material references. Smaller file and less texture memory reserved; rendering is unchanged.",
  "prune.animations":
    "Strips every animation track from the output. Animated nodes stay as static scene nodes and skeleton/skin data is kept; the file is smaller and loads faster. Re-run from the source to get animations back — results never mutate the source.",
  "dedup.accessors":
    "Merges byte-identical GPU buffers so they are stored once. Smaller disk size and less VRAM; rendering is unchanged.",
  "dedup.meshes":
    "Merges meshes with identical primitives into a single definition. Smaller file; rendering is unchanged.",
  "dedup.materials":
    "Merges materials with identical parameters into one. Smaller file and fewer state changes, which can reduce draw calls; rendering is unchanged.",
  "weld.tolerance":
    "Merges vertices closer than this distance (0 = exact matches only). Higher values close tiny cracks and shrink the vertex buffer, but may weld UV seams and shift positions slightly.",
  join: "Merges mesh primitives that share a material into fewer draw calls. Fewer draws, but coarser per-mesh culling — distant parts of a joined mesh stay resident.",
  "simplify.target_ratio":
    "Fraction of triangles to keep (0.5 = half). Fewer triangles render faster and use less memory, at some loss of silhouette detail.",
  "simplify.error_tolerance":
    "Maximum allowed visual error for the decimation. Higher values let the simplifier remove more at the same ratio, trading fidelity for size.",
  "simplify.aggressive":
    "Allows topology changes during decimation. Simplifies more aggressively (smaller file, fewer triangles) but accepts larger local error.",
  "simplify.lock_borders":
    "Keeps UV-shell and mesh borders fixed during decimation. Prevents seams cracking open; the mesh compresses slightly less.",
  "simplify.use_attributes":
    "Weighs normal and UV error during decimation (seam-aware). Preserves shading and UV islands better, at the cost of keeping more triangles.",
  "simplify.weight_normal":
    "How strongly normal distortion is penalized when seam-aware mode is on. Higher values protect shading smoothness but keep more triangles.",
  "simplify.weight_uv":
    "How strongly UV distortion is penalized when seam-aware mode is on. Higher values protect texture mapping but keep more triangles.",
  "textures.format":
    "GPU texture codec: auto picks per target, ETC1S is smallest with fast transcode (lossy), UASTC is higher quality but a bigger file. Affects disk size and GPU decode cost.",
  "textures.quality":
    "ETC1S encoder quality, 1–255. Higher values preserve detail but compress worse (bigger KTX2); lower values trade visible artifacts for disk savings.",
  "textures.max_size":
    "Downscales the longest side to this many pixels (0 = original). Halving each side quarters VRAM and disk use, at a loss of texture sharpness.",
  "textures.generate_mips":
    "Generates the mip chain for minified sampling. Sharper, shimmer-free minification at ~33% more VRAM; almost always keep on.",
  "textures.normal_map":
    "Encodes with normal-map settings (renormalization, no sRGB). Required for correct lighting on normal maps; using it on color textures washes them out.",
  "textures.supercompression":
    "Zstd-compresses the UASTC KTX2 payload (supercompressionScheme=2). 20–40% smaller files at the same pixels — no VRAM change — but the loader must support KTX2 zstd supercompression (Babylon.js does). UASTC only; ignored for ETC1S.",
  "quantize.position_bits":
    "Quantizes vertex positions to this many bits (14 ≈ near-lossless). Big VRAM and disk win for a tiny precision loss; needs KHR_mesh_quantization support.",
  "quantize.uv_bits":
    "Quantizes texture coordinates to this many bits (12 ≈ near-lossless). Big VRAM and disk win for a tiny precision loss; needs KHR_mesh_quantization support.",
  "quantize.normal_oct":
    "Packs normals with octahedral encoding (2×8/16-bit instead of 3 floats). Much smaller vertex buffers; needs extension support — very old viewers may render it wrong.",
  compress:
    "Meshopt-compresses every eligible vertex and index buffer view (EXT_meshopt_compression, gltfpack -cc style) — including plain float geometry the quantize step left untouched. Much smaller disk size at identical vertices; the loader must support EXT_meshopt_compression.",
  "animops.remove_constant_tracks":
    "Drops animation channels whose every keyframe is identical, baking the value into the static node transform. Smaller file and faster load; the motion is unchanged. Re-run from the source to get the tracks back.",
  "animops.epsilon":
    "Per-component tolerance for the constant-track check. Larger values drop more tracks but risk flattening subtle motion; 0.00001 keeps only truly static tracks.",
  "compare.mode":
    "Side by side shows source and result next to each other; split slider stacks them with a draggable wipe. Both views stay camera-synced while you orbit.",
  "textures.overrides_note":
    "Per-texture overrides replace the base params for single images of this model only, and merge into the textures step on Run. Edit them per image in the Textures tab.",
  "textures.apply_rules":
    "First-match-wins auto rules: each image is classified by its material slot (normal, arm, occlusion, emissive, base color) and name suffix, and the first matching rule replaces the base params. Per-image overrides still win over rules.",
  "textures.reencode_ktx2":
    "Transcode already-KTX2 sources and re-encode them like any image. Off = KTX2 images are skipped as today.",
  "textures.rules":
    "Editable JSON array of auto rules (first match wins per image). Reset restores the project-derived table. Saved into settings and every JSON preset.",
};

/* ------------------------------------------------- help popover (singleton) */

let helpPop: HTMLElement | null = null;
let helpAnchor: HTMLElement | null = null;
let helpWired = false;

/** Closes the open "?" popover, if any. Tabs call this on deactivate. */
export function closeFieldHelp(): void {
  helpPop?.remove();
  helpPop = null;
  helpAnchor = null;
}

function wireHelpOnce(): void {
  if (helpWired) return;
  helpWired = true;
  document.addEventListener(
    "click",
    (ev) => {
      if (!helpPop) return;
      const target = ev.target as Node | null;
      if (target && (helpPop.contains(target) || (helpAnchor && helpAnchor.contains(target)))) {
        return;
      }
      closeFieldHelp();
    },
    true,
  );
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeFieldHelp();
  });
  document.addEventListener(
    "scroll",
    (ev) => {
      if (!helpPop) return;
      const target = ev.target as Node | null;
      if (target instanceof Node && helpPop.contains(target)) return;
      closeFieldHelp();
    },
    true,
  );
  window.addEventListener("resize", () => closeFieldHelp());
}

function toggleFieldHelp(anchor: HTMLElement, id: string): void {
  if (helpPop && helpAnchor === anchor) {
    closeFieldHelp();
    return;
  }
  closeFieldHelp();
  if (!FIELD_HELP[id]) return;
  // Localized at open time, so a language switch applies to the next open
  // even without a rebuild (the tabs also rebuild the form on `lang`).
  const text = t(`help.${id}`);
  wireHelpOnce();
  const pop = el("div", { class: "field-help-pop", text });
  pop.setAttribute("role", "note");
  document.body.append(pop);
  // Measure, then place near the icon: below it, flipping above near the
  // viewport bottom and clamping horizontally to the viewport (which, on
  // narrow windows, is the panel width).
  pop.style.visibility = "hidden";
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  const rect = anchor.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - popW / 2),
    Math.max(8, window.innerWidth - popW - 8),
  );
  const below = rect.bottom + 6;
  const above = rect.top - 6 - popH;
  const top =
    below + popH <= window.innerHeight - 8 || above < 8
      ? Math.min(below, Math.max(8, window.innerHeight - popH - 8))
      : above;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.visibility = "";
  helpPop = pop;
  helpAnchor = anchor;
}

/** Small "?" icon-button; opens the FIELD_HELP popover for `id` on click. */
export function fieldHelpButton(id: string): HTMLElement {
  wireHelpOnce();
  const btn = el("button", {
    class: "help-btn",
    type: "button",
    text: "?",
    title: t("help.whatDoes"),
    dataset: { help: id },
  });
  btn.setAttribute("aria-label", t("help.aria", { id }));
  btn.addEventListener("click", (ev) => {
    // The button may sit inside a <label>: never toggle the control.
    ev.preventDefault();
    ev.stopPropagation();
    toggleFieldHelp(btn, id);
  });
  return btn;
}

function maxSizeOptions(): Array<[string, string]> {
  return [
    [t("common.noResize"), "0"],
    ["512", "512"],
    ["1024", "1024"],
    ["2048", "2048"],
  ];
}

const TEXTURE_FORMATS: Array<[string, TextureFormat]> = [
  ["auto", "auto"],
  ["ETC1S", "etc1s"],
  ["UASTC", "uastc"],
];

const ERROR_TOLERANCES: Array<[string, number]> = [
  ["0.05%", 0.0005],
  ["0.1%", 0.001],
  ["0.2%", 0.002],
  ["0.5%", 0.005],
  ["1%", 0.01],
];

const POSITION_BITS: Array<[string, string]> = Array.from(
  { length: 6 },
  (_, i): [string, string] => [String(11 + i), String(11 + i)],
);

const UV_BITS: Array<[string, string]> = Array.from({ length: 9 }, (_, i): [string, string] => [
  String(8 + i),
  String(8 + i),
]);

export function buildOptimizeForm(host: HTMLElement, opts: OptimizeFormOptions): OptimizeForm {
  const valueSyncers: Array<() => void> = [];
  const refreshSyncers: Array<() => void> = [];
  const blocks: Array<{ id: keyof OptimizeSteps; box: HTMLInputElement; params: HTMLElement }> = [];

  /** Visibility + enabled state only: never overwrites a value being typed. */
  function refresh(): void {
    const steps = opts.get();
    for (const block of blocks) {
      block.box.checked = steps[block.id].enabled;
      // Collapsible sections keep the user's own open state (the live summary
      // carries the enabled state instead); flat mode hides disabled params.
      if (!opts.collapsible) block.params.hidden = !steps[block.id].enabled;
    }
    for (const fn of refreshSyncers) fn();
  }

  function sync(): void {
    for (const fn of valueSyncers) fn();
    refresh();
  }

  function edit(mutate: (steps: OptimizeSteps) => void): void {
    opts.edit(mutate);
    refresh();
  }

  function field(label: string, control: HTMLElement, wide = false, helpId?: string): HTMLElement {
    return el(
      "div",
      { class: wide ? "field wide" : "field" },
      el("span", { text: label }),
      helpId ? fieldHelpButton(helpId) : null,
      control,
    );
  }

  function check(
    label: string,
    get: () => boolean,
    set: (value: boolean) => void,
    helpId?: string,
  ): HTMLElement {
    const box = el("input", { type: "checkbox" });
    box.checked = get();
    box.addEventListener("change", () => set(box.checked));
    valueSyncers.push(() => {
      box.checked = get();
    });
    const lab = el("label", { class: "inline-check" }, box, el("span", { text: label }));
    if (helpId) lab.append(fieldHelpButton(helpId));
    return lab;
  }

  function select(
    values: Array<[string, string]>,
    get: () => string,
    set: (value: string) => void,
  ): HTMLSelectElement {
    const node = el("select", { class: "compact" });
    for (const [label, value] of values) node.append(el("option", { value, text: label }));
    const ensureOption = (): void => {
      const value = get();
      if (!values.some(([, v]) => v === value)) {
        node.append(el("option", { value, text: value }));
      }
      node.value = value;
    };
    node.addEventListener("change", () => set(node.value));
    ensureOption();
    valueSyncers.push(ensureOption);
    return node;
  }

  function slider(
    min: number,
    max: number,
    stepSize: number,
    get: () => number,
    set: (value: number) => void,
    suffix = "",
  ): HTMLElement {
    const input = el("input", { type: "range", min, max, step: stepSize });
    const out = el("span", { class: "range-value mono" });
    const apply = (): void => {
      input.value = String(get());
      out.textContent = `${get()}${suffix}`;
    };
    input.addEventListener("input", () => {
      set(Number(input.value));
      out.textContent = `${Number(input.value)}${suffix}`;
    });
    valueSyncers.push(apply);
    apply();
    return el("div", { class: "range-row" }, input, out);
  }

  function numberInput(
    min: number,
    max: number,
    stepSize: number,
    get: () => number,
    set: (value: number) => void,
  ): HTMLInputElement {
    const input = el("input", {
      type: "number",
      min,
      max,
      step: stepSize,
      class: "compact",
    });
    input.value = String(get());
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      set(Math.min(max, Math.max(min, value)));
    });
    valueSyncers.push(() => {
      input.value = String(get());
    });
    return input;
  }

  function stepBlock(
    id: keyof OptimizeSteps,
    label: string,
    hint: string,
    buildParams: () => HTMLElement[],
    helpId?: string,
    summarize?: () => string,
  ): void {
    const box = el("input", { type: "checkbox" });
    box.checked = opts.get()[id].enabled;
    box.addEventListener("change", () =>
      edit((steps) => {
        steps[id].enabled = box.checked;
      }),
    );
    const params = el("div", { class: "step-params" });
    params.append(...buildParams());
    if (!opts.collapsible) {
      params.hidden = !box.checked;
      blocks.push({ id, box, params });
      host.append(
        el(
          "div",
          { class: "step-block" },
          el(
            "label",
            { class: "step-toggle" },
            box,
            el("span", { class: "step-name", text: label }),
            helpId ? fieldHelpButton(helpId) : null,
            el("span", { class: "step-hint", text: hint }),
          ),
          params,
        ),
      );
      return;
    }
    // Collapsible: the header carries the enable checkbox, the help button and
    // a live one-line summary; the controls hide behind a click. Open state is
    // the user's own (refresh() only syncs the checkbox + summary, never the
    // disclosure), so everything stays reachable within two clicks.
    const summaryEl = el("span", { class: "step-summary" });
    const updateSummary = (): void => {
      const on = opts.get()[id].enabled;
      summaryEl.textContent = on ? (summarize?.() ?? hint) : t("opt.stepDisabled");
      summaryEl.classList.toggle("off", !on);
    };
    refreshSyncers.push(updateSummary);
    updateSummary();
    const chevron = el("span", { class: "step-chevron", text: "▸", "aria-hidden": "true" });
    const block = el("div", { class: "step-block collapsed" });
    const head = el(
      "div",
      {
        class: "step-head",
        role: "button",
        tabIndex: 0,
        "aria-expanded": "false",
        title: hint,
      },
      box,
      el("span", { class: "step-name", text: label }),
      helpId ? fieldHelpButton(helpId) : null,
      summaryEl,
      chevron,
    );
    const setOpen = (next: boolean): void => {
      open = next;
      params.hidden = !open;
      block.classList.toggle("collapsed", !open);
      head.setAttribute("aria-expanded", open ? "true" : "false");
      chevron.textContent = open ? "▾" : "▸";
    };
    head.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement | null;
      // The checkbox and the "?" keep their own behavior (never toggle).
      if (target && (target === box || target.closest("input,button"))) return;
      setOpen(!open);
    });
    head.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        setOpen(!open);
      }
    });
    let open = false;
    params.hidden = true;
    blocks.push({ id, box, params });
    block.append(head, params);
    host.append(block);
  }

  /* ----------------------------------------------------------------- prune */
  stepBlock(
    "prune",
    "prune",
    t("opt.hint.prune"),
    () => [
      el(
        "div",
        { class: "checks" },
        check(
          "nodes",
          () => opts.get().prune.unused_nodes,
          (value) =>
            edit((steps) => {
              steps.prune.unused_nodes = value;
            }),
          "prune.unused_nodes",
        ),
        check(
          "materials",
          () => opts.get().prune.unused_materials,
          (value) =>
            edit((steps) => {
              steps.prune.unused_materials = value;
            }),
          "prune.unused_materials",
        ),
        check(
          "textures",
          () => opts.get().prune.unused_textures,
          (value) =>
            edit((steps) => {
              steps.prune.unused_textures = value;
            }),
          "prune.unused_textures",
        ),
        check(
          t("opt.stripAnimations"),
          () => !opts.get().prune.animations,
          (value) =>
            edit((steps) => {
              steps.prune.animations = !value;
            }),
          "prune.animations",
        ),
      ),
    ],
    undefined,
    () => {
      const p = opts.get().prune;
      const kept: string[] = [];
      if (p.unused_nodes) kept.push("nodes");
      if (p.unused_materials) kept.push("materials");
      if (p.unused_textures) kept.push("textures");
      if (p.animations) kept.push(t("opt.rowAnimations"));
      return kept.length > 0 ? kept.join(" · ") : t("opt.hint.prune");
    },
  );

  /* ----------------------------------------------------------------- dedup */
  stepBlock(
    "dedup",
    "dedup",
    t("opt.hint.dedup"),
    () => [
      el(
        "div",
        { class: "checks" },
        check(
          "accessors",
          () => opts.get().dedup.accessors,
          (value) =>
            edit((steps) => {
              steps.dedup.accessors = value;
            }),
          "dedup.accessors",
        ),
        check(
          "meshes",
          () => opts.get().dedup.meshes,
          (value) =>
            edit((steps) => {
              steps.dedup.meshes = value;
            }),
          "dedup.meshes",
        ),
        check(
          "materials",
          () => opts.get().dedup.materials,
          (value) =>
            edit((steps) => {
              steps.dedup.materials = value;
            }),
          "dedup.materials",
        ),
      ),
    ],
    undefined,
    () => {
      const d = opts.get().dedup;
      const kept: string[] = [];
      if (d.accessors) kept.push("accessors");
      if (d.meshes) kept.push("meshes");
      if (d.materials) kept.push("materials");
      return kept.length > 0 ? kept.join(" · ") : t("opt.hint.dedup");
    },
  );

  /* ------------------------------------------------------------------ weld */
  stepBlock(
    "weld",
    "weld",
    t("opt.hint.weld"),
    () => [
      field(
        "tolerance",
        numberInput(
          0,
          1,
          0.0001,
          () => opts.get().weld.tolerance,
          (value) =>
            edit((steps) => {
              steps.weld.tolerance = value;
            }),
        ),
        true,
        "weld.tolerance",
      ),
    ],
    undefined,
    () => `tolerance ${opts.get().weld.tolerance}`,
  );

  /* ------------------------------------------------------------------ join */
  stepBlock("join", "join", t("opt.hint.join"), () => [], "join");

  /* -------------------------------------------------------------- textures */
  stepBlock(
    "textures",
    "textures",
    t("opt.hint.textures"),
    () => [
      field(
        "format",
        select(
          TEXTURE_FORMATS.map(([label, value]): [string, string] => [label, value]),
          () => opts.get().textures.format,
          (value) =>
            edit((steps) => {
              steps.textures.format = value as TextureFormat;
            }),
        ),
        false,
        "textures.format",
      ),
      field(
        "quality",
        slider(
          1,
          255,
          1,
          () => opts.get().textures.quality,
          (value) =>
            edit((steps) => {
              steps.textures.quality = value;
            }),
        ),
        true,
        "textures.quality",
      ),
      field(
        "max size",
        select(
          maxSizeOptions().map(([label, value]): [string, string] => [label, value]),
          () => String(opts.get().textures.max_size),
          (value) =>
            edit((steps) => {
              steps.textures.max_size = Number(value);
            }),
        ),
        false,
        "textures.max_size",
      ),
      field(
        "mips",
        check(
          "generate",
          () => opts.get().textures.generate_mips,
          (value) =>
            edit((steps) => {
              steps.textures.generate_mips = value;
            }),
          "textures.generate_mips",
        ),
      ),
      field(
        "zstd",
        (() => {
          const lab = check(
            "supercompression",
            () => opts.get().textures.supercompression === "zstd",
            (value) =>
              edit((steps) => {
                steps.textures.supercompression = value ? "zstd" : "none";
              }),
            "textures.supercompression",
          );
          const box = lab.querySelector("input");
          // Backend ignores supercompression for ETC1S; grey out unless UASTC.
          refreshSyncers.push(() => {
            const active = opts.get().textures.format === "uastc";
            if (box) (box as HTMLInputElement).disabled = !active;
            lab.title = active ? "" : t("opt.zstdUastcOnly");
          });
          return lab;
        })(),
      ),
      field(
        "auto",
        check(
          "by slot rules",
          () => opts.get().textures.apply_rules,
          (value) =>
            edit((steps) => {
              steps.textures.apply_rules = value;
            }),
          "textures.apply_rules",
        ),
      ),
      field(
        "ktx2",
        check(
          "re-encode",
          () => opts.get().textures.reencode_ktx2,
          (value) =>
            edit((steps) => {
              steps.textures.reencode_ktx2 = value;
            }),
          "textures.reencode_ktx2",
        ),
      ),
      (() => {
        const count = el("span", { class: "hint mono" });
        const err = el("span", { class: "hint settings-bad" });
        const area = el("textarea", {
          class: "mono rules-area",
          rows: 8,
          spellcheck: false,
          placeholder: '[{"slot":"normal","format":"uastc"}, …]',
          oninput: () => {
            const raw = (area as HTMLTextAreaElement).value;
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              err.textContent = t("opt.rulesInvalid");
              return;
            }
            if (!Array.isArray(parsed)) {
              err.textContent = t("opt.rulesInvalid");
              return;
            }
            err.textContent = "";
            edit((steps) => {
              steps.textures.rules = parsed as TextureRule[];
            });
            count.textContent = t("opt.rulesCount", { n: parsed.length });
          },
        }) as unknown as HTMLTextAreaElement;
        const reset = el("button", {
          class: "small",
          type: "button",
          text: t("opt.rulesReset"),
          title: t("opt.rulesResetTitle"),
          onclick: () => {
            const seed = JSON.parse(JSON.stringify(DEFAULT_TEXTURE_RULES)) as TextureRule[];
            edit((steps) => {
              steps.textures.rules = seed;
              steps.textures.apply_rules = true;
            });
            // edit() only refreshes visibility: repaint the editor explicitly.
            (area as HTMLTextAreaElement).value = JSON.stringify(seed, null, 1);
            count.textContent = t("opt.rulesCount", { n: seed.length });
          },
        });
        valueSyncers.push(() => {
          const rules = opts.get().textures.rules;
          const text = JSON.stringify(rules);
          if ((area as HTMLTextAreaElement).value !== text) {
            (area as HTMLTextAreaElement).value =
              rules.length > 0 ? JSON.stringify(rules, null, 1) : "";
          }
          count.textContent = t("opt.rulesCount", { n: rules.length });
        });
        refreshSyncers.push(() => {
          const on = opts.get().textures.apply_rules;
          (area as HTMLTextAreaElement).disabled = !on;
          reset.toggleAttribute("disabled", !on);
        });
        const head = el("div", { class: "row" }, count, fieldHelpButton("textures.rules"), reset);
        return field("rules", el("div", { class: "rules-box" }, head, area, err), true);
      })(),
    ],
    undefined,
    () => {
      const tx = opts.get().textures;
      const size = tx.max_size > 0 ? String(tx.max_size) : t("common.noResize");
      const zstd = tx.supercompression === "zstd" ? " · zstd" : "";
      const rules = tx.apply_rules ? ` · ${t("opt.rulesShort", { n: tx.rules.length })}` : "";
      const reenc = tx.reencode_ktx2 ? ` · ${t("opt.reencodeShort")}` : "";
      return `${tx.format} · q${tx.quality} · ${size} · ${tx.generate_mips ? t("tex.mips") : t("tex.noMips")}${zstd}${rules}${reenc}`;
    },
  );

  /* -------------------------------------------------------------- quantize */
  stepBlock(
    "quantize",
    "quantize",
    t("opt.hint.quantize"),
    () => [
      field(
        "position bits",
        select(
          POSITION_BITS,
          () => String(opts.get().quantize.position_bits),
          (value) =>
            edit((steps) => {
              steps.quantize.position_bits = Number(value);
            }),
        ),
        false,
        "quantize.position_bits",
      ),
      field(
        "uv bits",
        select(
          UV_BITS,
          () => String(opts.get().quantize.uv_bits),
          (value) =>
            edit((steps) => {
              steps.quantize.uv_bits = Number(value);
            }),
        ),
        false,
        "quantize.uv_bits",
      ),
      field(
        "normals",
        check(
          "oct-encode",
          () => opts.get().quantize.normal_oct,
          (value) =>
            edit((steps) => {
              steps.quantize.normal_oct = value;
            }),
          "quantize.normal_oct",
        ),
      ),
    ],
    undefined,
    () => {
      const q = opts.get().quantize;
      return `${q.position_bits}/${q.uv_bits}${q.normal_oct ? " · oct" : ""}`;
    },
  );

  /* -------------------------------------------------------------- simplify */
  const weightNormal = numberInput(
    0,
    10,
    0.1,
    () => opts.get().simplify.weight_normal,
    (value) =>
      edit((steps) => {
        steps.simplify.weight_normal = value;
      }),
  );
  const weightUv = numberInput(
    0,
    10,
    0.1,
    () => opts.get().simplify.weight_uv,
    (value) =>
      edit((steps) => {
        steps.simplify.weight_uv = value;
      }),
  );
  refreshSyncers.push(() => {
    const on = opts.get().simplify.use_attributes;
    weightNormal.disabled = !on;
    weightUv.disabled = !on;
  });

  stepBlock(
    "simplify",
    "simplify",
    t("opt.hint.simplify"),
    () => [
      field(
        "keep",
        slider(
          10,
          100,
          1,
          () => Math.round(opts.get().simplify.target_ratio * 100),
          (value) =>
            edit((steps) => {
              steps.simplify.target_ratio = value / 100;
            }),
          "%",
        ),
        true,
        "simplify.target_ratio",
      ),
      field(
        "max error",
        select(
          ERROR_TOLERANCES.map(([label, value]): [string, string] => [label, String(value)]),
          () => String(opts.get().simplify.error_tolerance),
          (value) =>
            edit((steps) => {
              steps.simplify.error_tolerance = Number(value);
            }),
        ),
        false,
        "simplify.error_tolerance",
      ),
      field(
        "mode",
        check(
          "aggressive",
          () => opts.get().simplify.aggressive,
          (value) =>
            edit((steps) => {
              steps.simplify.aggressive = value;
            }),
          "simplify.aggressive",
        ),
      ),
      field(
        "borders",
        check(
          "lock",
          () => opts.get().simplify.lock_borders,
          (value) =>
            edit((steps) => {
              steps.simplify.lock_borders = value;
            }),
          "simplify.lock_borders",
        ),
      ),
      field(
        "seam-aware",
        check(
          "use attributes",
          () => opts.get().simplify.use_attributes,
          (value) =>
            edit((steps) => {
              steps.simplify.use_attributes = value;
            }),
          "simplify.use_attributes",
        ),
        true,
      ),
      field("weight normal", weightNormal, false, "simplify.weight_normal"),
      field("weight uv", weightUv, false, "simplify.weight_uv"),
    ],
    undefined,
    () => {
      const s = opts.get().simplify;
      const pct = Math.round(s.target_ratio * 100);
      return `keep ${pct}%${s.aggressive ? " · aggressive" : ""}${s.lock_borders ? "" : " · unlocked"}`;
    },
  );

  /* -------------------------------------------------------------- compress */
  stepBlock("compress", "compress", t("opt.hint.compress"), () => [], "compress");

  /* -------------------------------------------------------------- animops */
  stepBlock(
    "animops",
    "animops",
    t("opt.hint.animops"),
    () => [
      field(
        "constant",
        check(
          "remove tracks",
          () => opts.get().animops.remove_constant_tracks,
          (value) =>
            edit((steps) => {
              steps.animops.remove_constant_tracks = value;
            }),
          "animops.remove_constant_tracks",
        ),
      ),
      field(
        "epsilon",
        numberInput(
          0,
          1,
          0.00001,
          () => opts.get().animops.epsilon,
          (value) =>
            edit((steps) => {
              steps.animops.epsilon = value;
            }),
        ),
        true,
        "animops.epsilon",
      ),
    ],
    undefined,
    () => {
      const a = opts.get().animops;
      return a.remove_constant_tracks
        ? `constant tracks · eps ${a.epsilon}`
        : t("opt.hint.animops");
    },
  );

  sync();
  return { sync };
}
