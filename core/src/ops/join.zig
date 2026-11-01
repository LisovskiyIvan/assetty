// OWNED BY: subagent O3 (weld + join + geom builder). Replace entirely. Public API fixed.
const c = @import("cgltf");

pub const Result = struct {
    /// primitives merged away
    merged_prims: u32 = 0,
    /// meshes that ended up with a single merged primitive
    rewritten_meshes: u32 = 0,
};

/// Join: within each mesh, merge primitives that share the same material and
/// are all triangles, concatenating attribute streams + offset indices.
pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8) !Result {
    _ = a;
    _ = data;
    _ = file_bytes;
    return .{};
}
