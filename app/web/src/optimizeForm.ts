/**
 * Per-step optimize controls, shared by the Optimize tab and the Settings tab
 * (optimize defaults). Both surfaces edit the same `settings.optimize.steps`
 * state — see `settings.ts` for the persisted schema.
 */
import { el } from "./ui";
import type { OptimizeSteps, TextureFormat } from "./settings";

export interface OptimizeFormOptions {
  get(): OptimizeSteps;
  /** Applies one edit to the live settings state (debounce-saved by settings.ts). */
  edit(mutate: (steps: OptimizeSteps) => void): void;
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
  "quantize.position_bits":
    "Quantizes vertex positions to this many bits (14 ≈ near-lossless). Big VRAM and disk win for a tiny precision loss; needs KHR_mesh_quantization support.",
  "quantize.uv_bits":
    "Quantizes texture coordinates to this many bits (12 ≈ near-lossless). Big VRAM and disk win for a tiny precision loss; needs KHR_mesh_quantization support.",
  "quantize.normal_oct":
    "Packs normals with octahedral encoding (2×8/16-bit instead of 3 floats). Much smaller vertex buffers; needs extension support — very old viewers may render it wrong.",
  "compare.mode":
    "Side by side shows source and result next to each other; split slider stacks them with a draggable wipe. Both views stay camera-synced while you orbit.",
  "textures.overrides_note":
    "Per-texture overrides replace the base params for single images of this model only, and merge into the textures step on Run. Edit them per image in the Textures tab.",
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
  const text = FIELD_HELP[id];
  if (!text) return;
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
    title: "what does this do?",
    dataset: { help: id },
  });
  btn.setAttribute("aria-label", `help: ${id}`);
  btn.addEventListener("click", (ev) => {
    // The button may sit inside a <label>: never toggle the control.
    ev.preventDefault();
    ev.stopPropagation();
    toggleFieldHelp(btn, id);
  });
  return btn;
}

const TEXTURE_MAX_SIZES: Array<[string, number]> = [
  ["no resize", 0],
  ["512", 512],
  ["1024", 1024],
  ["2048", 2048],
];

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
      block.params.hidden = !steps[block.id].enabled;
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
  }

  /* ----------------------------------------------------------------- prune */
  stepBlock("prune", "prune", "unused nodes / materials / textures", () => [
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
    ),
  ]);

  /* ----------------------------------------------------------------- dedup */
  stepBlock("dedup", "dedup", "share identical data", () => [
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
  ]);

  /* ------------------------------------------------------------------ weld */
  stepBlock("weld", "weld", "merge duplicate vertices", () => [
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
  ]);

  /* ------------------------------------------------------------------ join */
  stepBlock("join", "join", "merge primitives sharing a material", () => [], "join");

  /* -------------------------------------------------------------- textures */
  stepBlock("textures", "textures", "KTX2 / basis encode", () => [
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
        TEXTURE_MAX_SIZES.map(([label, value]): [string, string] => [label, String(value)]),
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
  ]);

  /* -------------------------------------------------------------- quantize */
  stepBlock("quantize", "quantize", "attribute bit packing", () => [
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
  ]);

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

  stepBlock("simplify", "simplify", "decimate triangles", () => [
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
  ]);

  sync();
  return { sync };
}
