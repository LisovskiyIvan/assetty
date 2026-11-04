/** Shapes mirroring the Zig backend JSON (CLI `--json` output). */

export interface Counts {
  scenes: number;
  nodes: number;
  meshes: number;
  primitives: number;
  materials: number;
  textures: number;
  images: number;
  animations: number;
  skins: number;
  joints: number;
}

export interface Geometry {
  triangles: number;
  vertices: number;
  mesh_instances: number;
  draw_calls: number;
}

export interface Disk {
  total: number;
  json: number;
  bin: number;
  json_pct: number;
}

export interface ImageInfo {
  index: number;
  name: string | null;
  format: string;
  width: number;
  height: number;
  vram: number;
  disk: number;
  has_mips: boolean;
  /** Report rows: the backend left this image unencoded (`skip: true`). */
  skipped?: boolean;
  /** Report rows: effective codec after per-texture overrides. */
  effective_format?: string;
}

export interface Garbage {
  unused_nodes: number[];
  unused_materials: number[];
  unused_textures: number[];
  unused_images: number[];
  no_mips_images: number[];
  uncompressed_embedded: number[];
}

export interface Info {
  file: string;
  container?: string;
  generator?: string | null;
  counts: Counts;
  geometry: Geometry;
  disk: Disk;
  vram: { total_est: number; images: ImageInfo[] };
  garbage: Garbage;
}

export interface OptimizeStep {
  kind: string;
  applied: boolean;
  note?: string;
  /** Wall-clock seconds this step took (newer hosts). */
  secs?: number;
  /** Per-image rows for the textures step (newer hosts): skipped + effective format. */
  images?: TextureImageReport[];
}

/** One per-image row inside a textures-step report. */
export interface TextureImageReport {
  image?: number;
  index?: number;
  name?: string | null;
  skipped?: boolean;
  format?: string;
  effective_format?: string;
}

export interface Stats {
  triangles: number;
  vertices: number;
  draw_calls: number;
  vram_total?: number;
  vram_bytes?: number;
  disk_total?: number;
  disk_bytes?: number;
  [key: string]: number | undefined;
}

export interface Delta {
  before: number;
  after: number;
  pct: number | null;
}

export interface OptimizeReport {
  preset?: string;
  target?: string;
  /** Wall-clock seconds for the whole pipeline (newer hosts). */
  total_secs?: number;
  steps: OptimizeStep[];
  before: Stats;
  after: Stats;
  deltas?: Record<string, Delta>;
}

export interface OptimizeResult {
  out_path: string;
  report: OptimizeReport;
}

export interface TexturesResult {
  images: ImageInfo[];
}

/** Settings the host applied during `textureEncode` (optional, newer hosts). */
export interface EncodeSettings {
  format?: string;
  quality?: number;
  max_size?: number;
  generate_mips?: boolean;
  normal_map?: boolean;
}

export interface EncodeResult {
  ktx2_size: number;
  psnr: number;
  vram_after: number;
  /** Absolute paths of the before/after PNG renders (newer hosts). */
  before_png?: string;
  after_png?: string;
  width?: number;
  height?: number;
  mip_levels?: number;
  format?: string;
  settings?: EncodeSettings;
}

/** One decoded image for the texture preview pane. */
export interface TexturePreview {
  index: number;
  /** base64 PNG, without the `data:` prefix. */
  b64: string;
  width: number;
  height: number;
}
