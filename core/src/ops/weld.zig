const std = @import("std");
// OWNED BY: subagent O3 (weld + join + geom builder). Replace entirely. Public API fixed.
const c = @import("cgltf");

pub const Options = struct {
    /// 0 = exact match on (position, normal, uv...) tuples
    tolerance: f32 = 0,
};

pub const Result = struct {
    /// vertices removed across all primitives
    removed_vertices: u32 = 0,
    /// primitives whose index buffer was rewritten
    rewritten_prims: u32 = 0,
};

/// Vertex welding: within each primitive's index+attribute data, merge
/// byte-identical (or tolerance-equal) vertices, rewrite indices.
/// Creates a new compact accessor set via geom.Builder.
pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = a;
    _ = data;
    _ = file_bytes;
    _ = opts;
    return .{};
}
