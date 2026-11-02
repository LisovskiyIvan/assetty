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

  function field(label: string, control: HTMLElement, wide = false): HTMLElement {
    return el(
      "div",
      { class: wide ? "field wide" : "field" },
      el("span", { text: label }),
      control,
    );
  }

  function check(label: string, get: () => boolean, set: (value: boolean) => void): HTMLElement {
    const box = el("input", { type: "checkbox" });
    box.checked = get();
    box.addEventListener("change", () => set(box.checked));
    valueSyncers.push(() => {
      box.checked = get();
    });
    return el("label", { class: "inline-check" }, box, el("span", { text: label }));
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
      ),
      check(
        "materials",
        () => opts.get().prune.unused_materials,
        (value) =>
          edit((steps) => {
            steps.prune.unused_materials = value;
          }),
      ),
      check(
        "textures",
        () => opts.get().prune.unused_textures,
        (value) =>
          edit((steps) => {
            steps.prune.unused_textures = value;
          }),
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
      ),
      check(
        "meshes",
        () => opts.get().dedup.meshes,
        (value) =>
          edit((steps) => {
            steps.dedup.meshes = value;
          }),
      ),
      check(
        "materials",
        () => opts.get().dedup.materials,
        (value) =>
          edit((steps) => {
            steps.dedup.materials = value;
          }),
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
    ),
  ]);

  /* ------------------------------------------------------------------ join */
  stepBlock("join", "join", "merge primitives sharing a material", () => []);

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
      ),
      true,
    ),
    field("weight normal", weightNormal),
    field("weight uv", weightUv),
  ]);

  sync();
  return { sync };
}
