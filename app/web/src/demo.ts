/** Static fixtures so the whole layout is inspectable in a plain browser (no nanoui). */
import type { EncodeResult, Info, OptimizeResult, TexturePreview, TexturesResult } from "./types";
import type { ProgressEvent } from "./bridge/types";

const helmetImages = [
  {
    index: 0,
    name: "Default_AO",
    format: "jpeg",
    width: 2048,
    height: 2048,
    vram: 22_369_621,
    disk: 686_244,
    has_mips: false,
  },
  {
    index: 1,
    name: "Default_metalRoughness",
    format: "jpeg",
    width: 2048,
    height: 2048,
    vram: 22_369_621,
    disk: 933_785,
    has_mips: false,
  },
  {
    index: 2,
    name: "Default_emissive",
    format: "jpeg",
    width: 2048,
    height: 2048,
    vram: 22_369_621,
    disk: 774_662,
    has_mips: false,
  },
  {
    index: 3,
    name: "Default_normal",
    format: "jpeg",
    width: 2048,
    height: 2048,
    vram: 22_369_621,
    disk: 2_003_096,
    has_mips: false,
  },
  {
    index: 4,
    name: "Default_albedo",
    format: "jpeg",
    width: 2048,
    height: 2048,
    vram: 22_369_621,
    disk: 2_003_192,
    has_mips: false,
  },
];

export const demoInfo: Info = {
  file: "/demo/DamagedHelmet.glb",
  container: "glb",
  generator: "Khronos glTF Blender I/O v3.6.27",
  counts: {
    scenes: 1,
    nodes: 1,
    meshes: 1,
    primitives: 1,
    materials: 1,
    textures: 5,
    images: 5,
    animations: 0,
    skins: 0,
    joints: 0,
  },
  geometry: { triangles: 15_452, vertices: 14_556, mesh_instances: 1, draw_calls: 1 },
  disk: { total: 3_601_172, json: 2_868, bin: 3_598_304, json_pct: 0.1 },
  vram: { total_est: 111_848_105, images: helmetImages },
  garbage: {
    unused_nodes: [],
    unused_materials: [],
    unused_textures: [],
    unused_images: [],
    no_mips_images: [0, 1, 2, 3, 4],
    uncompressed_embedded: [0, 1, 2, 3, 4],
  },
};

export const demoTextures: TexturesResult = { images: helmetImages };

export const demoEncode: EncodeResult = {
  ktx2_size: 1_438_208,
  psnr: 38.6,
  vram_after: 5_592_405,
};

/**
 * Stand-in image for demo mode (no host, no real pixels). Keyed by the path the
 * backend would have returned so before/after stay visually distinct.
 */
const demoPngCache = new Map<string, string>();

export function demoPngDataUrl(key: string): string {
  const hit = demoPngCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 320;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const after = /after|ktx2/i.test(key);
  const grad = ctx.createLinearGradient(0, 0, 320, 320);
  if (after) {
    grad.addColorStop(0, "#16324d");
    grad.addColorStop(1, "#3f8ad6");
  } else {
    grad.addColorStop(0, "#3b2a17");
    grad.addColorStop(1, "#c98b3f");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 320, 320);
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  for (let y = 0; y < 320; y += 32) {
    for (let x = 0; x < 320; x += 32) {
      if (((x + y) / 32) % 2 === 0) ctx.fillRect(x, y, 32, 32);
    }
  }
  ctx.fillStyle = "#eef4fb";
  ctx.textAlign = "center";
  ctx.font = "600 18px ui-monospace, Menlo, monospace";
  ctx.fillText(after ? "KTX2" : "ORIGINAL", 160, 150);
  ctx.font = "11px ui-monospace, Menlo, monospace";
  const name = (key.split(/[\\/]/).pop() ?? key).slice(-30);
  ctx.fillText(name, 160, 174);
  const url = canvas.toDataURL("image/png");
  demoPngCache.set(key, url);
  return url;
}

export const demoOptimize: OptimizeResult = {
  out_path: "/demo/optimized.glb",
  report: {
    preset: "desktop",
    target: "desktop",
    total_secs: 4.18,
    steps: [
      { kind: "prune", applied: true, note: "removed 0 nodes, 0 materials", secs: 0.12 },
      { kind: "dedup", applied: true, note: "3 accessors deduplicated", secs: 0.31 },
      { kind: "weld", applied: true, note: "vertices 14556 -> 14002", secs: 0.88 },
      { kind: "join", applied: false, note: "single primitive", secs: 0.02 },
      { kind: "textures", applied: true, note: "5 images -> BC7 ktx2", secs: 2.45 },
      { kind: "quantize", applied: true, note: "position 14 bits, uv 12 bits", secs: 0.4 },
    ],
    before: {
      triangles: 15_452,
      vertices: 14_556,
      draw_calls: 1,
      vram_total: 111_848_105,
      disk_total: 3_601_172,
    },
    after: {
      triangles: 15_452,
      vertices: 14_002,
      draw_calls: 1,
      vram_total: 27_962_026,
      disk_total: 1_204_233,
    },
    deltas: {
      triangles: { before: 15_452, after: 15_452, pct: 0 },
      vertices: { before: 14_556, after: 14_002, pct: -3.81 },
      draw_calls: { before: 1, after: 1, pct: 0 },
      vram_bytes: { before: 111_848_105, after: 27_962_026, pct: -75.0 },
      disk_bytes: { before: 3_601_172, after: 1_204_233, pct: -66.56 },
    },
  },
};

export const demoPresets = ["desktop", "mobile", "web"];

export const demoZon = `// Desktop pipeline: BC7 textures, highest quality, meshopt compression.
.{
    .name = "desktop",
    .target = .desktop,
    .steps = .{
        .{ .prune = .{
            .unused_nodes = true,
            .unused_materials = true,
            .unused_textures = true,
        } },
        .{ .dedup = .{
            .accessors = true,
            .meshes = true,
            .materials = true,
        } },
        .{ .weld = .{ .tolerance = 0.0 } },
        .{ .join = .{} },
        .{ .textures = .{
            .format = .bc7,
            .quality = 255,
            .rdo_lambda = 1.0,
            .normal_maps_renormalize = true,
            .generate_mips = true,
            .max_size = 0,
        } },
        .{ .quantize = .{
            .position_bits = 14,
            .normal_oct = true,
            .uv_bits = 12,
            .compress = true,
        } },
    },
}
`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Demo-mode stand-in for `assetty.settings.json`. */
const DEMO_SETTINGS_KEY = "assetty.settings.json";

export class DemoBackend {
  async info(path: string): Promise<Info> {
    await sleep(120);
    return { ...demoInfo, file: path };
  }

  async optimize(
    path: string,
    preset: string,
    onProgress?: (p: ProgressEvent) => void,
  ): Promise<OptimizeResult> {
    const kinds = demoOptimize.report.steps.map((s) => s.kind);
    for (let i = 0; i < kinds.length; i++) {
      onProgress?.({ step: kinds[i], pct: Math.round(((i + 1) / kinds.length) * 100) });
      await sleep(180);
    }
    return {
      out_path: demoOptimize.out_path,
      report: { ...demoOptimize.report, preset },
    };
  }

  /** Mirrors `optimizeCustom(path, spec)`: only the requested steps run. */
  async optimizeCustom(
    path: string,
    specJson: string,
    onProgress?: (p: ProgressEvent) => void,
  ): Promise<OptimizeResult> {
    void path;
    let kinds: string[] = [];
    try {
      const spec = JSON.parse(specJson) as { steps?: Array<Record<string, unknown>> };
      kinds = (spec.steps ?? []).flatMap((step) => Object.keys(step));
    } catch {
      kinds = [];
    }
    if (kinds.length === 0) kinds = ["prune"];
    for (let i = 0; i < kinds.length; i++) {
      onProgress?.({ step: kinds[i], pct: Math.round(((i + 1) / kinds.length) * 100) });
      await sleep(160);
    }
    const all = demoOptimize.report.steps;
    const steps = kinds.map(
      (kind) => all.find((s) => s.kind === kind) ?? { kind, applied: true, note: "ok" },
    );
    return {
      out_path: demoOptimize.out_path,
      report: { ...demoOptimize.report, preset: "custom", steps },
    };
  }

  async textures(): Promise<TexturesResult> {
    await sleep(120);
    return demoTextures;
  }

  async texturePreview(path: string, index: number): Promise<TexturePreview> {
    await sleep(220);
    const img = demoTextures.images[index] ?? demoTextures.images[0];
    const dataUrl = demoPngDataUrl(`${path}#preview-${index}`);
    return {
      index,
      b64: dataUrl.replace(/^data:image\/png;base64,/, ""),
      width: img?.width ?? 0,
      height: img?.height ?? 0,
    };
  }

  async textureEncode(_path: string, index: number): Promise<EncodeResult> {
    await sleep(400);
    const img = demoTextures.images[index];
    const ratio = img ? Math.max(0.06, (img.width * img.height) / 22_369_621) : 1;
    return {
      ktx2_size: Math.round(demoEncode.ktx2_size * ratio),
      psnr: demoEncode.psnr - (index % 3) * 2.4,
      vram_after: Math.round(demoEncode.vram_after * ratio),
      before_png: `/demo/image${index}_before.png`,
      after_png: `/demo/image${index}_after.png`,
      width: img?.width,
      height: img?.height,
      mip_levels: img ? Math.floor(Math.log2(Math.max(img.width, img.height))) + 1 : undefined,
      format: "ETC1S",
      settings: { format: "etc1s", quality: 128, max_size: 0, generate_mips: true },
    };
  }

  /**
   * Demo mode never touches disk — the real host only deletes inside
   * `.zig-cache/assetty-app/` anyway. Waits a beat so the UI path (banner
   * teardown, toasts) stays identical to the live one.
   */
  async discardFile(_path: string): Promise<void> {
    await sleep(120);
  }

  async presets(): Promise<string[]> {
    await sleep(40);
    return [...demoPresets];
  }

  async presetLoad(name: string): Promise<string> {
    await sleep(60);
    return name === "desktop" ? demoZon : demoZon.replace(/\.desktop/g, `.${name}`);
  }

  async presetSave(): Promise<void> {
    await sleep(80);
  }

  /**
   * Demo mode persists settings in localStorage so a plain `vite dev` session
   * still round-trips them (the real host uses assetty.settings.json).
   */
  async settingsLoad(): Promise<string> {
    try {
      return window.localStorage.getItem(DEMO_SETTINGS_KEY) ?? "{}";
    } catch {
      return "{}";
    }
  }

  async settingsSave(text: string): Promise<void> {
    try {
      JSON.parse(text);
    } catch (err) {
      throw new Error(`invalid settings JSON: ${(err as Error).message}`);
    }
    try {
      window.localStorage.setItem(DEMO_SETTINGS_KEY, text);
    } catch {
      throw new Error("localStorage unavailable");
    }
  }
}
