const std = @import("std");
// OWNED BY: subagent O4 (meshopt quantize/simplify). Replace entirely. Public API fixed.
const c = @import("cgltf");

pub const Options = struct {
    target_ratio: f32 = 0.5,
    /// max relative error, e.g. 1e-2 = 1%
    error_tolerance: f32 = 1e-3,
    aggressive: bool = false,
    lock_borders: bool = true,
};

pub const Result = struct {
    /// triangles before
    before: u64 = 0,
    /// triangles after simplification
    after: u64 = 0,
};

/// meshopt_simplify per primitive (triangles only), rewrite index accessors.
pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = a;
    _ = data;
    _ = file_bytes;
    _ = opts;
    return .{};
}
