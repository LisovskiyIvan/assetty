// OWNED BY: subagent O1 (dedup). Replace this file entirely. Do not change the public API below.
const std = @import("std");
const c = @import("cgltf");

pub const Options = struct {
    accessors: bool = true,
    meshes: bool = true,
    materials: bool = true,
};

pub const Result = struct {
    removed_accessors: u32 = 0,
    removed_meshes: u32 = 0,
    removed_materials: u32 = 0,
};

/// In-place dedup on cgltf data: finds identical accessors / meshes / materials
/// and rewrites all references to a representative. Duplicates stay in the
/// cgltf pools (unreferenced) — the writer's GC pass drops them on output.
pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = a;
    _ = data;
    _ = file_bytes;
    _ = opts;
    return .{};
}
