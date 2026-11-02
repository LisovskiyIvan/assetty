/** Static fixtures so the whole layout is inspectable in a plain browser (no nanoui). */
import type {
  DiffReport,
  EncodeResult,
  Info,
  LintResult,
  OptimizeResult,
  TexturesResult,
} from "./types";

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

export const demoDiff: DiffReport = {
  nodes: { added: [], removed: [{ index: 7, name: "Empty_Node_17" }], changed: [] },
  meshes: {
    added: [],
    removed: [],
    changed: [{ index: 0, name: "Helmet", fields: ["primitives[0].indices"] }],
  },
  materials: {
    added: [],
    removed: [],
    changed: [{ index: 0, name: "Material_MR", fields: ["occlusionTexture.index"] }],
  },
  textures: { added: [], removed: [], changed: [{ index: 3, name: "normal", fields: ["source"] }] },
  images: {
    added: [],
    removed: [],
    changed: [{ index: 3, name: "normal", fields: ["mimeType", "byteLength"] }],
  },
  animations: { added: [], removed: [], changed: [] },
  skins: { added: [], removed: [], changed: [] },
  totals: { added: 0, removed: 1, changed: 4 },
};

export const demoLint: LintResult = {
  total: 4,
  violations: [
    { code: "max_draw_calls", message: "draw calls 71 exceed budget 64", index: null },
    { code: "missing_mips", message: "image has no mip chain", index: 0 },
    { code: "format_not_allowed", message: "image format jpeg not in [ktx2]", index: 0 },
    { code: "texture_too_large", message: "2048x2048 exceeds max_texture_size 1024", index: 4 },
  ],
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

export const demoBudget = `{
  "max_triangles": 100000,
  "max_vertices": 50000,
  "max_draw_calls": 64,
  "max_vram_bytes": 33554432,
  "max_texture_size": 2048,
  "require_mips": true,
  "allowed_image_formats": ["ktx2"]
}
`;
