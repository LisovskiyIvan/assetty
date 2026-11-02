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

export interface EncodeResult {
  ktx2_size: number;
  psnr: number;
  vram_after: number;
}

export interface DiffEntry {
  index: number;
  name: string | null;
}

export interface DiffChanged {
  index: number;
  name: string | null;
  fields: string[];
}

export interface DiffCategory {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffChanged[];
}

export interface DiffReport {
  nodes: DiffCategory;
  meshes: DiffCategory;
  materials: DiffCategory;
  textures: DiffCategory;
  images: DiffCategory;
  animations: DiffCategory;
  skins: DiffCategory;
  totals?: { added: number; removed: number; changed: number };
}

export interface LintViolation {
  code: string;
  message: string;
  index: number | null;
}

export interface LintResult {
  violations: LintViolation[];
  total: number;
}
